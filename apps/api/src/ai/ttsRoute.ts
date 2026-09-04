import { timingSafeEqual } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import { resolveElevenLabsVoiceId, synthesizeElevenLabsSpeech } from './elevenLabsTts.js';
import { env } from '../env.js';
import { AppError, badRequest, unauthorized } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * OpenAI-compatible text-to-speech for Agora ConvoAI BYOK TTS.
 *
 * Agora POSTs here with the shared secret. Uses ElevenLabs when `ELEVENLABS_API_KEY`
 * is set; otherwise falls back to OpenAI when `OPENAI_API_KEY` is set.
 */

export const router = Router();

const speechBody = z.object({
  model: z.string().optional(),
  input: z.string().min(1).max(4096),
  voice: z.string().optional(),
  language: z.string().min(2).max(16).optional(),
  response_format: z.enum(['mp3', 'wav', 'aac', 'opus', 'flac', 'pcm']).optional(),
  speed: z.number().min(0.5).max(2).optional(),
});

const CONTENT_TYPES: Record<NonNullable<z.infer<typeof speechBody>['response_format']>, string> =
  {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    aac: 'audio/aac',
    opus: 'audio/ogg',
    flac: 'audio/flac',
    pcm: 'audio/pcm',
  };

const authorized = (header: string | undefined): boolean => {
  const expected = env.CONVOAI_TTS_API_KEY || env.CONVO_LLM_SHARED_SECRET;
  const presented = (header ?? '').replace(/^Bearer\s+/i, '');
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
};

const ttsEngine = (): 'elevenlabs' | 'openai' | null => {
  if (env.ELEVENLABS_API_KEY) return 'elevenlabs';
  if (env.OPENAI_API_KEY) return 'openai';
  return null;
};

const synthesizeOpenAi = async (
  body: z.infer<typeof speechBody>,
  format: NonNullable<z.infer<typeof speechBody>['response_format']>,
  signal: AbortSignal,
): Promise<Buffer> => {
  const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: body.model ?? env.CONVOAI_TTS_MODEL,
      input: body.input,
      voice: body.voice ?? env.CONVOAI_TTS_VOICE,
      response_format: format,
      speed: body.speed ?? env.CONVOAI_TTS_SPEED,
    }),
    signal,
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    logger.warn({ status: upstream.status, detail: detail.slice(0, 300) }, 'openai tts failed');
    throw new AppError(502, 'tts_upstream_failed', `OpenAI TTS returned ${upstream.status}`);
  }

  return Buffer.from(await upstream.arrayBuffer());
};

router.post('/api/ai/tts/speech', async (req, res, next) => {
  const abort = new AbortController();
  req.once('aborted', () => abort.abort());

  try {
    if (!authorized(req.header('authorization') ?? req.header('api-key'))) {
      throw unauthorized('tts_unauthorized');
    }

    const engine = ttsEngine();
    if (!engine) {
      throw new AppError(
        503,
        'tts_unconfigured',
        'voice TTS requires ELEVENLABS_API_KEY or OPENAI_API_KEY',
      );
    }

    const parsed = speechBody.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('invalid_body', parsed.error.issues[0]?.message);
    }

    const format = parsed.data.response_format ?? 'pcm';
    let audio: Buffer;

    if (engine === 'elevenlabs') {
      try {
        audio = await synthesizeElevenLabsSpeech({
          input: parsed.data.input,
          voiceId: resolveElevenLabsVoiceId(parsed.data.voice),
          modelId: parsed.data.model ?? env.CONVOAI_TTS_MODEL,
          speed: parsed.data.speed ?? env.CONVOAI_TTS_SPEED,
          format,
          signal: abort.signal,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ detail: message.slice(0, 300) }, 'elevenlabs tts failed');
        throw new AppError(502, 'tts_upstream_failed', 'ElevenLabs TTS request failed');
      }
    } else {
      audio = await synthesizeOpenAi(parsed.data, format, abort.signal);
    }

    if (abort.signal.aborted) return;
    res.setHeader('content-type', CONTENT_TYPES[format]);
    res.setHeader('content-length', String(audio.byteLength));
    res.setHeader('cache-control', 'no-store');
    res.status(200).end(audio);
    logger.info(
      { chars: parsed.data.input.length, bytes: audio.byteLength, engine, format },
      'tts synthesized',
    );
  } catch (err) {
    if (!abort.signal.aborted) next(err);
  }
});
