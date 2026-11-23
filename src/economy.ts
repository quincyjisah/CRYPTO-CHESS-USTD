export const PLATFORM_FEE_BASIS_POINTS = 200;
export const BASIS_POINTS_DENOMINATOR = 10_000;

export interface MatchEconomyInput {
  playerStakeUsdt: number;
  playerCount?: 2;
  platformFeeBasisPoints?: number;
}

export interface MatchEconomyBreakdown {
  playerStakeUsdt: number;
  totalEscrowUsdt: number;
  platformFeeUsdt: number;
  winnerPayoutUsdt: number;
  platformFeeBasisPoints: number;
}

export function calculateMatchEconomy({
  playerStakeUsdt,
  playerCount = 2,
  platformFeeBasisPoints = PLATFORM_FEE_BASIS_POINTS,
}: MatchEconomyInput): MatchEconomyBreakdown {
  if (!Number.isFinite(playerStakeUsdt) || playerStakeUsdt <= 0) {
    throw new Error("Player stake must be a positive finite number.");
  }

  if (playerCount !== 2) {
    throw new Error("Only two-player wager matches are supported.");
  }

  if (
    !Number.isInteger(platformFeeBasisPoints) ||
    platformFeeBasisPoints < 0 ||
    platformFeeBasisPoints > BASIS_POINTS_DENOMINATOR
  ) {
    throw new Error(
      "Platform fee must be an integer between 0 and 10,000 basis points.",
    );
  }

  const totalEscrowUsdt = roundUsdt(playerStakeUsdt * playerCount);
  const platformFeeUsdt = roundUsdt(
    (totalEscrowUsdt * platformFeeBasisPoints) / BASIS_POINTS_DENOMINATOR,
  );
  const winnerPayoutUsdt = roundUsdt(totalEscrowUsdt - platformFeeUsdt);

  return {
    playerStakeUsdt: roundUsdt(playerStakeUsdt),
    totalEscrowUsdt,
    platformFeeUsdt,
    winnerPayoutUsdt,
    platformFeeBasisPoints,
  };
}

export function roundUsdt(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
