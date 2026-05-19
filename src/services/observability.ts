export interface ObservabilityEvent {
  name: string;
  level: "info" | "warn" | "error";
  metadata?: Record<string, unknown>;
}

export function trackEvent(event: ObservabilityEvent): void {
  if (event.level === "error") {
    console.error(`[obs] ${event.name}`, event.metadata ?? {});
    return;
  }
  if (event.level === "warn") {
    console.warn(`[obs] ${event.name}`, event.metadata ?? {});
    return;
  }
}
