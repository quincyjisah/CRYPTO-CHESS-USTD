import type Redis from "ioredis";
import { REDIS_KEYS } from "./redisBus";

export interface MoveOracleInput {
  gameId: string;
  userId: string;
  san: string;
  legalMoveCount: number;
  elapsedMsSincePreviousMove: number;
  clientTimestamp?: number;
  serverTimestamp: number;
  engineRank?: number;
}

export interface OracleFinding {
  code: "IMPOSSIBLE_TIMING" | "CLOCK_SKEW" | "ENGINE_LIKE_STREAK";
  severity: "low" | "medium" | "high";
  message: string;
}

export interface OracleAssessment {
  suspicious: boolean;
  findings: OracleFinding[];
}

const MIN_HUMAN_MOVE_MS = 120;
const MAX_CLOCK_SKEW_MS = 30_000;
const ENGINE_STREAK_THRESHOLD = 8;

export async function analyzeMove(
  redis: Redis,
  input: MoveOracleInput,
): Promise<OracleAssessment> {
  const findings: OracleFinding[] = [];

  if (
    input.elapsedMsSincePreviousMove > 0 &&
    input.elapsedMsSincePreviousMove < MIN_HUMAN_MOVE_MS
  ) {
    findings.push({
      code: "IMPOSSIBLE_TIMING",
      severity: "high",
      message: `Move ${input.san} arrived in ${input.elapsedMsSincePreviousMove}ms.`,
    });
  }

  if (
    input.clientTimestamp &&
    Math.abs(input.serverTimestamp - input.clientTimestamp) > MAX_CLOCK_SKEW_MS
  ) {
    findings.push({
      code: "CLOCK_SKEW",
      severity: "medium",
      message: "Client timestamp differs too far from server authority time.",
    });
  }

  const streakKey = `oracle:engine-streak:${input.gameId}:${input.userId}`;
  if (input.engineRank === 1 && input.legalMoveCount > 1) {
    const streak = await redis.incr(streakKey);
    await redis.expire(streakKey, 86_400);
    if (streak >= ENGINE_STREAK_THRESHOLD) {
      findings.push({
        code: "ENGINE_LIKE_STREAK",
        severity: "medium",
        message: `User has ${streak} consecutive top-ranked moves in non-forced positions.`,
      });
    }
  } else {
    await redis.del(streakKey);
  }

  if (findings.length > 0) {
    await flagSuspiciousUser(redis, input.userId, findings);
  }

  return { suspicious: findings.length > 0, findings };
}

export async function flagSuspiciousUser(
  redis: Redis,
  userId: string,
  findings: OracleFinding[],
): Promise<void> {
  await redis.rpush(
    REDIS_KEYS.suspiciousUser(userId),
    JSON.stringify({ findings, timestamp: Date.now() }),
  );
  await redis.expire(REDIS_KEYS.suspiciousUser(userId), 30 * 86_400);
}
