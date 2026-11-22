/**
 * rating/glicko2.ts — Aries Protocol Glicko-2 Rating System
 *
 * Glicko-2 is the rating system used by Lichess, FIDE, and most serious
 * chess platforms. It is superior to plain Elo because it tracks:
 *   - Rating (r)       — your skill estimate
 *   - Deviation (RD)   — confidence in the rating (high = uncertain)
 *   - Volatility (σ)   — how erratic your performance is
 *
 * RD increases when you haven't played recently (uncertainty grows).
 * RD decreases as you play more games (confidence increases).
 *
 * Rating periods: recalculated at the end of each period (e.g. weekly).
 * During a period: provisional ratings update after each game.
 *
 * Reference: Mark Glickman, "Example of the Glicko-2 system" (2012)
 * http://www.glicko.net/glicko/glicko2.pdf
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const GLICKO2_SCALE    = 173.7178;   // Converts Glicko to Glicko-2 scale
const DEFAULT_RATING   = 1500;
const DEFAULT_RD       = 350;        // High uncertainty for new players
const DEFAULT_VOLATILITY = 0.06;     // Typical starting volatility
const TAU              = 0.5;        // System constant — controls volatility change
const CONVERGENCE_TOL  = 0.000001;   // For iterative algorithm

// Rating caps
const MIN_RATING = 100;
const MAX_RATING = 3500;
const MIN_RD     = 30;
const MAX_RD     = 350;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GlickoPlayer {
  rating:     number;   // Glicko-2 rating (displayed as Elo-like number)
  rd:         number;   // Rating deviation
  volatility: number;   // Volatility σ
}

export interface GameOutcome {
  opponentRating:     number;
  opponentRd:         number;
  score:              0 | 0.5 | 1;   // 0=loss, 0.5=draw, 1=win
}

export interface RatingUpdate {
  newRating:     number;
  newRd:         number;
  newVolatility: number;
  ratingChange:  number;
  rdChange:      number;
}

// ─── Default player ───────────────────────────────────────────────────────────

export function defaultPlayer(): GlickoPlayer {
  return {
    rating:     DEFAULT_RATING,
    rd:         DEFAULT_RD,
    volatility: DEFAULT_VOLATILITY,
  };
}

// ─── Core Glicko-2 algorithm ──────────────────────────────────────────────────

/**
 * Compute updated rating for a player after a set of games in one rating period.
 *
 * @param player    The player whose rating we are updating
 * @param outcomes  Array of game outcomes in this rating period
 * @returns         Updated rating, RD, and volatility
 */
export function computeRatingUpdate(
  player:   GlickoPlayer,
  outcomes: GameOutcome[]
): RatingUpdate {
  const oldRating = player.rating;
  const oldRd     = player.rd;

  // Step 1: Convert to Glicko-2 scale
  const mu    = (player.rating     - 1500) / GLICKO2_SCALE;
  const phi   = player.rd          / GLICKO2_SCALE;
  const sigma = player.volatility;

  // If no games played this period — only RD increases (uncertainty grows)
  if (outcomes.length === 0) {
    const newPhi = Math.min(Math.sqrt(phi * phi + sigma * sigma), MAX_RD / GLICKO2_SCALE);
    const newRd  = Math.min(newPhi * GLICKO2_SCALE, MAX_RD);
    return {
      newRating:     player.rating,
      newRd,
      newVolatility: sigma,
      ratingChange:  0,
      rdChange:      newRd - oldRd,
    };
  }

  // Step 2: Compute opponent values
  const opponents = outcomes.map(o => ({
    mu_j:   (o.opponentRating - 1500) / GLICKO2_SCALE,
    phi_j:  o.opponentRd / GLICKO2_SCALE,
    score:  o.score,
  }));

  // g(φ) function
  const g = (phi_j: number) => 1 / Math.sqrt(1 + (3 * phi_j * phi_j) / (Math.PI * Math.PI));

  // E(μ, μ_j, φ_j) — expected score
  const E = (mu: number, mu_j: number, phi_j: number) =>
    1 / (1 + Math.exp(-g(phi_j) * (mu - mu_j)));

  // Step 3: Compute v (estimated variance)
  const v = 1 / opponents.reduce((sum, o) => {
    const g_phi = g(o.phi_j);
    const e     = E(mu, o.mu_j, o.phi_j);
    return sum + g_phi * g_phi * e * (1 - e);
  }, 0);

  // Step 4: Compute delta (estimated improvement)
  const delta = v * opponents.reduce((sum, o) => {
    const g_phi = g(o.phi_j);
    const e     = E(mu, o.mu_j, o.phi_j);
    return sum + g_phi * (o.score - e);
  }, 0);

  // Step 5: New volatility (iterative algorithm)
  const a    = Math.log(sigma * sigma);
  const phi2 = phi * phi;

  const f = (x: number) => {
    const ex  = Math.exp(x);
    const d2  = delta * delta;
    const num = ex * (d2 - phi2 - v - ex);
    const den = 2 * Math.pow(phi2 + v + ex, 2);
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  const d2 = delta * delta;

  if (d2 > phi2 + v) {
    B = Math.log(d2 - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  let iterations = 0;

  while (Math.abs(B - A) > CONVERGENCE_TOL && iterations < 100) {
    const C  = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; }
    else              { fA = fA / 2; }
    B  = C;
    fB = fC;
    iterations++;
  }

  const newSigma = Math.exp(A / 2);

  // Step 6: Pre-rating period RD
  const phiStar = Math.sqrt(phi2 + newSigma * newSigma);

  // Step 7: New rating and RD
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime  = mu + phiPrime * phiPrime * opponents.reduce((sum, o) => {
    return sum + g(o.phi_j) * (o.score - E(mu, o.mu_j, o.phi_j));
  }, 0);

  // Convert back from Glicko-2 scale
  const newRating = Math.max(MIN_RATING, Math.min(MAX_RATING,
    Math.round(muPrime * GLICKO2_SCALE + 1500)
  ));
  const newRd = Math.max(MIN_RD, Math.min(MAX_RD,
    Math.round(phiPrime * GLICKO2_SCALE)
  ));

  return {
    newRating,
    newRd,
    newVolatility: newSigma,
    ratingChange:  newRating - oldRating,
    rdChange:      newRd - oldRd,
  };
}

// ─── Single game update (for real-time rating display) ────────────────────────

/**
 * Quick update for a single game — used for immediate rating display.
 * Full Glicko-2 period update runs nightly.
 */
export function singleGameUpdate(
  player:           GlickoPlayer,
  opponentRating:   number,
  opponentRd:       number,
  score:            0 | 0.5 | 1
): RatingUpdate {
  return computeRatingUpdate(player, [{ opponentRating, opponentRd, score }]);
}

// ─── Rating band labels ───────────────────────────────────────────────────────

export function ratingBand(rating: number): string {
  if (rating < 800)  return 'Beginner';
  if (rating < 1000) return 'Novice';
  if (rating < 1200) return 'Amateur';
  if (rating < 1400) return 'Intermediate';
  if (rating < 1600) return 'Club Player';
  if (rating < 1800) return 'Advanced';
  if (rating < 2000) return 'Expert';
  if (rating < 2200) return 'Candidate Master';
  if (rating < 2400) return 'FIDE Master';
  if (rating < 2500) return 'International Master';
  return 'Grandmaster';
}

export function ratingColor(rating: number): string {
  if (rating < 1000) return 'text-zinc-400';
  if (rating < 1200) return 'text-green-400';
  if (rating < 1400) return 'text-blue-400';
  if (rating < 1600) return 'text-purple-400';
  if (rating < 1800) return 'text-yellow-400';
  if (rating < 2000) return 'text-orange-400';
  return 'text-red-400';
}
