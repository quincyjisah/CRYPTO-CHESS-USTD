"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFreeOnlyTerms = isFreeOnlyTerms;
/**
 * Monetary tournament flows remain disabled until an audited escrow/payout
 * implementation is deployed. Keep this predicate shared by every callable.
 */
function isFreeOnlyTerms(entryFee, currency) {
    return typeof entryFee === 'number'
        && Number.isFinite(entryFee)
        && entryFee === 0
        && currency === 'FREE';
}
//# sourceMappingURL=safety.js.map
