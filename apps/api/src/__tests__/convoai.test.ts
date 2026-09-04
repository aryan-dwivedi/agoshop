import { afterEach, describe, expect, it, vi } from 'vitest';

if (!process.env.PUBLIC_API_URL) {
    try {
        process.loadEnvFile('.env');
    } catch {}
}
const { buildConvoAiJoinBody, buildConvoAiTtsBlock, joinConvoAiAgent } =
    await import('@shop/agora/convoai.js');
const input = {
    conversationId: '00000000-0000-4000-8000-000000000001',
    channel: 'ai-00000000-0000-4000-8000-000000000001',
    agentUid: 1001,
    viewerUid: 1002,
    language: 'en-IN',
    systemPrompt: 'Help the shopper.',
    greeting: 'Hi! What can I help you find today?',
    signature: 'test-signature',
    expires: 2000000000,
};
afterEach(() => {
    vi.restoreAllMocks();
});
describe('ConvoAI speech handling', () => {
    it('buffers startup speech and wires managed Agora services', () => {
        const body = buildConvoAiJoinBody(input) as {
            properties: {
                llm: {
                    credential_mode?: string;
                    greeting_configs: unknown;
                    mcp_servers?: unknown[];
                    params?: { max_tokens?: number };
                };
                parameters: unknown;
                tts?: {
                    credential_mode?: string;
                    params: { voice_setting?: { speed?: number } };
                };
                turn_detection: unknown;
                interruption: unknown;
                advanced_features: { enable_tools?: boolean };
            };
        };
        expect(body.properties.llm.greeting_configs).toEqual({ interruptable: false });
        expect(body.properties.parameters).toMatchObject({
            data_channel: 'rtm',
            audio_scenario: 'chorus',
        });
        expect(body.properties.advanced_features.enable_tools).toBe(true);
        expect(body.properties.llm.mcp_servers).toHaveLength(1);
        expect(body.properties.tts?.credential_mode).toBe('managed');
        expect(body.properties.tts?.params).toMatchObject({
            model: 'speech-2.8-turbo',
            voice_setting: { speed: 1.6 },
        });
        expect(body.properties.llm).toMatchObject({ params: { max_tokens: 160 } });
    });
    it('configures the MCP LLM with Agora-managed OpenAI credentials', () => {
        const body = buildConvoAiJoinBody(input) as {
            properties: { llm: { credential_mode?: string; style?: string; url?: string } };
        };
        expect(body.properties.llm).toMatchObject({
            credential_mode: 'managed',
            style: 'openai',
            url: 'https://api.openai.com/v1/chat/completions',
        });
    });
    it('builds managed TTS blocks', () => {
        expect(buildConvoAiTtsBlock('en-IN')).toMatchObject({
            credential_mode: 'managed',
            vendor: 'minimax',
            params: {
                model: 'speech-2.8-turbo',
                voice_setting: {
                    voice_id: 'English_captivating_female1',
                    speed: 1.6,
                },
            },
        });
    });
    it('recovers the agent created before a retried join conflicts', async () => {
        const agentId = 'agent-created-by-the-first-request';
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        agent_id: agentId,
                        detail: 'A session with the same name already exists.',
                        reason: 'TaskConflict',
                    }),
                    { status: 409, headers: { 'content-type': 'application/json' } },
                ),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ agent_id: agentId, status: 'RUNNING' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            );
        await expect(joinConvoAiAgent(input)).resolves.toEqual({ agentId });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
