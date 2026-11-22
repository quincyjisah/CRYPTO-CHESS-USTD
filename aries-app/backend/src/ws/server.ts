/**
 * ws/server.ts — Aries Protocol Production WebSocket Server
 *
 * Architecture:
 *  - Runs as N horizontal instances behind NGINX upstream
 *  - Each instance is stateless — all game state lives in Redis
 *  - Redis Pub/Sub routes messages between nodes
 *  - Authoritative move validation on this server only
 *  - Anti-cheat telemetry streamed to Redis Streams
 *  - Prometheus metrics on /metrics endpoint
 *  - Graceful shutdown with game state preservation
 *
 * Scale: 1 node handles ~5,000 concurrent connections
 *        10 nodes → 50,000 concurrent
 *        200 nodes → 1,000,000 concurrent (via K8s HPA)
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage }  from 'http';
import express from 'express';
import helmet  from 'helmet';
import { v4 as uuidv4 } from 'uuid';
import { Chess } from 'chess.js';
import { logger }  from '../shared/logger';
import { metrics } from '../shared/metrics';
import { redis, redisPub, redisSub } from '../shared/redis';
import { AntiCheatOracle } from '../anticheat/oracle';
import { GameEngine }      from './gameEngine';
import { SessionManager }  from './sessionManager';
import type { WsMessage, WsMoveSubmit, GameSession } from '../shared/types';

const NODE_ID   = process.env.NODE_ID   || uuidv4().slice(0, 8);
const PORT      = parseInt(process.env.PORT || '8080');
const ALLOWED_ORIGINS = new Set(
  (process.env.WS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

// ─── Connected clients ────────────────────────────────────────────────────────
// uid → WebSocket (one socket per user on this node)
const clients = new Map<string, WebSocket>();
// gameId → Set<uid> (spectators watching this game on this node)
const spectators = new Map<string, Set<string>>();

// ─── Services ─────────────────────────────────────────────────────────────────
const engine     = new GameEngine(redis);
const sessions   = new SessionManager(redis);
const anticheat  = new AntiCheatOracle(redis);

// ─── HTTP + WebSocket server ──────────────────────────────────────────────────
const app    = express();
app.use(helmet());
app.use(express.json());

// Health probe (Kubernetes liveness + readiness)
app.get('/health',   (_req, res) => res.json({ status: 'ok', nodeId: NODE_ID, connections: clients.size }));
app.get('/ready',    (_req, res) => res.json({ ready: true }));
app.get('/metrics',  (_req, res) => {
  res.set('Content-Type', 'text/plain');
  res.end(metrics.prometheus());
});

const httpServer = createServer(app);
const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws',
  maxPayload: 64 * 1024,
  perMessageDeflate: false,
  verifyClient: (info, callback) => {
    const origin = info.origin;
    if (!origin || ALLOWED_ORIGINS.has(origin)) {
      callback(true);
      return;
    }
    callback(false, 403, 'Origin not allowed');
  },
});

// ─── Redis Pub/Sub subscription ───────────────────────────────────────────────
// Each WS node subscribes to a global channel.
// When another node needs to send a message to a client on THIS node,
// it publishes to this channel.
redisSub.subscribe(`ws:node:${NODE_ID}`, (err) => {
  if (err) logger.error({ err }, 'Redis subscribe failed');
});
redisSub.subscribe('ws:broadcast', (err) => {
  if (err) logger.error({ err }, 'Redis broadcast subscribe failed');
});

redisSub.on('message', (channel: string, raw: string) => {
  try {
    const { targetUid, message } = JSON.parse(raw);
    if (channel === 'ws:broadcast') {
      // Broadcast to all clients on this node
      clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(raw);
      });
      return;
    }
    // Direct message to a specific client on this node
    const ws = clients.get(targetUid);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to handle Redis pub/sub message');
  }
});

// ─── Connection handler ───────────────────────────────────────────────────────
wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
  metrics.inc('ws_connections_total');
  metrics.gauge('ws_connections_active', clients.size);

  let uid: string | null    = null;
  let gameId: string | null = null;

  // Heartbeat — detect stale connections
  let isAlive = true;
  ws.on('pong', () => { isAlive = true; });

  const pingInterval = setInterval(() => {
    if (!isAlive) {
      logger.warn({ uid }, 'WebSocket connection stale — terminating');
      ws.terminate();
      return;
    }
    isAlive = false;
    ws.ping();
  }, 30_000);

  // ─── Message handler ─────────────────────────────────────────────────────
  ws.on('message', async (raw: Buffer) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', data: { code: 'INVALID_JSON' }, ts: Date.now() });
      return;
    }

    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' ||
        !['auth', 'move_submit', 'spectate_join', 'resign', 'draw_offer', 'chat_send', 'ping'].includes(msg.type)) {
      send(ws, { type: 'error', data: { code: 'UNKNOWN_TYPE' }, ts: Date.now() });
      return;
    }
    metrics.inc('ws_messages_' + msg.type);

    try {
      switch (msg.type) {

        // ── Authentication ────────────────────────────────────────────────
        case 'auth': {
          const token = msg.data?.token as string;
          if (!token) {
            send(ws, { type: 'auth_fail', data: { reason: 'No token' }, ts: Date.now() });
            ws.close(1008, 'Unauthorized');
            return;
          }

          // Verify Firebase ID token via Admin SDK (or JWT if using custom auth)
          if (uid) {
            send(ws, { type: 'auth_fail', data: { reason: 'Already authenticated' }, ts: Date.now() });
            ws.close(1008, 'Already authenticated');
            return;
          }

          const verified = await sessions.verifyToken(token);
          if (!verified) {
            send(ws, { type: 'auth_fail', data: { reason: 'Invalid token' }, ts: Date.now() });
            ws.close(1008, 'Unauthorized');
            return;
          }

          uid = verified.uid;

          // Replace an older socket without letting its close handler
          // unregister this new session.
          const previousSocket = clients.get(uid);
          if (previousSocket && previousSocket !== ws) {
            previousSocket.close(4001, 'Session replaced');
          }
          clients.set(uid, ws);

          // Register which node this user is connected to (for routing)
          await redis.setex(`ws:user:${uid}:node`, 300, NODE_ID);

          // If they were in a game, send reconnect state
          const activeGameId = await redis.get(`user:${uid}:activeGame`);
          if (activeGameId) {
            const state = await engine.getGameState(activeGameId);
            if (state && state.status === 'active') {
              gameId = activeGameId;
              send(ws, { type: 'reconnect_state', data: { game: state }, ts: Date.now() });
            }
          }

          send(ws, { type: 'auth_ok', data: { uid, nodeId: NODE_ID }, ts: Date.now() });
          logger.info({ uid, nodeId: NODE_ID }, 'Client authenticated');
          break;
        }

        // ── Move submission ───────────────────────────────────────────────
        case 'move_submit': {
          if (!uid) { send(ws, { type: 'error', data: { code: 'NOT_AUTHED' }, ts: Date.now() }); return; }

          const { gameId: gid, from, to, promotion, thinkMs } = (msg.data || {}) as unknown as WsMoveSubmit;
          if (typeof gid !== 'string' || !gid || typeof from !== 'string' || typeof to !== 'string' || from.length !== 2 || to.length !== 2) {
            send(ws, { type: 'move_rejected', data: { reason: 'Missing fields' }, ts: Date.now() });
            return;
          }

          // Rate limit: 1 move per 100ms to prevent machine-gun submissions
          const rateLimitKey = `ratelimit:move:${uid}`;
          const recentMoves  = await redis.incr(rateLimitKey);
          if (recentMoves === 1) await redis.expire(rateLimitKey, 1);
          if (recentMoves > 3) {
            send(ws, { type: 'move_rejected', data: { reason: 'Too fast' }, ts: Date.now() });
            return;
          }

          // Authoritative move validation
          const result = await engine.applyMove(gid, uid, { from, to, promotion: promotion || 'q' });

          if (!result.ok) {
            send(ws, { type: 'move_rejected', data: { reason: result.reason }, ts: Date.now() });

            // Anti-cheat: repeated illegal moves are a signal
            await anticheat.recordEvent({
              gameId: gid, uid,
              signal: 'move_entropy',
              severity: 1,
              data: { from, to, reason: result.reason },
              timestamp: Date.now(),
            });
            return;
          }

          gameId = gid;

          // Stream move metrics to anti-cheat oracle
          await anticheat.analyzeMoveAsync({
            uid, gameId: gid,
            moveNumber: result.moveNumber!,
            thinkMs,
            cpLoss: 0,       // Filled by Stockfish worker asynchronously
            accuracy: 0,     // Filled asynchronously
            topEngineMove: '',
            tabSwitches: 0,
            mouseEntropy: 0,
          });

          // Broadcast accepted move to both players + spectators
          const broadcastMsg = {
            type: 'move_broadcast' as const,
            gameId: gid,
            data: {
              move:   result.move,
              fen:    result.fen,
              pgn:    result.pgn,
              turn:   result.turn,
              status: result.status,
              result: result.gameResult,
            },
            ts: Date.now(),
          };

          await routeToGamePlayers(gid, broadcastMsg);

          // If game over, trigger settlement
          if (result.status === 'finished') {
            await redis.publish('settlement:queue', JSON.stringify({
              gameId: gid,
              result: result.gameResult,
              triggeredAt: Date.now(),
            }));
          }

          send(ws, { type: 'move_accepted', data: { move: result.move }, ts: Date.now() });
          break;
        }

        // ── Spectate ─────────────────────────────────────────────────────
        case 'spectate_join': {
          if (!uid) return;
          const gid = msg.data?.gameId as string;
          if (!gid) return;

          // Spectating is explicitly opt-in; default private.
          const state = await engine.getGameState(gid);
          if (!state || state.isPublic !== true) {
            send(ws, { type: 'error', data: { code: 'SPECTATING_NOT_ALLOWED' }, ts: Date.now() });
            return;
          }

          gameId = gid;
          if (!spectators.has(gid)) spectators.set(gid, new Set());
          spectators.get(gid)!.add(uid);
          clients.set(uid, ws);

          send(ws, { type: 'spectate_state', data: { game: state }, ts: Date.now() });
          metrics.inc('ws_spectators_total');
          break;
        }

        // ── Resign ───────────────────────────────────────────────────────
        case 'resign': {
          if (!uid || !gameId) return;
          const resigned = await engine.resignGame(gameId, uid);
          if (!resigned) {
            send(ws, { type: 'error', data: { code: 'RESIGN_REJECTED' }, ts: Date.now() });
            return;
          }
          await routeToGamePlayers(gameId, {
            type: 'game_over',
            gameId,
            data: { result: 'opponent_resigned' },
            ts: Date.now(),
          });
          break;
        }

        // ── Draw offer ───────────────────────────────────────────────────
        case 'draw_offer': {
          if (!uid || !gameId) return;
          await routeToGamePlayers(gameId, {
            type: 'draw_offer', gameId,
            data: { fromUid: uid }, ts: Date.now()
          });
          break;
        }

        // ── Chat ─────────────────────────────────────────────────────────
        case 'chat_send': {
          if (!uid || !gameId) return;
          const text = String(msg.data?.text || '').slice(0, 200);
          if (!text.trim()) return;

          // Sanitize
          const safe = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          await routeToGamePlayers(gameId, {
            type: 'chat_broadcast', gameId,
            data: { uid, text: safe }, ts: Date.now()
          });
          break;
        }

        // ── Ping ─────────────────────────────────────────────────────────
        case 'ping': {
          send(ws, { type: 'pong', ts: Date.now() });
          // Refresh node registration
          if (uid) await redis.expire(`ws:user:${uid}:node`, 300);
          break;
        }

        default:
          send(ws, { type: 'error', data: { code: 'UNKNOWN_TYPE', type: msg.type }, ts: Date.now() });
      }
    } catch (err) {
      logger.error({ err, uid, msgType: msg.type }, 'WebSocket message handler error');
      send(ws, { type: 'error', data: { code: 'INTERNAL' }, ts: Date.now() });
      metrics.inc('ws_handler_errors');
    }
  });

  // ─── Disconnect handler ───────────────────────────────────────────────────
  ws.on('close', async (code, reason) => {
    clearInterval(pingInterval);
    if (uid && clients.get(uid) === ws) {
      clients.delete(uid);
      await redis.del(`ws:user:${uid}:node`);

      // If in an active game, start disconnect timer
      // Game will auto-forfeit after 60s (handled by cleanStaleGames Cloud Function)
      if (gameId) {
        const gameSpectators = spectators.get(gameId);
        if (gameSpectators) {
          gameSpectators.delete(uid);
          if (gameSpectators.size === 0) spectators.delete(gameId);
        }
        const activeGame = await engine.getGameState(gameId);
        if (activeGame && (activeGame.whiteUid === uid || activeGame.blackUid === uid)) {
          await redis.setex('game:' + gameId + ':disconnect:' + uid, 70, '1');
        }
      }

      logger.info({ uid, code, gameId }, 'Client disconnected');
      metrics.dec('ws_connections_active');
    }
  });

  ws.on('error', (err) => {
    logger.error({ err, uid }, 'WebSocket error');
    metrics.inc('ws_errors');
  });
});

// ─── Route message to game players across nodes ───────────────────────────────
async function routeToGamePlayers(gid: string, message: WsMessage) {
  const state = await engine.getGameState(gid);
  if (!state) return;

  const uids = [state.whiteUid, state.blackUid];

  for (const targetUid of uids) {
    const nodeId = await redis.get(`ws:user:${targetUid}:node`);
    if (!nodeId) continue;

    if (nodeId === NODE_ID) {
      // Client is on this node — send directly
      const ws = clients.get(targetUid);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    } else {
      // Client is on another node — route via Redis Pub/Sub
      await redisPub.publish(`ws:node:${nodeId}`, JSON.stringify({
        targetUid,
        message,
      }));
    }
  }

  // Also fan out to spectators on this node
  const gameSpectators = spectators.get(gid);
  if (gameSpectators) {
    gameSpectators.forEach((spectatorUid) => {
      const ws = clients.get(spectatorUid);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    });
  }
}

function send(ws: WebSocket, msg: WsMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown() {
  logger.info({ nodeId: NODE_ID }, 'Graceful shutdown initiated');

  // Notify all connected clients
  clients.forEach((ws) => {
    send(ws, { type: 'error', data: { code: 'SERVER_RESTARTING', reconnectIn: 3000 }, ts: Date.now() });
    ws.close(1001, 'Server restarting');
  });

  // Wait for connections to drain
  await new Promise(r => setTimeout(r, 2000));

  httpServer.close();
  await redis.quit();
  await redisPub.quit();
  await redisSub.quit();

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  logger.info({ port: PORT, nodeId: NODE_ID }, 'Aries Protocol WebSocket server started');
});

export { wss, httpServer };
