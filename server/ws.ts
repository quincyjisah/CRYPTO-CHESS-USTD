import { createServer } from "node:http";
import { URL } from "node:url";
import {
  assertGameAccess,
  assertSessionNotRevoked,
  verifySessionToken,
  type VerifiedSession,
} from "../lib/auth";
import { WebSocketServer, type WebSocket } from "ws";
import { getGame, submitMove } from "../lib/gameEngine";
import {
  getRedis,
  getSubscriber,
  readGameEvents,
  subscribeToGame,
} from "../lib/redisBus";

interface ClientContext {
  socket: WebSocket;
  userId: string;
  session: VerifiedSession;
  gameId?: string;
  lastPongAt: number;
}

interface IncomingMessage {
  type: "join" | "move" | "recover" | "ping";
  gameId?: string;
  move?: string;
  idempotencyKey?: string;
  sinceStreamId?: string;
  clientTimestamp?: number;
}

const PORT = Number(process.env.WS_PORT ?? process.env.PORT ?? 8080);
const HEARTBEAT_INTERVAL_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 75_000;

const redis = getRedis();
const subscriber = getSubscriber();

const httpServer = createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "ws" }));
    return;
  }

  response.writeHead(404);
  response.end();
});

const wss = new WebSocketServer({ server: httpServer });
const clients = new Map<WebSocket, ClientContext>();
const rooms = new Map<string, Set<WebSocket>>();
const roomSubscriptions = new Map<string, () => Promise<void>>();

wss.on("connection", (socket, request) => {
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  const token = url.searchParams.get("token");
  if (!token) {
    socket.close(1008, "token is required");
    return;
  }

  let session: VerifiedSession;
  try {
    session = verifySessionToken(token);
  } catch (error) {
    socket.close(
      1008,
      error instanceof Error ? error.message : "invalid token",
    );
    return;
  }

  const context: ClientContext = {
    socket,
    userId: session.userId,
    session,
    lastPongAt: Date.now(),
  };
  clients.set(socket, context);
  void assertSessionNotRevoked(redis, context.session)
    .then(() => send(socket, { type: "connected", userId: session.userId }))
    .catch((error: Error) => socket.close(1008, error.message));

  socket.on("message", (raw) => {
    void handleMessage(context, raw.toString()).catch((error: Error) => {
      send(socket, { type: "error", message: error.message });
    });
  });

  socket.on("pong", () => {
    context.lastPongAt = Date.now();
  });

  socket.on("close", () => {
    void leaveRoom(context);
    clients.delete(socket);
  });
});

async function handleMessage(
  context: ClientContext,
  raw: string,
): Promise<void> {
  const message = JSON.parse(raw) as IncomingMessage;

  await assertSessionNotRevoked(redis, context.session);

  if (message.type === "ping") {
    send(context.socket, { type: "pong", timestamp: Date.now() });
    return;
  }

  if (message.type === "join") {
    if (!message.gameId) {
      throw new Error("gameId is required to join.");
    }
    assertGameAccess(context.session, message.gameId);
    await joinRoom(context, message.gameId);
    const state = await getGame(redis, message.gameId);
    send(context.socket, { type: "state", state });
    return;
  }

  if (message.type === "recover") {
    if (!message.gameId) {
      throw new Error("gameId is required to recover.");
    }
    assertGameAccess(context.session, message.gameId);
    const events = await readGameEvents(
      redis,
      message.gameId,
      message.sinceStreamId ?? "0-0",
    );
    send(context.socket, { type: "recovered", events });
    return;
  }

  if (message.type === "move") {
    if (!message.gameId || !message.move || !message.idempotencyKey) {
      throw new Error("gameId, move, and idempotencyKey are required.");
    }

    assertGameAccess(context.session, message.gameId);
    const result = await submitMove(redis, {
      gameId: message.gameId,
      userId: context.userId,
      move: message.move,
      idempotencyKey: message.idempotencyKey,
      clientTimestamp: message.clientTimestamp,
    });

    send(context.socket, {
      type: "move.submitted",
      gameId: message.gameId,
      result,
    });
  }
}

async function joinRoom(context: ClientContext, gameId: string): Promise<void> {
  await leaveRoom(context);
  context.gameId = gameId;
  const room = rooms.get(gameId) ?? new Set<WebSocket>();
  room.add(context.socket);
  rooms.set(gameId, room);

  if (!roomSubscriptions.has(gameId)) {
    const unsubscribe = await subscribeToGame(subscriber, gameId, (event) => {
      broadcast(gameId, { type: "event", event });
    });
    roomSubscriptions.set(gameId, unsubscribe);
  }
}

async function leaveRoom(context: ClientContext): Promise<void> {
  if (context.gameId) {
    rooms.get(context.gameId)?.delete(context.socket);
    if (rooms.get(context.gameId)?.size === 0) {
      rooms.delete(context.gameId);
      const unsubscribe = roomSubscriptions.get(context.gameId);
      if (unsubscribe) {
        await unsubscribe().catch(() => undefined);
        roomSubscriptions.delete(context.gameId);
      }
    }
  }
  context.gameId = undefined;
}

function broadcast(gameId: string, payload: unknown): void {
  for (const socket of rooms.get(gameId) ?? []) {
    send(socket, payload);
  }
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

setInterval(() => {
  const now = Date.now();
  for (const context of clients.values()) {
    if (now - context.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      context.socket.terminate();
      continue;
    }
    context.socket.ping();
  }
}, HEARTBEAT_INTERVAL_MS).unref();

httpServer.listen(PORT, () => {
  console.warn(`Crypto Chess WS authority listening on ${PORT}`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
});
