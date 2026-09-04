import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConvoAiLlmMode } from '../agora/convoai.js';

if (!process.env.PUBLIC_API_URL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // CI supplies these values directly and has no repository .env file.
  }
}

// The module parses env at evaluation time, so this test intentionally loads it only
// after supplying the same repository env that server entry points receive.
const { buildConvoAiJoinBody, buildConvoAiTtsBlock, joinConvoAiAgent } = await import(
  '../agora/convoai.js'
);

const input = {
  conversationId: '00000000-0000-4000-8000-000000000001',
  channel: 'ai-00000000-0000-4000-8000-000000000001',
  agentUid: 1001,
  viewerUid: 1002,
  language: 'en-IN',
  systemPrompt: 'Help the shopper.',
  greeting: 'Hi! What can I help you find today?',
  callbackUrl: 'https://example.test/api/ai/chat/completions',
  signature: 'test-signature',
  expires: 2_000_000_000,
};
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConvoAI speech handling', () => {
  it.each<ConvoAiLlmMode>(['mcp', 'custom'])(
    'buffers startup speech and accepts short utterances in %s mode',
    (mode) => {
      const body = buildConvoAiJoinBody(input, mode) as {
        properties: {
          llm: {
            credential_mode?: string;
            greeting_configs: unknown;
            params?: { max_tokens?: number };
          };
          parameters: unknown;
          tts?: {
            params: {
              url?: string;
              api_key?: string;
              speed?: number;
              response_format?: string;
              sample_rate?: number;
            };
          };
          turn_detection: unknown;
          interruption: unknown;
        };
      };

      expect(body.properties.llm.greeting_configs).toEqual({ interruptable: false });
      expect(body.properties.parameters).toMatchObject({
        data_channel: 'rtm',
        audio_scenario: 'chorus',
      });
      expect(body.properties.tts?.params).toMatchObject({
        url: expect.stringContaining('/api/ai/tts/speech'),
        api_key: expect.any(String),
        speed: 1.6,
        response_format: 'pcm',
        sample_rate: 24_000,
      });
      expect(body.properties.turn_detection).toEqual({
        mode: 'default',
        config: {
          speech_threshold: 0.5,
          start_of_speech: {
            mode: 'vad',
            vad_config: {
              interrupt_duration_ms: 120,
              speaking_interrupt_duration_ms: 320,
              prefix_padding_ms: 800,
            },
          },
          end_of_speech: {
            mode: 'semantic',
            semantic_config: {
              silence_duration_ms: 320,
              max_wait_ms: 1200,
              pause_state_enabled: true,
            },
          },
        },
      });
      expect(body.properties.interruption).toEqual({
        enable: true,
        mode: 'start_of_speech',
      });
      expect(body.properties.llm).toMatchObject({
        params: { max_tokens: 160 },
      });
    },
  );

  it('configures the MCP LLM with Agora-managed OpenAI credentials', () => {
    const body = buildConvoAiJoinBody(input, 'mcp') as {
      properties: {
        llm: { credential_mode?: string; style?: string; url?: string };
      };
    };

    expect(body.properties.llm).toMatchObject({
      credential_mode: 'managed',
      style: 'openai',
      url: 'https://api.openai.com/v1/chat/completions',
    });
  });

  it('configures custom LLM text output with BYOK TTS', () => {
    const body = buildConvoAiJoinBody(input, 'custom') as {
      properties: {
        llm: {
          input_modalities?: string[];
          output_modalities?: string[];
          params?: { modalities?: string[]; audio?: { voice?: string; format?: string } };
        };
        tts?: { params?: { url?: string; api_key?: string; voice?: string } };
      };
    };

    expect(body.properties.llm).toMatchObject({
      input_modalities: ['text'],
      output_modalities: ['text'],
      params: { max_tokens: 160 },
    });
    expect(body.properties.llm.params?.modalities).toBeUndefined();
    expect(body.properties.tts).toMatchObject({
      params: {
        url: expect.stringContaining('/api/ai/tts/speech'),
        api_key: expect.any(String),
        voice: process.env.CONVOAI_TTS_VOICE ?? '21m00Tcm4TlvDq8ikWAM',
        response_format: 'pcm',
        sample_rate: 24_000,
      },
    });
  });

  it('builds BYOK TTS blocks with url and api_key', () => {
    expect(buildConvoAiTtsBlock('en-IN')).toMatchObject({
      params: {
        url: expect.stringContaining('/api/ai/tts/speech'),
        api_key: expect.any(String),
        voice: process.env.CONVOAI_TTS_VOICE ?? '21m00Tcm4TlvDq8ikWAM',
        response_format: 'pcm',
        sample_rate: 24_000,
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

    await expect(joinConvoAiAgent(input, { forceMode: 'custom' })).resolves.toEqual({
      agentId,
      llmMode: 'custom',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/join$/);
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(new RegExp(`/agents/${agentId}$`));
  });
});
