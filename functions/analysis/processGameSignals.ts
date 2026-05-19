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
  };
}
