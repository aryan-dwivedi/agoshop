import { Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const sseClientsGauge = new Gauge({
  name: 'sse_clients',
  help: 'SSE connections held by this process',
  registers: [registry],
});
