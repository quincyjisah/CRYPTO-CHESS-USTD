export function formatUsdt(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(amount)
    .replace("$", "")
    .concat(" USDT");
}

export function getEscrowTotal(match: { stakeUsdt: number }): number {
  return match.stakeUsdt * 2;
}
