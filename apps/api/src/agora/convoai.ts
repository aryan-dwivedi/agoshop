import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  getConversationLlmMode,
  setConversationLlmMode,
  CONVOAI_FAILURE_MESSAGE,
  type LlmMode,
} from '../ai/llmMode.js';
import { MCP_ALLOWED_TOOLS } from '../mcp/server.js';
import { agoraBasicAuth } from './tokens.js';
import { mintAgentRtcRtmToken } from './tokens.js';
import { agoraRestFetch } from './restFetch.js';

export { CONVOAI_FAILURE_MESSAGE };

/**
 * Conversational AI Engine REST v2 client + join-body builder.
 *
 * The lifecycle (admission control, conversation rows, language switching) belongs to
 * `ai/conversations.ts`; this module owns only the wire contract, which must match the
 * verified schema exactly:
 *  - managed ASR plus direct custom-LLM PCM in the default mode; optional MCP mode
 *    retains the separate OpenAI-compatible TTS endpoint;
 *  - a combined RTC+RTM **agent** token whose account equals `agent_rtc_uid`, required
 *    by `advanced_features.enable_rtm`;
 *  - a single entry in `remote_rtc_uids` ("currently, only one user ID is supported");
 *  - `parameters.data_channel:"rtm"`, so transcripts arrive on the Signaling channel
 *    named exactly the RTC channel;
 *  - the signed callback headers — authorization never reads `Authorization`;
 *  - current nested turn detection, explicit interruption, and a buffered greeting so
 *    speech that begins during startup is retained instead of racing the first audio turn.
 */

const BASE = 'https://api.agora.io/api/conversational-ai-agent/v2/projects';

export type ConvoAiLlmMode = LlmMode;

export type ConvoAiJoinInput = {
  conversationId: string;
  /** `aiChannelForConversation(conversationId)` — the private per-viewer channel. */
  channel: string;
  agentUid: number;
  viewerUid: number;
  /**
   * ASR language, e.g. `en-US` | `hi-IN` | `es-ES`. A CONCRETE code only: recognition is
   * configured before the shopper speaks, so the caller must resolve the `auto` sentinel
   * into a best guess first.
   */
  language: string;
  systemPrompt: string;
  greeting: string;
  callbackUrl: string;
  /** `base64url(HMAC-SHA256(secret, "<conversationId>.<expires>"))`. */
  signature: string;
  /** Unix seconds. */
  expires: number;
};

/**
 * Pure and separately testable: the join body is the single riskiest payload in the
 * project, so it is built without touching the network.
 */
export const buildConvoAiJoinBody = (
  input: ConvoAiJoinInput,
  llmMode: ConvoAiLlmMode,
): Record<string, unknown> => {
  const mcpEndpoint =
    env.MCP_ENDPOINT_URL.replace(/\/$/, '') || `${env.PUBLIC_API_URL.replace(/\/$/, '')}/mcp`;

  const authHeaders = {
    'X-Convo-Id': input.conversationId,
    'X-Convo-Expires': String(input.expires),
    'X-Convo-Signature': input.signature,
  };

  // Speech during the startup greeting is queued and becomes the first user turn.
  // Without this, immediate speech interrupts startup and can trigger the configured
  // failure message before the agent has completed its first TTS turn.
  const greetingConfigs = {
    interruptable: false,
  };

  const llm =
    llmMode === 'mcp'
      ? {
          // Omitting this silently selects BYOK. We intentionally do not hold an
          // OpenAI key here; Agora supplies it for the managed MCP path.
          credential_mode: 'managed',
          vendor: env.AGORA_MANAGED_LLM_VENDOR,
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
            { role: 'system', content: input.systemPrompt || env.CONVOAI_SYSTEM_PROMPT },
          ],
          greeting_message: input.greeting,
          greeting_configs: greetingConfigs,
          failure_message: CONVOAI_FAILURE_MESSAGE,
          max_history: 24,
        }
      : {
          vendor: 'custom',
          style: 'openai',
          url: input.callbackUrl,
          api_key: input.signature,
          headers: authHeaders,
          input_modalities: ['text'],
          output_modalities: ['audio'],
          system_messages: [{ role: 'system', content: input.systemPrompt }],
          greeting_message: input.greeting,
          greeting_configs: greetingConfigs,
          failure_message: CONVOAI_FAILURE_MESSAGE,
          max_history: 24,
          params: {
            model: env.LLM_MODEL,
            temperature: 0.4,
            max_tokens: 160,
            modalities: ['audio'],
            audio: { voice: env.CONVOAI_TTS_VOICE, format: 'pcm' },
          },
        };

  return {
    name: `convo-${input.conversationId}`,
    properties: {
      channel: input.channel,
      token: mintAgentRtcRtmToken(input.channel, input.agentUid),
      agent_rtc_uid: String(input.agentUid),
      remote_rtc_uids: [String(input.viewerUid)],
      enable_string_uid: false,
      idle_timeout: env.CONVOAI_IDLE_TIMEOUT_SECONDS,
      advanced_features: {
        enable_rtm: true,
        ...(llmMode === 'mcp' ? { enable_tools: true } : {}),
      },
      parameters: {
        data_channel: 'rtm',
        // Verified by the live project; other documented profiles are rejected by
        // older ConvoAI REST deployments before the agent joins.
        audio_scenario: 'chorus',
        enable_metrics: true,
        enable_error_message: true,
      },
      // Detect short replies quickly while the agent is listening. During playback,
      // require sustained speech for barge-in so clicks and echo do not cut the answer.
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
          // Semantic EoS closes complete replies such as "yes" after a short pause, but
          // keeps listening through an unfinished thought. Agora falls back to its VAD
          // default for languages semantic detection does not support.
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
      geofence: { area: env.CONVOAI_GEOFENCE_AREA },
      asr: {
        vendor: env.CONVOAI_ASR_VENDOR,
        language: input.language,
      },
      ...(llmMode === 'mcp'
        ? {
            tts: {
              vendor: env.CONVOAI_TTS_VENDOR,
              params: {
                url: env.CONVOAI_TTS_URL || `${env.PUBLIC_API_URL}/api/ai/tts/speech`,
                api_key: env.CONVOAI_TTS_API_KEY || env.CONVO_LLM_SHARED_SECRET,
                model: env.CONVOAI_TTS_MODEL,
                voice: env.CONVOAI_TTS_VOICE,
                language: input.language,
                speed: env.CONVOAI_TTS_SPEED,
                response_format: 'pcm',
                sample_rate: 24_000,
              },
            },
          }
        : {}),
      llm,
    },
  };
};

type ConvoAiRequest = {
  method: 'POST' | 'GET';
  path: string;
  body?: unknown;
  /** 404 is a normal answer for `get` and for a `leave` that already happened. */
  tolerateNotFound?: boolean;
};

const call = async (req: ConvoAiRequest): Promise<{ status: number; json: unknown }> => {
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
      signal: AbortSignal.timeout(20_000),
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

  // Documented capacity errors: 422 ResourceQuotaLimitExceeded and 429.
  if (response.status === 422 || response.status === 429) {
    logger.warn({ path: req.path, body: json }, 'convoai capacity exhausted');
    throw new AppError(503, 'ai_capacity', 'ConvoAI concurrency cap reached', {
      agora: json,
    });
  }
  logger.error({ path: req.path, status: response.status, body: json }, 'convoai rejected request');
  throw new AppError(502, 'convoai_join_failed', `Agora returned ${response.status}`, {
    agora: json,
  });
};

const JOIN_CONFLICT_LOOKUP_DELAYS_MS = [0, 150, 500, 1_000] as const;

const recoverConflictingJoin = async (
  err: unknown,
  llmMode: ConvoAiLlmMode,
): Promise<{ agentId: string; llmMode: ConvoAiLlmMode } | null> => {
  if (!(err instanceof AppError) || err.code !== 'convoai_join_failed') return null;

  const agora = err.details?.agora as { agent_id?: unknown; reason?: unknown } | null | undefined;
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

    const agent = json as { agent_id?: unknown; status?: unknown } | null;
    const agentId =
      typeof agent?.agent_id === 'string' && agent.agent_id.length > 0
        ? agent.agent_id
        : agora.agent_id;
    logger.warn(
      { agentId, agentStatus: agent?.status, llmMode },
      'recovered existing convoai agent after join conflict',
    );
    return { agentId, llmMode };
  }

  return null;
};

const joinWithMode = async (
  input: ConvoAiJoinInput,
  llmMode: ConvoAiLlmMode,
): Promise<{ agentId: string; llmMode: ConvoAiLlmMode }> => {
  let json: unknown;
  try {
    ({ json } = await call({
      method: 'POST',
      path: '/join',
      body: buildConvoAiJoinBody(input, llmMode),
    }));
  } catch (err) {
    const recovered = await recoverConflictingJoin(err, llmMode);
    if (recovered) return recovered;
    throw err;
  }
  const agentId = (json as { agent_id?: unknown } | null)?.agent_id;
  if (typeof agentId !== 'string' || agentId.length === 0) {
    throw new AppError(502, 'convoai_join_failed', 'join response carried no agent_id', {
      agora: json,
    });
  }
  return { agentId, llmMode };
};

/**
 * Joins a ConvoAI agent. When the deployment default is MCP, tries managed LLM + MCP
 * tools first and falls back to the custom completions callback on join failure.
 * A per-conversation Redis override (`custom`) skips MCP entirely.
 */
export const joinConvoAiAgent = async (
  input: ConvoAiJoinInput,
  opts?: { forceMode?: ConvoAiLlmMode },
): Promise<{ agentId: string; llmMode: ConvoAiLlmMode }> => {
  const resolved = opts?.forceMode ?? (await getConversationLlmMode(input.conversationId));

  if (resolved === 'custom' || env.CONVOAI_LLM_MODE === 'custom') {
    return joinWithMode(input, 'custom');
  }

  try {
    const joined = await joinWithMode(input, 'mcp');
    logger.info(
      { conversationId: input.conversationId, llmMode: 'mcp' },
      'convoai agent joined with mcp llm',
    );
    return joined;
  } catch (err) {
    if (err instanceof AppError && err.code === 'ai_capacity') throw err;
    logger.warn(
      { err, conversationId: input.conversationId },
      'convoai mcp join failed; falling back to custom llm',
    );
    await setConversationLlmMode(input.conversationId, 'custom');
    const joined = await joinWithMode(input, 'custom');
    logger.info(
      { conversationId: input.conversationId, llmMode: 'custom' },
      'convoai agent joined with custom llm after mcp fallback',
    );
    return joined;
  }
};

/**
 * Idempotent best-effort stop. Agora returns an empty 200; an agent that already left
 * (idle timeout, webhook 102, a concurrent stop) answers 404, which is success here.
 */
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

/** `text` is capped at 512 bytes by the API. */
export const speakConvoAiAgent = async (
  agentId: string,
  a: { text: string; priority?: 'INTERRUPT' | 'APPEND' | 'IGNORE'; interruptable?: boolean },
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
): Promise<{ agentId: string; status: string; startTs?: number } | null> => {
  const { status, json } = await call({
    method: 'GET',
    path: `/agents/${encodeURIComponent(agentId)}`,
    tolerateNotFound: true,
  });
  if (status === 404) return null;
  const row = json as { agent_id?: string; status?: string; start_ts?: number } | null;
  if (!row) return null;
  return {
    agentId: row.agent_id ?? agentId,
    status: row.status ?? 'UNKNOWN',
    startTs: row.start_ts,
  };
};
