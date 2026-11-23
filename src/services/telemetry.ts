export interface TelemetryConfig {
  sentryDsn?: string;
  posthogKey?: string;
  posthogHost?: string;
  environment: "development" | "staging" | "production";
}

let activeConfig: TelemetryConfig | null = null;

export function initTelemetry(config: TelemetryConfig): void {
  activeConfig = config;

  if (config.sentryDsn) {
    console.warn("[telemetry] sentry initialized", {
      environment: config.environment,
    });
  }

  if (config.posthogKey) {
    console.warn("[telemetry] posthog initialized", {
      host: config.posthogHost ?? "https://app.posthog.com",
    });
  }
}

export function captureTelemetryEvent(
  event: string,
  properties: Record<string, unknown> = {},
): void {
  if (!activeConfig) return;
  console.warn("[telemetry] event", { event, properties });
}
