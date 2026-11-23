export interface ReplayMove {
  ply: number;
  san: string;
  fen: string;
  ts: number;
}

export interface ReplaySnapshot {
  gameId: string;
  cursor: number;
  moves: ReplayMove[];
}

export function createReplaySnapshot(
  gameId: string,
  moves: ReplayMove[],
): ReplaySnapshot {
  return { gameId, cursor: Math.max(0, moves.length - 1), moves };
}

export function getReplayFrame(
  snapshot: ReplaySnapshot,
  cursor: number,
): ReplayMove | null {
  if (cursor < 0 || cursor >= snapshot.moves.length) return null;
  return snapshot.moves[cursor];
}

export function compressReplayPayload(moves: ReplayMove[]): string {
  return JSON.stringify(moves.map((m) => [m.ply, m.san, m.fen, m.ts]));
}
