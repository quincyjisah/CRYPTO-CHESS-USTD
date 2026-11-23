/**
 * ws/gameEngine.ts — Aries Protocol Authoritative Game Engine
 *
 * This is the ONLY place chess moves are validated and applied.
 * No client can bypass this. No result is trusted from the client.
 *
 * State machine:
 *   waiting → active → finished
 *                    → disputed (fraud detected)
 *                    → aborted  (both disconnected)
 */

import { Chess } from 'chess.js';
import { createHash, randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import type { GameSession, ChessMove, Color } from '../shared/types';
import { logger } from '../shared/logger';
import { metrics } from '../shared/metrics';

const GAME_TTL_SECS = 60 * 60 * 6; // 6 hours — games expire from Redis

export interface MoveResult {
  ok:          boolean;
  reason?:     string;
  move?:       ChessMove;
  fen?:        string;
  pgn?:        string;
  turn?:       Color;
  status?:     string;
  gameResult?: Color | 'draw' | null;
  moveNumber?: number;
}

export class GameEngine {
  constructor(private redis: Redis) {}

  // ─── Create game ────────────────────────────────────────────────────────────
  async createGame(session: Omit<GameSession, 'moves' | 'fen' | 'pgn' | 'turn' | 'status' | 'result' | 'endReason' | 'settled' | 'createdAt' | 'lastMoveAt'>): Promise<GameSession> {
    if (session.wager !== 0) {
      throw new Error('Paid games are disabled until a verified escrow integration is deployed.');
    }
    if (!session.whiteUid || !session.blackUid || session.whiteUid === session.blackUid) {
      throw new Error('A game requires two distinct authenticated players.');
    }

    const game = new Chess();
    const now  = Date.now();

    const fullSession: GameSession = {
      ...session,
      initialFen: game.fen(),
      isPublic: session.isPublic === true,
      moves:     [],
      fen:       game.fen(),
      pgn:       '',
      turn:      'white',
      status:    'active',
      result:    null,
      endReason: null,
      settled:   false,
      createdAt: now,
      lastMoveAt: now,
    };

    await this.saveGameState(fullSession);

    // Track active game for each player
    await this.redis.setex(`user:${session.whiteUid}:activeGame`, GAME_TTL_SECS, session.gameId);
    await this.redis.setex(`user:${session.blackUid}:activeGame`, GAME_TTL_SECS, session.gameId);

    metrics.inc('games_created_total');
    logger.info({ gameId: session.gameId }, 'Game created');

    return fullSession;
  }

  // ─── Apply move (authoritative) ─────────────────────────────────────────────
  async applyMove(
    gameId: string,
    uid: string,
    { from, to, promotion }: { from: string; to: string; promotion?: string }
  ): Promise<MoveResult> {
    // Use Redis optimistic locking to prevent race conditions
    const lockKey  = `game:${gameId}:lock`;

    // Acquire distributed lock (100ms timeout)
    const lockValue = uid + ':' + randomUUID();
    const locked    = await this.redis.set(lockKey, lockValue, 'PX', 5_000, 'NX');
    if (!locked) {
      return { ok: false, reason: 'Move in progress — try again' };
    }

    try {
      const state = await this.getGameState(gameId);
      if (!state) return { ok: false, reason: 'Game not found' };

      // Validate game state
      if (state.status !== 'active')  return { ok: false, reason: 'Game is not active' };
      if (state.settled)              return { ok: false, reason: 'Game already settled' };

      // Validate it is this player's turn
      const isWhite = state.whiteUid === uid;
      const isBlack = state.blackUid === uid;
      if (!isWhite && !isBlack)       return { ok: false, reason: 'You are not a player' };
      if (isWhite && state.turn !== 'white') return { ok: false, reason: 'Not your turn' };
      if (isBlack && state.turn !== 'black') return { ok: false, reason: 'Not your turn' };

      // Verify the append-only hash chain before replaying moves.
      if (!this.verifyLedgerChain(state.moves)) {
        await this.abortGameLocked(state, 'corrupted_ledger');
        return { ok: false, reason: 'Move ledger integrity check failed' };
      }

      // Reconstruct position from move history (replay from initial FEN)
      const game = new Chess(state.initialFen);
      for (const m of state.moves) {
        const r = game.move(m.san);
        if (!r) {
          logger.error({ gameId }, 'Move history corrupted — aborting game');
          await this.abortGameLocked(state, 'corrupted_history');
          return { ok: false, reason: 'Move history corrupted' };
        }
      }

      // Validate the proposed move
      const moveResult = game.move({ from: from as any, to: to as any, promotion });
      if (!moveResult) return { ok: false, reason: 'Illegal move' };

      // Compute ledger chain hash: SHA256(prevHash + san + fen)
      const prevHash  = state.moves.length > 0 ? state.moves[state.moves.length - 1].hash : '0';
      const newHash   = createHash('sha256')
        .update(`${prevHash}:${moveResult.san}:${game.fen()}`)
        .digest('hex');

      const chessMove: ChessMove = {
        from:      moveResult.from,
        to:        moveResult.to,
        promotion: moveResult.promotion,
        san:       moveResult.san,
        fen:       game.fen(),
        timestamp: Date.now(),
        thinkMs:   0,   // Set by WS server from client data
        hash:      newHash,
      };

      // Determine game outcome
      let status: GameSession['status']     = 'active';
      let result: GameSession['result']     = null;
      let endReason: GameSession['endReason'] = null;

      if (game.isGameOver()) {
        status = 'finished';
        if (game.isCheckmate()) {
          result    = isWhite ? 'white' : 'black';
          endReason = 'checkmate';
        } else if (game.isDraw()) {
          result    = 'draw';
          endReason = game.isStalemate()            ? 'stalemate'
                    : game.isInsufficientMaterial() ? 'insufficient_material'
                    : game.isThreefoldRepetition()  ? 'threefold_repetition'
                    : 'fifty_move_rule';
        }
      }

      // Update state
      const updatedState: GameSession = {
        ...state,
        moves:     [...state.moves, chessMove],
        fen:       game.fen(),
        pgn:       game.pgn(),
        turn:      game.turn() === 'w' ? 'white' : 'black',
        status,
        result,
        endReason,
        lastMoveAt: Date.now(),
      };

      await this.saveGameState(updatedState);

      if (status === 'finished') {
        // Clear active game references
        await this.redis.del(`user:${state.whiteUid}:activeGame`);
        await this.redis.del(`user:${state.blackUid}:activeGame`);
        metrics.inc('games_finished_total');
        logger.info({ gameId, result, endReason }, 'Game finished');
      }

      metrics.inc('moves_total');
      return {
        ok: true,
        move: chessMove,
        fen: game.fen(),
        pgn: game.pgn(),
        turn: game.turn() === 'w' ? 'white' : 'black',
        status,
        gameResult: result,
        moveNumber: state.moves.length + 1,
      };

    } finally {
      // Always release lock
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockValue,
      );
    }
  }

  // ─── Resign ────────────────────────────────────────────────────────────────
  async resignGame(gameId: string, uid: string): Promise<boolean> {
    const lockKey = 'game:' + gameId + ':lock';
    const lockValue = uid + ':' + randomUUID();
    const locked = await this.redis.set(lockKey, lockValue, 'PX', 5_000, 'NX');
    if (!locked) return false;

    try {
      const state = await this.getGameState(gameId);
      if (!state || state.status !== 'active' || state.settled) return false;

      const isWhite = state.whiteUid === uid;
      const isBlack = state.blackUid === uid;
      if (!isWhite && !isBlack) return false;

      const winner = isWhite ? 'black' : 'white';
      const updated: GameSession = {
        ...state,
        status: 'finished',
        result: winner,
        endReason: 'resign',
        lastMoveAt: Date.now(),
      };

      await this.saveGameState(updated);
      await this.redis.del('user:' + state.whiteUid + ':activeGame');
      await this.redis.del('user:' + state.blackUid + ':activeGame');

      logger.info({ gameId, uid, winner }, 'Game resigned');
      metrics.inc('games_resigned_total');
      return true;
    } finally {
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockValue,
      );
    }
  }

  // ─── Abort (both players disconnected / fraud) ───────────────────────────────
  async abortGame(gameId: string, reason: string): Promise<void> {
    const lockKey = 'game:' + gameId + ':lock';
    const lockValue = 'abort:' + randomUUID();
    const locked = await this.redis.set(lockKey, lockValue, 'PX', 5_000, 'NX');
    if (!locked) return;

    try {
      const state = await this.getGameState(gameId);
      if (!state || state.status !== 'active' || state.settled) return;
      await this.abortGameLocked(state, reason);
    } finally {
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockValue,
      );
    }
  }

  private async abortGameLocked(state: GameSession, reason: string): Promise<void> {
    const updated: GameSession = {
      ...state,
      status: 'aborted',
      endReason: reason,
      lastMoveAt: Date.now(),
    };

    await this.saveGameState(updated);
    await this.redis.del('user:' + state.whiteUid + ':activeGame');
    await this.redis.del('user:' + state.blackUid + ':activeGame');

    logger.warn({ gameId: state.gameId, reason }, 'Game aborted');
    metrics.inc('games_aborted_total');
  }

  // ─── State persistence ─────────────────────────────────────────────────────
  async getGameState(gameId: string): Promise<GameSession | null> {
    const raw = await this.redis.get(`game:${gameId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      logger.error({ gameId }, 'Failed to parse game state from Redis');
      return null;
    }
  }

  async saveGameState(state: GameSession): Promise<void> {
    await this.redis.setex(`game:${state.gameId}`, GAME_TTL_SECS, JSON.stringify(state));
  }

  // ─── Verify ledger integrity ───────────────────────────────────────────────
  verifyLedgerChain(moves: ChessMove[]): boolean {
    let prevHash = '0';
    for (const move of moves) {
      const expected = createHash('sha256')
        .update(`${prevHash}:${move.san}:${move.fen}`)
        .digest('hex');
      if (expected !== move.hash) return false;
      prevHash = move.hash;
    }
    return true;
  }
}
