import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { createGame } from "../lib/gameEngine";
import { lockEscrow } from "../lib/economy";
import { publishGameEvent, REDIS_KEYS } from "../lib/redisBus";

export interface MatchmakingTicket {
  ticketId: string;
  userId: string;
  wagerAmount: number;
  symbol: string;
  createdAt: number;
}

export interface MatchResult {
  gameId: string;
  whiteUserId: string;
  blackUserId: string;
  wagerAmount: number;
  symbol: string;
}

export function createTicket(
  userId: string,
  wagerAmount: number,
  symbol = "USDT",
): MatchmakingTicket {
  if (!Number.isFinite(wagerAmount) || wagerAmount <= 0) {
    throw new Error("Wager amount must be positive.");
  }

  return {
    ticketId: randomUUID(),
    userId,
    wagerAmount,
    symbol,
    createdAt: Date.now(),
  };
}

export async function enqueuePlayer(
  redis: Redis,
  ticket: MatchmakingTicket,
): Promise<void> {
  await redis.lpush(REDIS_KEYS.matchmakingQueue, JSON.stringify(ticket));
}

export async function runMatchmakerOnce(
  redis: Redis,
  timeoutSeconds = 5,
): Promise<MatchResult | null> {
  const first = await redis.brpop(REDIS_KEYS.matchmakingQueue, timeoutSeconds);
  if (!first) {
    return null;
  }

  const firstTicket = JSON.parse(first[1]) as MatchmakingTicket;
  const buffered: MatchmakingTicket[] = [];

  while (true) {
    const rawCandidate = await redis.rpop(REDIS_KEYS.matchmakingQueue);
    if (!rawCandidate) {
      await enqueuePlayer(redis, firstTicket);
      return null;
    }

    const candidate = JSON.parse(rawCandidate) as MatchmakingTicket;
    if (
      candidate.userId !== firstTicket.userId &&
      candidate.wagerAmount === firstTicket.wagerAmount &&
      candidate.symbol === firstTicket.symbol
    ) {
      for (const ticket of buffered) {
        await enqueuePlayer(redis, ticket);
      }

      return createMatchedGame(redis, firstTicket, candidate);
    }

    buffered.push(candidate);
    if (buffered.length > 100) {
      for (const ticket of [firstTicket, ...buffered]) {
        await enqueuePlayer(redis, ticket);
      }
      return null;
    }
  }
}

export async function createMatchedGame(
  redis: Redis,
  white: MatchmakingTicket,
  black: MatchmakingTicket,
): Promise<MatchResult> {
  const gameId = randomUUID();
  await lockEscrow(redis, {
    gameId,
    whiteUserId: white.userId,
    blackUserId: black.userId,
    wagerAmount: white.wagerAmount,
    symbol: white.symbol,
  });
  await createGame(redis, {
    gameId,
    whiteUserId: white.userId,
    blackUserId: black.userId,
  });

  const result: MatchResult = {
    gameId,
    whiteUserId: white.userId,
    blackUserId: black.userId,
    wagerAmount: white.wagerAmount,
    symbol: white.symbol,
  };

  await publishGameEvent(redis, {
    type: "match.created",
    gameId,
    payload: result,
    timestamp: Date.now(),
  });

  return result;
}

export async function startMatchmaker(redis: Redis): Promise<void> {
  for (;;) {
    await runMatchmakerOnce(redis, 5);
  }
}
