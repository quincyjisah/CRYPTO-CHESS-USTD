import { Chess, type Move } from "chess.js";
import type Redis from "ioredis";
import {
  appendLedgerEntry,
  getLedger,
  replayGame,
  type MoveSignature,
} from "./ledger";
import { analyzeMove } from "./oracle";
import { publishGameEvent, REDIS_KEYS } from "./redisBus";

export const GAME_TTL_SECONDS = 7 * 24 * 60 * 60;
const MOVE_RATE_WINDOW_SECONDS = 2;
const MAX_MOVES_PER_WINDOW = 4;

export interface PlayerSeat {
  userId: string;
  color: "w" | "b";
}

export interface GameState {
  gameId: string;
  fen: string;
  players: PlayerSeat[];
  version: number;
  status: "active" | "checkmate" | "draw" | "resigned";
  updatedAt: number;
  lastMoveAt?: number;
  lastMoveSan?: string;
}

export interface CreateGameInput {
  gameId: string;
  whiteUserId: string;
  blackUserId: string;
}

export interface SubmitMoveInput {
  gameId: string;
  userId: string;
  move: string;
  idempotencyKey: string;
  clientTimestamp?: number;
  signature?: MoveSignature;
}

export interface SubmitMoveResult {
  state: GameState;
  move: Move;
  ledgerHash: string;
}

export async function createGame(
  redis: Redis,
  input: CreateGameInput,
): Promise<GameState> {
  const state: GameState = {
    gameId: input.gameId,
    fen: new Chess().fen(),
    players: [
      { userId: input.whiteUserId, color: "w" },
      { userId: input.blackUserId, color: "b" },
    ],
    version: 0,
    status: "active",
    updatedAt: Date.now(),
  };

  await redis.set(
    REDIS_KEYS.game(input.gameId),
    JSON.stringify(state),
    "EX",
    GAME_TTL_SECONDS,
  );
  await publishGameEvent(redis, {
    type: "game.created",
    gameId: input.gameId,
    payload: state,
    timestamp: state.updatedAt,
  });
  return state;
}

export async function getGame(
  redis: Redis,
  gameId: string,
): Promise<GameState | null> {
  const raw = await redis.get(REDIS_KEYS.game(gameId));
  return raw ? (JSON.parse(raw) as GameState) : null;
}

export async function submitMove(
  redis: Redis,
  input: SubmitMoveInput,
): Promise<SubmitMoveResult> {
  await enforceRateLimit(redis, input.userId);

  const duplicateKey = `move:dedupe:${input.gameId}:${input.idempotencyKey}`;
  const isFirstAttempt = await redis.set(duplicateKey, "1", "EX", 300, "NX");
  if (!isFirstAttempt) {
    throw new Error("Duplicate move rejected.");
  }

  const lockKey = `lock:game:${input.gameId}`;
  const lockToken = `${input.userId}:${Date.now()}`;
  const lockAcquired = await redis.set(lockKey, lockToken, "PX", 2_000, "NX");
  if (!lockAcquired) {
    throw new Error("Game is busy; retry move submission.");
  }

  try {
    const state = await getGame(redis, input.gameId);
    if (!state) {
      throw new Error(`Game ${input.gameId} not found.`);
    }
    if (state.status !== "active") {
      throw new Error(`Game ${input.gameId} is not active.`);
    }

    const chess = new Chess(state.fen);
    const expectedColor = chess.turn();
    const seat = state.players.find((player) => player.userId === input.userId);
    if (!seat) {
      throw new Error("User is not seated in this game.");
    }
    if (seat.color !== expectedColor) {
      throw new Error("It is not this user's turn.");
    }

    const legalMoveCount = chess.moves().length;
    const move = chess.move(input.move);
    if (!move) {
      throw new Error("Illegal chess move.");
    }

    const now = Date.now();
    const nextState: GameState = {
      ...state,
      fen: chess.fen(),
      version: state.version + 1,
      status: chess.isCheckmate()
        ? "checkmate"
        : chess.isDraw()
          ? "draw"
          : "active",
      updatedAt: now,
      lastMoveAt: now,
      lastMoveSan: move.san,
    };

    const ledgerEntry = await appendLedgerEntry(redis, {
      gameId: input.gameId,
      userId: input.userId,
      san: move.san,
      lan: move.lan,
      fen: nextState.fen,
      moveNumber: nextState.version,
      signature: input.signature,
    });

    await redis.set(
      REDIS_KEYS.game(input.gameId),
      JSON.stringify(nextState),
      "EX",
      GAME_TTL_SECONDS,
    );
    await redis.expire(REDIS_KEYS.ledger(input.gameId), GAME_TTL_SECONDS);
    await redis.expire(REDIS_KEYS.gameStream(input.gameId), GAME_TTL_SECONDS);

    const oracleAssessment = await analyzeMove(redis, {
      gameId: input.gameId,
      userId: input.userId,
      san: move.san,
      legalMoveCount,
      elapsedMsSincePreviousMove: state.lastMoveAt
        ? now - state.lastMoveAt
        : Number.POSITIVE_INFINITY,
      clientTimestamp: input.clientTimestamp,
      serverTimestamp: now,
    });

    await publishGameEvent(redis, {
      type: "move.accepted",
      gameId: input.gameId,
      payload: {
        state: nextState,
        move,
        ledgerHash: ledgerEntry.hash,
        oracleAssessment,
      },
      timestamp: now,
    });

    return { state: nextState, move, ledgerHash: ledgerEntry.hash };
  } finally {
    const unlockScript = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
    await redis.eval(unlockScript, 1, lockKey, lockToken);
  }
}

export async function recoverStateFromLedger(
  redis: Redis,
  gameId: string,
): Promise<string> {
  return replayGame(await getLedger(redis, gameId));
}

export async function enforceRateLimit(
  redis: Redis,
  userId: string,
): Promise<void> {
  const key = REDIS_KEYS.userRate(userId);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, MOVE_RATE_WINDOW_SECONDS);
  }
  if (count > MAX_MOVES_PER_WINDOW) {
    throw new Error("Rate limit exceeded.");
  }
}
