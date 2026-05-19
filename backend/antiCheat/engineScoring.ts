export interface MoveSignal {
  gameId: string;
  userId: string;
  moveNumber: number;
  timingMs: number;
  engineRank: number;
  legalMoveCount: number;
}

export interface SuspicionScore {
  score: number;
  reasons: string[];
}

export function calculateSuspicionScore(signals: MoveSignal[]): SuspicionScore {
  let score = 0;
  const reasons: string[] = [];

  const fastMoves = signals.filter(
    (signal) => signal.timingMs > 0 && signal.timingMs < 150,
  ).length;
  if (fastMoves >= 8) {
    score += 35;
    reasons.push("high-fast-move-rate");
  }

  const topEngineMoves = signals.filter(
    (signal) => signal.legalMoveCount > 1 && signal.engineRank === 1,
  ).length;
  const ratio = signals.length === 0 ? 0 : topEngineMoves / signals.length;
  if (ratio > 0.8 && signals.length >= 12) {
    score += 45;
    reasons.push("high-top-engine-ratio");
  }

  const nonForced = signals.filter(
    (signal) => signal.legalMoveCount > 2,
  ).length;
  if (nonForced > 0 && topEngineMoves / Math.max(nonForced, 1) > 0.9) {
    score += 20;
    reasons.push("non-forced-engine-linearity");
  }

  return { score: Math.min(100, score), reasons };
}
