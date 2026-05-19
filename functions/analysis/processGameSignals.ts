import {
  calculateSuspicionScore,
  type MoveSignal,
} from "../../backend/antiCheat/engineScoring";

export interface AnalysisOutput {
  gameId: string;
  userId: string;
  suspicious: boolean;
  score: number;
  reasons: string[];
  moderationQueue: "none" | "review" | "urgent";
  metrics: {
    fastMoveRate: number;
    topEngineRate: number;
    lowCplRate: number;
    expectedMoveMatchRate: number;
  };
}

function queueForScore(score: number): AnalysisOutput["moderationQueue"] {
  if (score >= 85) return "urgent";
  if (score >= 60) return "review";
  return "none";
}

export function processGameSignals(
  gameId: string,
  userId: string,
  signals: MoveSignal[],
): AnalysisOutput {
  const result = calculateSuspicionScore(signals);
  return {
    gameId,
    userId,
    suspicious: result.score >= 60,
    score: result.score,
    reasons: result.reasons,
    moderationQueue: queueForScore(result.score),
    metrics: result.metrics,
  };
}
