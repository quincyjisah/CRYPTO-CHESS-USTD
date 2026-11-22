
export function captureError(error: unknown) {
  console.error('[Monitoring]', error);

  // Future integration:
  // Sentry.captureException(error);
}
