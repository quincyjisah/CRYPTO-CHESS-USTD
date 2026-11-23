/**
 * protocol.ts — Aries Protocol fee constants and settlement maths
 *
 * FEE MODEL (correct):
 *   Both players wager equal amounts. The pot is the sum of both wagers.
 *   Aries Protocol takes 2% of the total pot from the WINNER only.
 *   The loser receives nothing. The winner receives the pot minus 2%.
 *
 * Example — each player wagers 10 USDT:
 *   Pot            = 10 + 10 = 20 USDT
 *   Protocol fee   = 20 × 0.02 = 0.40 USDT  (paid by winner)
 *   Winner payout  = 20 − 0.40 = 19.60 USDT
 *   Loser payout   = 0 USDT
 *   Protocol earns = 0.40 USDT
 *
 * On a draw (stalemate / insufficient material / repetition):
 *   Each player is refunded their original wager in full.
 *   No fee is charged on draws.
 *
 * Owner wallet (fee recipient): quincy.j.isah@gmail.com
 * On-chain fee wallet: set VITE_TREASURY_ADDRESS in .env.local
 */

/** 2% of the total pot, charged to the winner only */
export const PROTOCOL_FEE_RATE = 0.02;

/**
 * Calculate settlement amounts for a decisive match.
 *
 * @param wagerPerPlayer  Each player's individual wager (must be equal)
 * @returns               Fee and winner payout in the same currency
 */
export function calcSettlement(wagerPerPlayer: number): {
  pot: number;
  fee: number;
  winnerPayout: number;
  loserPayout: number;
} {
  const pot = wagerPerPlayer * 2;
  const fee = +(pot * PROTOCOL_FEE_RATE).toFixed(6);
  const winnerPayout = +(pot - fee).toFixed(6);
  return { pot, fee, winnerPayout, loserPayout: 0 };
}

/**
 * Calculate settlement amounts for a draw.
 * No fee on draws — each player gets their wager back in full.
 */
export function calcDrawSettlement(wagerPerPlayer: number): {
  pot: number;
  fee: number;
  eachRefund: number;
} {
  const pot = wagerPerPlayer * 2;
  return { pot, fee: 0, eachRefund: wagerPerPlayer };
}

/**
 * Human-readable fee summary for display in UI tooltips and receipts.
 * e.g. "Winner pays 0.40 USDT (2% of 20 USDT pot)"
 */
export function feeLabel(wagerPerPlayer: number, currency: string): string {
  const { pot, fee } = calcSettlement(wagerPerPlayer);
  return `Winner pays ${fee.toFixed(2)} ${currency} (2% of ${pot.toFixed(2)} ${currency} pot)`;
}
