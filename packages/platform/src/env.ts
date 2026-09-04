import { z } from 'zod';

const bool = z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean());
const int = (fallback: number) =>
    z
        .string()
        .default(String(fallback))
        .transform((v) => Number.parseInt(v, 10))
        .pipe(z.number().int());
const csv = (fallback: string) =>
    z
        .string()
        .default(fallback)
        .transform((v) =>
            v
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
        );
export const LLM_PROVIDER_IDS = ['openrouter', 'openai-compatible', 'mock'] as const;
const schema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        PORT: int(8787),
        PUBLIC_API_URL: z.string().url(),
        WEB_ORIGIN: z.string().default('http://localhost:5173'),
        DATABASE_URL: z.string().min(1),
        PG_POOL_MAX: int(20),
        REDIS_URL: z.string().min(1),
        SESSION_COOKIE_SECRET: z.string().min(16),
        RATE_LIMIT_TRUSTED_CIDRS: csv('127.0.0.1/32,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'),
        TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(1),
        AGORA_APP_ID: z.string().min(1),
        AGORA_APP_CERTIFICATE: z.string().min(1),
        AGORA_CUSTOMER_ID: z.string().default(''),
        AGORA_CUSTOMER_SECRET: z.string().default(''),
        AGORA_TOKEN_TTL_SECONDS: int(3600),
        AGORA_WEBHOOK_SECRET: z.string().default(''),
        CHAT_SERVICE_RTM_USER: z.string().default('chat-service'),
        CONVOAI_ENABLED: bool.default('true'),
        CONVOAI_MAX_CONCURRENT_AGENTS: int(15),
        CONVOAI_IDLE_TIMEOUT_SECONDS: int(120),
        CONVOAI_SUPPORTED_LANGUAGES: csv('en-US,hi-IN,es-ES'),
        CONVO_LLM_SHARED_SECRET: z.string().min(16),
        CONVO_CALLBACK_TTL_SECONDS: int(7200),
        AGORA_MANAGED_LLM_MODEL: z.string().default('gpt-4o-mini'),
        LLM_PROVIDER: z.enum(LLM_PROVIDER_IDS).default('mock'),
        LLM_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),
        LLM_API_KEY: z.string().default(''),
        LLM_MODEL: z.string().default('openai/gpt-4o-mini'),
        RECORDING_PROVIDER: z.enum(['auto', 'agora', 'browser', 'off']).default('browser'),
        RECORDING_LOCAL_DIR: z.string().default('/var/lib/live-commerce/recordings'),
        RECORDING_STORAGE_VENDOR: z.string().default(''),
        RECORDING_STORAGE_REGION: z.string().default(''),
        RECORDING_STORAGE_BUCKET: z.string().default(''),
        RECORDING_STORAGE_ACCESS_KEY: z.string().default(''),
        RECORDING_STORAGE_SECRET_KEY: z.string().default(''),
        RECORDING_STORAGE_ENDPOINT: z.string().default(''),
        RECORDING_PUBLIC_BASE_URL: z.string().default(''),
        TRANSCRIPTION_PROVIDER: z.enum(['off', 'agora']).default('agora'),
        TRANSCRIPTION_LANGUAGES: csv('en-US'),
        TRANSCRIPTION_TRANSLATE_TARGETS: csv(''),
        MEDIA_PUSH_ENABLED: bool.default('false'),
        MEDIA_PUSH_REGION: z.enum(['cn', 'ap', 'na', 'eu']).default('ap'),
        MEDIA_PUSH_RTMP_URL: z.string().default(''),
        MEDIA_PUSH_HLS_URL: z.string().default(''),
        MEDIA_GATEWAY_ENABLED: bool.default('true'),
        MEDIA_GATEWAY_REGION: z.enum(['cn', 'ap', 'na', 'eu']).default('ap'),
        MEDIA_GATEWAY_KEY_TTL_SECONDS: int(3600),
        RTC_TIER_MAX_VIEWERS: int(3),
        RTM_CHAT_SHARD_TARGET: int(2),
        ANALYTICS_DRAIN_BATCH: int(500),
        ANALYTICS_DRAIN_INTERVAL_MS: int(250),
        PRIVACY_MODE: z.enum(['standard', 'strict']).default('standard'),
        PII_REDACTION: bool.default('true'),
        TRANSCRIPT_RETENTION_DAYS: int(30),
        RECORDING_RETENTION_DAYS: int(30),
        ANALYTICS_RETENTION_DAYS: int(90),
        MAX_TOTAL_DISCOUNT_PCT: int(50),
        RECORDING_LOCAL_FILE_PURGE: bool.default('true'),
        CHECKOUT_MODE: z.enum(['sync', 'async']).default('async'),
        ORDER_RESERVATION_TTL_SECONDS: int(900),
        SEARCH_PROVIDER: z.enum(['postgres', 'opensearch']).default('postgres'),
        OPENSEARCH_URL: z.string().default(''),
        ANALYTICS_BACKLOG_WATERMARK: int(150000),
    })
    .superRefine((data, ctx) => {
        if (data.LLM_PROVIDER !== 'mock' && data.LLM_API_KEY.trim().length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['LLM_API_KEY'],
                message: 'required when LLM_PROVIDER is not mock',
            });
        }
    });
export type Env = z.infer<typeof schema>;
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    const issues = parsed.error.issues
        .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
    const registered = LLM_PROVIDER_IDS.join(', ');
    console.error(
        `Invalid configuration — refusing to start.\n${issues}\n\nRegistered LLM providers: ${registered}`,
    );
    process.exit(1);
}
export const env: Env = parsed.data;
export const isRecordingViaAgora =
    env.RECORDING_PROVIDER === 'agora' ||
    (env.RECORDING_PROVIDER === 'auto' &&
        Boolean(
            env.RECORDING_STORAGE_VENDOR &&
            env.RECORDING_STORAGE_BUCKET &&
            env.RECORDING_STORAGE_ACCESS_KEY &&
            env.RECORDING_STORAGE_SECRET_KEY,
        ));
export const features = {
    convoai: env.CONVOAI_ENABLED,
    mediaPush: env.MEDIA_PUSH_ENABLED,
    recording: env.RECORDING_PROVIDER !== 'off',
    transcription: env.TRANSCRIPTION_PROVIDER !== 'off',
};
