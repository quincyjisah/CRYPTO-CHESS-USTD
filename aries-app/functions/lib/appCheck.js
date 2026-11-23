"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAppCheckEnforced = isAppCheckEnforced;
/**
 * Keep App Check opt-in for local development, but explicit and centrally
 * applied to every callable function. Set ENFORCE_APP_CHECK=true only after
 * the matching web App Check provider is configured in Firebase.
 */
function isAppCheckEnforced(value) {
    return value === 'true';
}
//# sourceMappingURL=appCheck.js.map