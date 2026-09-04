import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });
export const aiToolCallsTotal = new Counter({
    name: 'ai_tool_calls_total',
    help: 'AI tool executions by tool and outcome',
    labelNames: ['tool', 'outcome'] as const,
    registers: [registry],
});
export const aiAgentSlotsInUse = new Gauge({
    name: 'ai_agent_slots_in_use',
    help: 'ConvoAI agent leases currently held',
    registers: [registry],
});
export const promotionAppliedTotal = new Counter({
    name: 'promotion_applied_total',
    help: 'Promotions applied to an order line, by code',
    labelNames: ['code'] as const,
    registers: [registry],
});
export const llmLatencySeconds = new Histogram({
    name: 'llm_latency_seconds',
    help: 'Provider round trip, by registered provider id',
    labelNames: ['provider'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [registry],
});
export const toolLatencySeconds = new Histogram({
    name: 'tool_latency_seconds',
    help: 'Tool execution latency',
    labelNames: ['tool'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [registry],
});
export const chatMessagesTotal = new Counter({
    name: 'chat_messages_total',
    help: 'Chat messages by action (accepted, rejected, flagged)',
    labelNames: ['action'] as const,
    registers: [registry],
});
export const chatRestPublishesTotal = new Counter({
    name: 'chat_rest_publishes_total',
    help: 'Signaling REST publishes issued by the backend as chat-service',
    registers: [registry],
});
export const moderationActionsTotal = new Counter({
    name: 'moderation_actions_total',
    help: 'Moderation actions by action',
    labelNames: ['action'] as const,
    registers: [registry],
});
export const analyticsStreamBacklog = new Gauge({
    name: 'analytics_stream_backlog',
    help: 'Pending entries in the analytics Redis stream',
    registers: [registry],
});
export const searchIndexFailuresTotal = new Counter({
    name: 'search_index_failures_total',
    help: 'OpenSearch indexing failures',
    registers: [registry],
});
