import {
  assertGameAccess,
  assertSessionNotRevoked,
  verifySessionToken,
} from "../../../lib/auth";
import { createGame, getGame, submitMove } from "../../../lib/gameEngine";
import { getRedis } from "../../../lib/redisBus";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const gameId = url.searchParams.get("gameId");
  if (!gameId) {
    return json({ error: "gameId query parameter is required" }, 400);
  }

  const state = await getGame(getRedis(), gameId);
  return json({ state }, state ? 200 : 404);
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as {
    token?: string;
    action: "create" | "move";
    gameId: string;
    whiteUserId?: string;
    blackUserId?: string;
    userId?: string;
    move?: string;
    idempotencyKey?: string;
  };

  if (!body.token) {
    return json({ error: "token is required" }, 401);
  }

  let session;
  try {
    session = verifySessionToken(body.token);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "invalid token" },
      401,
    );
  }

  await assertSessionNotRevoked(getRedis(), session);

  if (body.action === "create") {
    if (!body.whiteUserId || !body.blackUserId) {
      return json({ error: "whiteUserId and blackUserId are required" }, 400);
    }

    if (session.role !== "admin") {
      return json(
        { error: "Only admin may create games through this endpoint" },
        403,
      );
    }

    const state = await createGame(getRedis(), {
      gameId: body.gameId,
      whiteUserId: body.whiteUserId,
      blackUserId: body.blackUserId,
    });
    return json({ state }, 201);
  }

  if (body.action === "move") {
    if (!body.userId || !body.move || !body.idempotencyKey) {
      return json(
        { error: "userId, move, and idempotencyKey are required" },
        400,
      );
    }

    assertGameAccess(session, body.gameId);
    if (session.userId !== body.userId && session.role !== "admin") {
      return json(
        { error: "Token userId does not match submitted userId" },
        403,
      );
    }

    const result = await submitMove(getRedis(), {
      gameId: body.gameId,
      userId: body.userId,
      move: body.move,
      idempotencyKey: body.idempotencyKey,
    });
    return json(result);
  }

  return json({ error: "Unsupported action" }, 400);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
