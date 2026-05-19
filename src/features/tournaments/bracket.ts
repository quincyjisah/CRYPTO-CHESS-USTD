export interface TournamentEntrant {
  id: string;
  rating: number;
}

export interface BracketPairing {
  round: number;
  whiteId: string;
  blackId: string;
}

export function createSeededRoundOne(
  entrants: TournamentEntrant[],
): BracketPairing[] {
  if (entrants.length % 2 !== 0) {
    throw new Error("Entrant count must be even.");
  }

  const seeded = [...entrants].sort((a, b) => b.rating - a.rating);
  const pairings: BracketPairing[] = [];
  const half = seeded.length / 2;

  for (let i = 0; i < half; i += 1) {
    pairings.push({
      round: 1,
      whiteId: seeded[i].id,
      blackId: seeded[seeded.length - 1 - i].id,
    });
  }

  return pairings;
}
