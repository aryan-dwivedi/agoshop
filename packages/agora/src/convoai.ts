import { CONVOAI_FAILURE_MESSAGE } from '@shop/ai/llmMode.js';
import { MCP_ALLOWED_TOOLS } from '@shop/ai/mcp/server.js';
import { env } from '@shop/platform/env.js';
import { AppError } from '@shop/platform/lib/errors.js';
import { logger } from '@shop/platform/lib/logger.js';

import { agoraRestFetch } from './restFetch.js';
import { agoraBasicAuth, mintAgentRtcRtmToken } from './tokens.js';

export { CONVOAI_FAILURE_MESSAGE };
const BASE = 'https://api.agora.io/api/conversational-ai-agent/v2/projects';
/** Agora managed TTS defaults — used when no Studio pipeline is configured. */
const MANAGED_TTS = {
    vendor: 'minimax',
    url: 'wss://api.minimax.io/ws/v1/t2a_v2',
    model: 'speech-2.8-turbo',
    voiceId: 'English_captivating_female1',
    speed: 1.0,
    sampleRate: 44100,
} as const;
export type ConvoAiJoinInput = {
    conversationId: string;
    channel: string;
    agentUid: number;
    viewerUid: number;
    language: string;
    systemPrompt: string;
    greeting: string;
    signature: string;
    expires: number;
};
export const buildConvoAiTtsBlock = (_language: string): Record<string, unknown> => ({
    vendor: MANAGED_TTS.vendor,
    credential_mode: 'managed',
    params: {
        url: MANAGED_TTS.url,
        model: MANAGED_TTS.model,
        voice_setting: {
            voice_id: MANAGED_TTS.voiceId,
            speed: MANAGED_TTS.speed,
        },
        audio_setting: {
            sample_rate: MANAGED_TTS.sampleRate,
        },
    },
});
const studioPipelineId = (): string => {
    if (process.env.AGORA_STUDIO_PIPELINE_ID !== undefined) {
        return process.env.AGORA_STUDIO_PIPELINE_ID.trim();
    }
    return env.AGORA_STUDIO_PIPELINE_ID;
};
const buildChannelProperties = (input: ConvoAiJoinInput): Record<string, unknown> => ({
    channel: input.channel,
    token: mintAgentRtcRtmToken(input.channel, input.agentUid),
    agent_rtc_uid: String(input.agentUid),
    remote_rtc_uids: [String(input.viewerUid)],
    enable_string_uid: false,
    idle_timeout: env.CONVOAI_IDLE_TIMEOUT_SECONDS,
});
const buildStudioProperties = (input: ConvoAiJoinInput): Record<string, unknown> =>
    buildChannelProperties(input);
const buildProgrammaticLlmBlock = (input: ConvoAiJoinInput): Record<string, unknown> => {
    const mcpEndpoint = `${env.PUBLIC_API_URL.replace(/\/$/, '')}/mcp`;
    const authHeaders = {
        'X-Convo-Id': input.conversationId,
        'X-Convo-Expires': String(input.expires),
        'X-Convo-Signature': input.signature,
    };
    return {
        credential_mode: 'managed',
        vendor: 'openai',
        style: 'openai',
        url: 'https://api.openai.com/v1/chat/completions',
        params: {
            model: env.AGORA_MANAGED_LLM_MODEL,
            temperature: 0.4,
            max_tokens: 160,
        },
        mcp_servers: [
            {
                name: 'shop',
                endpoint: mcpEndpoint,
                transport: 'streamable_http',
                headers: authHeaders,
                allowed_tools: MCP_ALLOWED_TOOLS,
            },
        ],
        system_messages: [
            {
                role: 'system',
                content: input.systemPrompt,
            },
        ],
        greeting_message: input.greeting,
        greeting_configs: {
            interruptable: false,
        },
        failure_message: CONVOAI_FAILURE_MESSAGE,
        max_history: 24,
    };
};
const buildProgrammaticProperties = (input: ConvoAiJoinInput): Record<string, unknown> => ({
    ...buildChannelProperties(input),
    advanced_features: {
        enable_rtm: true,
        enable_tools: true,
    },
    parameters: {
        data_channel: 'rtm',
        audio_scenario: 'chorus',
        enable_metrics: true,
        enable_error_message: true,
    },
    turn_detection: {
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
    },
    interruption: {
        enable: true,
        mode: 'start_of_speech',
    },
    geofence: { area: 'INDIA' },
    llm: buildProgrammaticLlmBlock(input),
});
export const buildConvoAiJoinBody = (input: ConvoAiJoinInput): Record<string, unknown> => {
    const pipelineId = studioPipelineId();
    if (pipelineId) {
        return {
            name: `convo-${input.conversationId}`,
            pipeline_id: pipelineId,
            properties: buildStudioProperties(input),
        };
    }
    return {
        name: `convo-${input.conversationId}`,
        properties: {
            ...buildProgrammaticProperties(input),
            asr: {
                vendor: 'ares',
                language: input.language,
            },
            tts: buildConvoAiTtsBlock(input.language),
        },
    };
};
type ConvoAiRequest = {
    method: 'POST' | 'GET';
    path: string;
    body?: unknown;
    tolerateNotFound?: boolean;
};
const call = async (
    req: ConvoAiRequest,
): Promise<{
    status: number;
    json: unknown;
}> => {
    const auth = agoraBasicAuth();
    if (!auth) throw new AppError(503, 'convoai_unconfigured');
    let response: Response;
    try {
        response = await agoraRestFetch(`${BASE}/${env.AGORA_APP_ID}${req.path}`, {
            method: req.method,
            headers: {
                Authorization: auth,
                ...(req.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body: req.body === undefined ? undefined : JSON.stringify(req.body),
            signal: AbortSignal.timeout(20000),
        });
    } catch (err) {
        logger.error({ err, path: req.path }, 'convoai request failed');
        throw new AppError(502, 'convoai_unreachable');
    }
    const text = await response.text();
    let json: unknown = null;
    if (text.length > 0) {
        try {
            json = JSON.parse(text);
        } catch {
            json = { raw: text.slice(0, 1024) };
        }
    }
    if (response.ok) return { status: response.status, json };
    if (response.status === 404 && req.tolerateNotFound) return { status: 404, json };
    if (response.status === 422 || response.status === 429) {
        logger.warn({ path: req.path, body: json }, 'convoai capacity exhausted');
        throw new AppError(503, 'ai_capacity', 'ConvoAI concurrency cap reached', {
            agora: json,
        });
    }
    logger.error(
        { path: req.path, status: response.status, body: json },
        'convoai rejected request',
    );
    throw new AppError(502, 'convoai_join_failed', `Agora returned ${response.status}`, {
        agora: json,
    });
};
const JOIN_CONFLICT_LOOKUP_DELAYS_MS = [0, 150, 500, 1000] as const;
const recoverConflictingJoin = async (
    err: unknown,
): Promise<{
    agentId: string;
} | null> => {
    if (!(err instanceof AppError) || err.code !== 'convoai_join_failed') return null;
    const agora = err.details?.agora as
        | {
              agent_id?: unknown;
              reason?: unknown;
          }
        | null
        | undefined;
    if (
        agora?.reason !== 'TaskConflict' ||
        typeof agora.agent_id !== 'string' ||
        agora.agent_id.length === 0
    ) {
        return null;
    }
    for (const delayMs of JOIN_CONFLICT_LOOKUP_DELAYS_MS) {
        if (delayMs > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
        const { status, json } = await call({
            method: 'GET',
            path: `/agents/${encodeURIComponent(agora.agent_id)}`,
            tolerateNotFound: true,
        });
        if (status === 404) continue;
        const agent = json as {
            agent_id?: unknown;
            status?: unknown;
        } | null;
        const agentId =
            typeof agent?.agent_id === 'string' && agent.agent_id.length > 0
                ? agent.agent_id
                : agora.agent_id;
        logger.warn(
            { agentId, agentStatus: agent?.status },
            'recovered existing convoai agent after join conflict',
        );
        return { agentId };
    }
    return null;
};
export const joinConvoAiAgent = async (
    input: ConvoAiJoinInput,
): Promise<{
    agentId: string;
}> => {
    let json: unknown;
    try {
        ({ json } = await call({
            method: 'POST',
            path: '/join',
            body: buildConvoAiJoinBody(input),
        }));
    } catch (err) {
        const recovered = await recoverConflictingJoin(err);
        if (recovered) return recovered;
        throw err;
    }
    const agentId = (
        json as {
            agent_id?: unknown;
        } | null
    )?.agent_id;
    if (typeof agentId !== 'string' || agentId.length === 0) {
        throw new AppError(502, 'convoai_join_failed', 'join response carried no agent_id', {
            agora: json,
        });
    }
    logger.info(
        {
            conversationId: input.conversationId,
            agentId,
            studioPipeline: studioPipelineId() || null,
        },
        'convoai agent joined',
    );
    return { agentId };
};
export const leaveConvoAiAgent = async (agentId: string): Promise<void> => {
    await call({
        method: 'POST',
        path: `/agents/${encodeURIComponent(agentId)}/leave`,
        body: {},
        tolerateNotFound: true,
    });
};
export const interruptConvoAiAgent = async (agentId: string): Promise<void> => {
    await call({
        method: 'POST',
        path: `/agents/${encodeURIComponent(agentId)}/interrupt`,
        body: {},
        tolerateNotFound: true,
    });
};
export const speakConvoAiAgent = async (
    agentId: string,
    a: {
        text: string;
        priority?: 'INTERRUPT' | 'APPEND' | 'IGNORE';
        interruptable?: boolean;
    },
): Promise<void> => {
    await call({
        method: 'POST',
        path: `/agents/${encodeURIComponent(agentId)}/speak`,
        body: {
            text: a.text,
            priority: a.priority ?? 'APPEND',
            interruptable: a.interruptable ?? true,
        },
    });
};
export const getConvoAiAgent = async (
    agentId: string,
): Promise<{
    agentId: string;
    status: string;
    startTs?: number;
} | null> => {
    const { status, json } = await call({
        method: 'GET',
        path: `/agents/${encodeURIComponent(agentId)}`,
        tolerateNotFound: true,
    });
    if (status === 404) return null;
    const row = json as {
        agent_id?: string;
        status?: string;
        start_ts?: number;
    } | null;
    if (!row) return null;
    return {
        agentId: row.agent_id ?? agentId,
        status: row.status ?? 'UNKNOWN',
        startTs: row.start_ts,
    };
};
