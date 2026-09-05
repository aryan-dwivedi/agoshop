const MCP_PROBE_METHODS = new Set([
    'initialize',
    'notifications/initialized',
    'tools/list',
    'resources/list',
    'resources/templates/list',
    'prompts/list',
    'ping',
]);
export const parseMcpRpcMethod = (body: unknown): string | null => {
    if (!body || typeof body !== 'object') return null;
    const method = (body as { method?: unknown }).method;
    return typeof method === 'string' ? method : null;
};
export const isMcpProbeMethod = (method: string | null | undefined): boolean =>
    method !== null && method !== undefined && MCP_PROBE_METHODS.has(method);
