/**
 * Monetary tournament flows remain disabled until an audited escrow/payout
 * implementation is deployed. Keep this predicate shared by every callable.
 */
export function isFreeOnlyTerms(entryFee: unknown, currency: unknown): boolean {
  return typeof entryFee === 'number'
    && Number.isFinite(entryFee)
    && entryFee === 0
    && currency === 'FREE';
}
