/**
 * replay/service.ts — Aries Protocol Replay Persistence Service
 *
 * Responsibilities:
 *  - Persist completed game replays to Firestore (permanent) and Redis (hot cache)
 *  - Generate PGN (Portable Game Notation) for export
 *  - Serve move-by-move timeline for the replay viewer
 *  - Store accuracy scores, blunder counts, move heatmaps
 *  - Feed into the AI coaching analysis pipeline
 *
 * Storage strategy:
 *  - Redis: last 10,000 replays (hot cache, 7-day TTL)
 *  - Firestore: all replays (permanent, indexed by player)
 *  - Cold storage: GCS bucket for replays > 30 days old
 */

import type { Redis }   from 'ioredis';
import type { GameSession, ReplayRecord } from '../shared/types';
import { logger }  from '../shared/logger';
import { metrics } from '../shared/metrics';

const REPLAY_HOT_TTL  = 60 * 60 * 24 * 7;  // 7 days in Redis
const MAX_HOT_REPLAYS = 10_000;

export class ReplayService {
  constructor(private redis: Redis) {}

  // ─── Persist completed game as replay ───────────────────────────────────────
  async persistReplay(session: GameSession): Promise<ReplayRecord> {
    // Compute accuracy from Stockfish results stored in Redis
    const [whiteAccuracy, blackAccuracy] = await Promise.all([
      this.getAccuracy(session.gameId, session.whiteUid),
      this.getAccuracy(session.gameId, session.blackUid),
    ]);

    const [whiteBlunders, blackBlunders] = await Promise.all([
      this.getBlunders(session.gameId, session.whiteUid),
      this.getBlunders(session.gameId, session.blackUid),
    ]);

    const [whiteTopPct, blackTopPct] = await Promise.all([
      this.getTopMovePct(session.gameId, session.whiteUid),
      this.getTopMovePct(session.gameId, session.blackUid),
    ]);

    const replay: ReplayRecord = {
      gameId:      session.gameId,
      pgn:         session.pgn,
      moves:       session.moves,
      whiteHandle: session.whiteHandle,
      blackHandle: session.blackHandle,
      wager:       session.wager,
      currency:    session.currency,
      result:      session.result ?? 'unknown',
      endReason:   session.endReason ?? 'unknown',
      accuracy:    { white: whiteAccuracy, black: blackAccuracy },
      topMovePct:  { white: whiteTopPct,   black: blackTopPct   },
      blunders:    { white: whiteBlunders, black: blackBlunders  },
      playedAt:    session.createdAt,
      durationMs:  session.lastMoveAt - session.createdAt,
      isPublic:    true,
    };

    // Save to Redis hot cache
    await this.saveToRedis(replay);

    // Publish to Firestore write queue (async — handled by Cloud Function)
    await this.redis.lpush('replay:persist_queue', JSON.stringify(replay));
    await this.redis.ltrim('replay:persist_queue', 0, 99999);

    // Index this replay for each player
    await this.redis.zadd(
      `replays:player:${session.whiteUid}`,
      session.createdAt,
      session.gameId
    );
    await this.redis.zadd(
      `replays:player:${session.blackUid}`,
      session.createdAt,
      session.gameId
    );

    // Clean up analysis data from Redis (no longer needed)
    await Promise.all([
      this.redis.del(`anticheat:timing:${session.gameId}:${session.whiteUid}`),
      this.redis.del(`anticheat:timing:${session.gameId}:${session.blackUid}`),
      this.redis.del(`anticheat:engine:${session.gameId}:${session.whiteUid}`),
      this.redis.del(`anticheat:engine:${session.gameId}:${session.blackUid}`),
      this.redis.del(`game:${session.gameId}:disconnect:${session.whiteUid}`),
      this.redis.del(`game:${session.gameId}:disconnect:${session.blackUid}`),
    ]);

    metrics.inc('replays_persisted_total');
    logger.info({ gameId: session.gameId }, 'Replay persisted');
    return replay;
  }

  // ─── Get replay ────────────────────────────────────────────────────────────
  async getReplay(gameId: string): Promise<ReplayRecord | null> {
    const raw = await this.redis.get(`replay:${gameId}`);
    return raw ? JSON.parse(raw) : null;
  }

  // ─── Get player's recent replays ──────────────────────────────────────────
  async getPlayerReplays(uid: string, limit = 20): Promise<ReplayRecord[]> {
    // Get most recent game IDs
    const gameIds = await this.redis.zrevrange(`replays:player:${uid}`, 0, limit - 1);

    const replays = await Promise.all(
      gameIds.map(id => this.getReplay(id))
    );

    return replays.filter(Boolean) as ReplayRecord[];
  }

  // ─── Generate PGN ─────────────────────────────────────────────────────────
  generatePGN(replay: ReplayRecord): string {
    const date = new Date(replay.playedAt);
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '.');

    const headers = [
      `[Event "Aries Protocol Wager Match"]`,
      `[Site "ariesprotocol.app"]`,
      `[Date "${dateStr}"]`,
      `[Round "?"]`,
      `[White "${replay.whiteHandle}"]`,
      `[Black "${replay.blackHandle}"]`,
      `[Result "${this.resultToPGN(replay.result)}"]`,
      `[TimeControl "300+3"]`,
      `[Termination "${replay.endReason}"]`,
      `[WhiteAccuracy "${replay.accuracy.white.toFixed(1)}"]`,
      `[BlackAccuracy "${replay.accuracy.black.toFixed(1)}"]`,
      `[Wager "${replay.wager} ${replay.currency}"]`,
      ``,
    ].join('\n');

    return headers + replay.pgn;
  }

  // ─── Move timeline for replay viewer ─────────────────────────────────────
  getMoveTimeline(replay: ReplayRecord): {
    moveNumber: number;
    san:        string;
    fen:        string;
    thinkMs:    number;
    timestamp:  number;
  }[] {
    return replay.moves.map((move, index) => ({
      moveNumber: index + 1,
      san:        move.san,
      fen:        move.fen,
      thinkMs:    move.thinkMs,
      timestamp:  move.timestamp,
    }));
  }

  // ─── Redis save ────────────────────────────────────────────────────────────
  private async saveToRedis(replay: ReplayRecord): Promise<void> {
    await this.redis.setex(`replay:${replay.gameId}`, REPLAY_HOT_TTL, JSON.stringify(replay));

    // Track global recent games (for discovery / spectator lobby)
    await this.redis.zadd('replays:recent', replay.playedAt, replay.gameId);
    await this.redis.zremrangebyrank('replays:recent', 0, -(MAX_HOT_REPLAYS + 1));
  }

  // ─── Analytics helpers ────────────────────────────────────────────────────
  private async getAccuracy(gameId: string, uid: string): Promise<number> {
    const raw = await this.redis.get(`accuracy:${gameId}:${uid}`);
    return raw ? parseFloat(raw) : 0;
  }

  private async getBlunders(gameId: string, uid: string): Promise<number> {
    const raw = await this.redis.get(`blunders:${gameId}:${uid}`);
    return raw ? parseInt(raw, 10) : 0;
  }

  private async getTopMovePct(gameId: string, uid: string): Promise<number> {
    const raw = await this.redis.get(`topmove_pct:${gameId}:${uid}`);
    return raw ? parseFloat(raw) : 0;
  }

  private resultToPGN(result: string): string {
    if (result === 'white') return '1-0';
    if (result === 'black') return '0-1';
    if (result === 'draw')  return '1/2-1/2';
    return '*';
  }
}
