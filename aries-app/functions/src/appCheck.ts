/**
 * Keep App Check opt-in for local development, but explicit and centrally
 * applied to every callable function. Set ENFORCE_APP_CHECK=true only after
 * the matching web App Check provider is configured in Firebase.
 */
export function isAppCheckEnforced(value: string | undefined): boolean {
  return value === 'true';
}
