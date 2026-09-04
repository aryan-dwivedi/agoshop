import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Router } from 'express';
import { z } from 'zod';

import { detectLanguage } from '@shop/shared';

import { env } from '../env.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { ttsLatencySeconds } from '../lib/metrics.js';
import {
  SPEECH_CONTENT_TYPES,
  normalizeSpeechText,
  synthesizeNeuralSpeech,
  warmSpeechModel,
  type SpeechFormat,
} from './speechSynthesis.js';

/**
 * Self-hosted, OpenAI-compatible text-to-speech: `POST /api/ai/tts/speech`.
 *
 * Kokoro neural voices synthesize English, Hindi and Spanish at 24 kHz. The quantized
 * model is warmed at boot and runs in-process; eSpeak supplies multilingual phonemes
 * in Linux production. macOS native voices remain a local fallback if neural
 * synthesis is unavailable.
 */

export const router = Router();

const speechBody = z.object({
  model: z.string().optional(),
  input: z.string().min(1).max(4096),
  voice: z.string().optional(),
  /** BCP-47 hint from the client when the text alone is ambiguous (e.g. Roman Hindi). */
  language: z.string().min(2).max(16).optional(),
  response_format: z.enum(['mp3', 'wav', 'aac', 'opus', 'flac', 'pcm']).optional(),
  speed: z.number().min(0.5).max(2).optional(),
});

const SYSTEM_AUDIO_FORMATS: Record<
  SpeechFormat,
  { extension: string; ffmpegArgs: readonly string[] }
> = {
  mp3: { extension: 'mp3', ffmpegArgs: ['-codec:a', 'libmp3lame', '-q:a', '4'] },
  wav: {
    extension: 'wav',
    ffmpegArgs: ['-codec:a', 'pcm_s16le', '-ar', '24000', '-ac', '1'],
  },
  aac: {
    extension: 'aac',
    ffmpegArgs: ['-codec:a', 'aac', '-b:a', '128k', '-f', 'adts'],
  },
  opus: {
    extension: 'opus',
    ffmpegArgs: ['-codec:a', 'libopus', '-b:a', '48k', '-f', 'ogg'],
  },
  flac: {
    extension: 'flac',
    ffmpegArgs: ['-codec:a', 'flac', '-ar', '24000', '-ac', '1'],
  },
  pcm: {
    extension: 'pcm',
    ffmpegArgs: ['-codec:a', 'pcm_s16le', '-ar', '24000', '-ac', '1', '-f', 's16le'],
  },
};

const SYSTEM_LANGUAGE_VOICES: Record<string, { voice: string; wordsPerMinute: number }> = {
  'en-US': { voice: 'Samantha', wordsPerMinute: 158 },
  'en-IN': { voice: 'Tara', wordsPerMinute: 152 },
  'hi-IN': { voice: 'Lekha', wordsPerMinute: 145 },
  'es-ES': { voice: 'Mónica', wordsPerMinute: 155 },
};
const SUPPORTED_TTS = Object.keys(SYSTEM_LANGUAGE_VOICES);

const run = (bin: string, args: readonly string[]): Promise<void> => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  execFile(bin, [...args], { timeout: 20_000 }, (err) => (err ? reject(err) : resolve()));
  return promise;
};

const resolvedLanguage = (input: string, languageHint: string | undefined): string =>
  languageHint && SYSTEM_LANGUAGE_VOICES[languageHint]
    ? languageHint
    : (detectLanguage(input, SUPPORTED_TTS) ?? 'en-US');

const synthesizeSystemSpeech = async (options: {
  input: string;
  language: string;
  speed: number;
  format: SpeechFormat;
}): Promise<{ audio: Buffer; voice: string }> => {
  const scratch = join(tmpdir(), `tts-${randomUUID()}`);
  const aiff = `${scratch}.aiff`;
  const outputConfig = SYSTEM_AUDIO_FORMATS[options.format];
  const encoded = `${scratch}.${outputConfig.extension}`;
  const voiceConfig = SYSTEM_LANGUAGE_VOICES[options.language] ?? SYSTEM_LANGUAGE_VOICES['en-US']!;
  const rate = Math.round(voiceConfig.wordsPerMinute * options.speed);

  try {
    await run('say', [
      '-v',
      voiceConfig.voice,
      '-r',
      String(rate),
      '-o',
      aiff,
      normalizeSpeechText(options.input, options.language),
    ]);
    await run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      aiff,
      ...outputConfig.ffmpegArgs,
      encoded,
    ]);
    return { audio: await readFile(encoded), voice: voiceConfig.voice };
  } finally {
    await Promise.allSettled([rm(aiff, { force: true }), rm(encoded, { force: true })]);
  }
};

const authorized = (header: string | undefined): boolean => {
  const expected = env.CONVOAI_TTS_API_KEY || env.CONVO_LLM_SHARED_SECRET;
  const presented = (header ?? '').replace(/^Bearer\s+/i, '');
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
};

if (env.NODE_ENV !== 'test') {
  void warmSpeechModel()
    .then(() => logger.info('tts neural model ready'))
    .catch((err: unknown) => logger.error({ err }, 'tts neural model warmup failed'));
}

router.post('/api/ai/tts/speech', async (req, res, next) => {
  const abort = new AbortController();
  req.once('aborted', () => abort.abort());
  const started = performance.now();
  let engine = 'kokoro';
  let format: SpeechFormat = 'mp3';

  try {
    if (!authorized(req.header('authorization') ?? req.header('api-key'))) {
      throw unauthorized('tts_unauthorized');
    }

    const parsed = speechBody.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('invalid_body', parsed.error.issues[0]?.message);
    }
    const {
      input,
      voice,
      speed = env.CONVOAI_TTS_SPEED,
      response_format: requestedFormat,
      language: languageHint,
    } = parsed.data;
    format = requestedFormat ?? 'mp3';
    const language = resolvedLanguage(input, languageHint);
    const normalizedInput = normalizeSpeechText(input, language);

    let audio: Buffer;
    let selectedVoice: string;
    try {
      const synthesized = await synthesizeNeuralSpeech({
        input: normalizedInput,
        voice,
        language,
        speed,
        format,
        signal: abort.signal,
      });
      audio = synthesized.audio;
      selectedVoice = synthesized.voice;
    } catch (err) {
      if (process.platform !== 'darwin' || abort.signal.aborted) throw err;
      logger.warn({ err, language }, 'neural tts failed; using macOS speech fallback');
      engine = 'macos';
      const fallback = await synthesizeSystemSpeech({ input, language, speed, format });
      audio = fallback.audio;
      selectedVoice = fallback.voice;
    }

    if (abort.signal.aborted) return;
    res.setHeader('content-type', SPEECH_CONTENT_TYPES[format]);
    res.setHeader('content-length', String(audio.byteLength));
    res.setHeader('cache-control', 'no-store');
    res.status(200).end(audio);
    logger.info(
      {
        chars: input.length,
        bytes: audio.byteLength,
        voice: selectedVoice,
        language,
        speed,
        format,
        engine,
      },
      'tts synthesized',
    );
  } catch (err) {
    if (!abort.signal.aborted) next(err);
  } finally {
    ttsLatencySeconds.labels(engine, format).observe((performance.now() - started) / 1000);
  }
});
