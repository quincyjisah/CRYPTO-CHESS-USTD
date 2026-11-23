import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { REDIS_KEYS } from "./redisBus";

export const PLATFORM_FEE_BASIS_POINTS = 200;
export const BASIS_POINTS_DENOMINATOR = 10_000;
export const DEFAULT_SYMBOL = "USDT";

export interface EscrowInput {
  gameId: string;
  whiteUserId: string;
  blackUserId: string;
  wagerAmount: number;
  symbol?: string;
}

export interface EscrowRecord extends EscrowInput {
  symbol: string;
  totalPot: number;
  platformFee: number;
  winnerPayout: number;
  status: "locked" | "settled" | "refunded";
  createdAt: number;
  settledAt?: number;
  winnerUserId?: string;
}

export interface EconomyTransaction {
  id: string;
  gameId: string;
  type: "credit" | "debit" | "fee" | "escrow_lock" | "escrow_settle" | "refund";
  userId?: string;
  amount: number;
  symbol: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export function calculateEconomy(
  wagerAmount: number,
  feeBasisPoints = PLATFORM_FEE_BASIS_POINTS,
) {
  assertPositiveAmount(wagerAmount);
  const totalPot = roundToken(wagerAmount * 2);
  const platformFee = roundToken(
    (totalPot * feeBasisPoints) / BASIS_POINTS_DENOMINATOR,
  );
  return {
    wagerAmount: roundToken(wagerAmount),
    totalPot,
    platformFee,
    winnerPayout: roundToken(totalPot - platformFee),
    feeBasisPoints,
  };
}

export async function creditSimulationFunds(
  redis: Redis,
  userId: string,
  amount: number,
  symbol = DEFAULT_SYMBOL,
): Promise<void> {
  assertPositiveAmount(amount);
  await redis.incrbyfloat(REDIS_KEYS.userFunds(userId, symbol), amount);
  await logTransaction(redis, {
    id: randomUUID(),
    gameId: "simulation-bank",
    type: "credit",
    userId,
    amount: roundToken(amount),
    symbol,
    timestamp: Date.now(),
  });
}

export async function lockEscrow(
  redis: Redis,
  input: EscrowInput,
): Promise<EscrowRecord> {
  const symbol = input.symbol ?? DEFAULT_SYMBOL;
  const economy = calculateEconomy(input.wagerAmount);
  const escrowKey = REDIS_KEYS.escrow(input.gameId);

  const existing = await redis.get(escrowKey);
  if (existing) {
    throw new Error(`Escrow already exists for game ${input.gameId}.`);
  }

  const lua = `
    local whiteKey = KEYS[1]
    local blackKey = KEYS[2]
    local escrowKey = KEYS[3]
    local amount = tonumber(ARGV[1])
    local record = ARGV[2]
    if tonumber(redis.call('GET', whiteKey) or '0') < amount then return {err='INSUFFICIENT_WHITE_FUNDS'} end
    if tonumber(redis.call('GET', blackKey) or '0') < amount then return {err='INSUFFICIENT_BLACK_FUNDS'} end
    redis.call('INCRBYFLOAT', whiteKey, -amount)
    redis.call('INCRBYFLOAT', blackKey, -amount)
    redis.call('SET', escrowKey, record)
    return 'OK'
  `;

  const record: EscrowRecord = {
    ...input,
    symbol,
    totalPot: economy.totalPot,
    platformFee: economy.platformFee,
    winnerPayout: economy.winnerPayout,
    status: "locked",
    createdAt: Date.now(),
  };

  await redis.eval(
    lua,
    3,
    REDIS_KEYS.userFunds(input.whiteUserId, symbol),
    REDIS_KEYS.userFunds(input.blackUserId, symbol),
    escrowKey,
    input.wagerAmount,
    JSON.stringify(record),
  );

  await logTransaction(redis, {
    id: randomUUID(),
    gameId: input.gameId,
    type: "escrow_lock",
    amount: economy.totalPot,
    symbol,
    timestamp: Date.now(),
    metadata: {
      players: [input.whiteUserId, input.blackUserId],
      wagerAmount: input.wagerAmount,
    },
  });

  return record;
}

export async function settleEscrow(
  redis: Redis,
  gameId: string,
  winnerUserId: string,
): Promise<EscrowRecord> {
  const escrowKey = REDIS_KEYS.escrow(gameId);
  const raw = await redis.get(escrowKey);
  if (!raw) {
    throw new Error(`Escrow not found for game ${gameId}.`);
  }

  const record = JSON.parse(raw) as EscrowRecord;
  if (record.status !== "locked") {
    throw new Error(`Escrow ${gameId} is already ${record.status}.`);
  }

  if (![record.whiteUserId, record.blackUserId].includes(winnerUserId)) {
    throw new Error("Winner must be one of the escrowed players.");
  }

  const settled: EscrowRecord = {
    ...record,
    status: "settled",
    winnerUserId,
    settledAt: Date.now(),
  };

  await redis
    .multi()
    .incrbyfloat(
      REDIS_KEYS.userFunds(winnerUserId, record.symbol),
      record.winnerPayout,
    )
    .set(escrowKey, JSON.stringify(settled))
    .exec();

  await logTransaction(redis, {
    id: randomUUID(),
    gameId,
    type: "escrow_settle",
    userId: winnerUserId,
    amount: record.winnerPayout,
    symbol: record.symbol,
    timestamp: Date.now(),
    metadata: { platformFee: record.platformFee },
  });

  await logTransaction(redis, {
    id: randomUUID(),
    gameId,
    type: "fee",
    amount: record.platformFee,
    symbol: record.symbol,
    timestamp: Date.now(),
  });

  return settled;
}

export async function logTransaction(
  redis: Redis,
  transaction: EconomyTransaction,
): Promise<void> {
  await redis.xadd(
    REDIS_KEYS.txLog,
    "MAXLEN",
    "~",
    100_000,
    "*",
    "transaction",
    JSON.stringify(transaction),
  );
}

function assertPositiveAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be positive and finite.");
  }
}

function roundToken(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
