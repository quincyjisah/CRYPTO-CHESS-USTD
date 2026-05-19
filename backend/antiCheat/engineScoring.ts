export interface MoveSignal {
  gameId: string;
  userId: string;
  moveNumber: number;
  timingMs: number;
  engineRank: number;
  legalMoveCount: number;
  centipawnLoss?: number;
  expectedMoveUci?: string;
  playedMoveUci?: string;
}

export interface SuspicionScore {
  score: number;
  reasons: string[];
  metrics: {
    fastMoveRate: number;
    topEngineRate: number;
    lowCplRate: number;
    expectedMoveMatchRate: number;
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

export function calculateSuspicionScore(signals: MoveSignal[]): SuspicionScore {
  const reasons: string[] = [];
  if (signals.length === 0) {
    return {
      score: 0,
      reasons,
      metrics: {
        fastMoveRate: 0,
        topEngineRate: 0,
        lowCplRate: 0,
        expectedMoveMatchRate: 0,
      },
    };
  }

  const fastMoves = signals.filter(
    (signal) => signal.timingMs > 0 && signal.timingMs < 150,
  ).length;
  const topEngineMoves = signals.filter(
    (signal) => signal.legalMoveCount > 1 && signal.engineRank === 1,
  ).length;
  const nonForced = signals.filter(
    (signal) => signal.legalMoveCount > 2,
  ).length;
  const lowCplMoves = signals.filter(
    (signal) => (signal.centipawnLoss ?? 999) <= 15,
  ).length;
  const expectedMoveMatches = signals.filter(
    (signal) =>
      signal.expectedMoveUci &&
      signal.playedMoveUci &&
      signal.expectedMoveUci === signal.playedMoveUci,
  ).length;

  const fastMoveRate = ratio(fastMoves, signals.length);
  const topEngineRate = ratio(topEngineMoves, signals.length);
  const nonForcedEngineRate = ratio(topEngineMoves, Math.max(nonForced, 1));
  const lowCplRate = ratio(lowCplMoves, signals.length);
  const expectedMoveMatchRate = ratio(expectedMoveMatches, signals.length);

  let score = 0;

  if (fastMoveRate > 0.65 && signals.length >= 12) {
    score += 25;
    reasons.push("high-fast-move-rate");
  }

  if (topEngineRate > 0.8 && signals.length >= 12) {
    score += 35;
    reasons.push("high-top-engine-ratio");
  }

  if (nonForcedEngineRate > 0.9 && nonForced >= 8) {
    score += 15;
    reasons.push("non-forced-engine-linearity");
  }

  if (lowCplRate > 0.75 && signals.length >= 14) {
    score += 15;
    reasons.push("low-centipawn-loss-consistency");
  }

  if (expectedMoveMatchRate > 0.7 && signals.length >= 10) {
    score += 10;
    reasons.push("expected-engine-move-match-rate");
  }

  return {
    score: Math.min(100, score),
    reasons,
    metrics: {
      fastMoveRate,
      topEngineRate,
      lowCplRate,
      expectedMoveMatchRate,
    },
  };
}
