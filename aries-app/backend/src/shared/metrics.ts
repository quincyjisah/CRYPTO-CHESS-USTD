// shared/metrics.ts — Prometheus metrics for Grafana observability
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

const counters: Map<string, Counter> = new Map();
const gauges:   Map<string, Gauge>   = new Map();

function getOrCreateCounter(name: string): Counter {
  if (!counters.has(name)) {
    const c = new Counter({
      name:    `aries_${name.replace(/[^a-z0-9_]/g, '_')}`,
      help:    name,
      registers: [registry],
    });
    counters.set(name, c);
  }
  return counters.get(name)!;
}

function getOrCreateGauge(name: string): Gauge {
  if (!gauges.has(name)) {
    const g = new Gauge({
      name:    `aries_${name.replace(/[^a-z0-9_]/g, '_')}`,
      help:    name,
      registers: [registry],
    });
    gauges.set(name, g);
  }
  return gauges.get(name)!;
}

export const metrics = {
  inc:        (name: string, value = 1)  => getOrCreateCounter(name).inc(value),
  gauge:      (name: string, value: number) => getOrCreateGauge(name).set(value),
  dec:        (name: string, value = 1)  => getOrCreateGauge(name).dec(value),
  prometheus: () => registry.metrics(),
};
