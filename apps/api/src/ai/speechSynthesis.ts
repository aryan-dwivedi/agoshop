import { execFile, spawn } from 'node:child_process';

import { KokoroTTS } from 'kokoro-js';

import { AppError } from '../lib/errors.js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const SAMPLE_RATE = 24_000;
const MAX_CHUNK_CHARS = 320;
const MAX_PARALLEL_INFERENCE = 2;
const MAX_QUEUED_INFERENCE = 24;
const TARGET_RMS = 0.1;
const MAX_PEAK = 0.92;

const PHONEMIZER_SCRIPT = String.raw`
import { phonemize } from 'phonemizer';
const text = process.env.TTS_PHONEMIZER_INPUT ?? '';
const language = process.env.TTS_PHONEMIZER_LANGUAGE ?? 'en-us';
const punctuation = /([;:,.!?¡¿—…“”«»()[\]{}]+)/;
const sections = text.split(punctuation).filter(Boolean);
const parts = await Promise.all(sections.map(async (section) =>
  punctuation.test(section) ? section : (await phonemize(section, language)).join(' ')
));
process.stdout.write(parts.join(''));
`;

const VOICE_ALIASES: Record<string, string> = {
  alloy: 'af_heart',
  coral: 'af_heart',
  nova: 'af_bella',
  shimmer: 'af_heart',
  echo: 'am_michael',
  onyx: 'am_michael',
  fable: 'bm_fable',
};

const NEURAL_LANGUAGE_CONFIG: Record<string, { phonemizer: string; voice: string }> = {
  'en-US': { phonemizer: 'en-us', voice: 'af_heart' },
  'en-IN': { phonemizer: 'en-us', voice: 'af_heart' },
  'hi-IN': { phonemizer: 'hi', voice: 'hf_alpha' },
  'es-ES': { phonemizer: 'es', voice: 'ef_dora' },
};

export type SpeechFormat = 'mp3' | 'wav' | 'aac' | 'opus' | 'flac' | 'pcm';

export const SPEECH_CONTENT_TYPES: Record<SpeechFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  pcm: 'audio/pcm',
};

let modelPromise: Promise<KokoroTTS> | null = null;
let activeInference = 0;
const inferenceWaiters: Array<{
  resolve: () => void;
  reject: (reason: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}> = [];

const abortError = (): Error => new Error('tts_request_aborted');

const loadModel = (): Promise<KokoroTTS> => {
  if (modelPromise) return modelPromise;
  modelPromise = KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: 'q8',
    device: 'cpu',
  }).catch((error: unknown) => {
    modelPromise = null;
    throw error;
  });
  return modelPromise;
};

/** Starts model loading at process boot so the first spoken greeting is not a cold start. */
export const warmSpeechModel = async (): Promise<void> => {
  await loadModel();
};

const acquireInference = async (signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) throw abortError();
  if (activeInference < MAX_PARALLEL_INFERENCE) {
    activeInference += 1;
    return;
  }
  if (inferenceWaiters.length >= MAX_QUEUED_INFERENCE) {
    throw new AppError(503, 'tts_busy', 'speech synthesis is at capacity');
  }

  await new Promise<void>((resolve, reject) => {
    const waiter: (typeof inferenceWaiters)[number] = { resolve, reject, signal };
    waiter.onAbort = () => {
      const index = inferenceWaiters.indexOf(waiter);
      if (index >= 0) inferenceWaiters.splice(index, 1);
      reject(abortError());
    };
    signal?.addEventListener('abort', waiter.onAbort, { once: true });
    inferenceWaiters.push(waiter);
  });
  activeInference += 1;
};

const releaseInference = (): void => {
  activeInference -= 1;
  while (inferenceWaiters.length > 0) {
    const waiter = inferenceWaiters.shift()!;
    waiter.signal?.removeEventListener('abort', waiter.onAbort!);
    if (waiter.signal?.aborted) {
      waiter.reject(abortError());
      continue;
    }
    waiter.resolve();
    break;
  }
};

export const normalizeSpeechText = (input: string, language: string): string => {
  const base = language.split('-')[0]?.toLowerCase();
  let text = input
    .replace(/https?:\/\/\S+/giu, 'link')
    .replace(/[`*_#~]+/gu, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();

  if (base === 'hi') {
    text = text
      .replace(/₹\s*([\d,]+(?:\.\d+)?)/gu, '$1 रुपये')
      .replace(/(\d+(?:\.\d+)?)\s*%/gu, '$1 प्रतिशत');
  } else if (base === 'es') {
    text = text
      .replace(/₹\s*([\d,]+(?:\.\d+)?)/gu, '$1 rupias')
      .replace(/(\d+(?:\.\d+)?)\s*%/gu, '$1 por ciento');
  } else {
    text = text
      .replace(/₹\s*([\d,]+(?:\.\d+)?)/gu, '$1 rupees')
      .replace(/\bRs\.?\s*([\d,]+(?:\.\d+)?)/giu, '$1 rupees')
      .replace(/(\d+(?:\.\d+)?)\s*%/gu, '$1 percent')
      .replace(/\b(\d+(?:\.\d+)?)\s*GB\b/giu, '$1 gigabytes')
      .replace(/\b(\d+(?:\.\d+)?)\s*mAh\b/giu, '$1 milliamp hours')
      .replace(/\b(\d+(?:\.\d+)?)\s*Hz\b/giu, '$1 hertz')
      .replace(/\b(\d+(?:\.\d+)?)\s*W\b/gu, '$1 watts')
      .replace(/&/gu, 'and');
  }

  return (
    text
      // Kokoro assigns full punctuation pauses. Drop intra-sentence commas and demote
      // non-final sentence endings to a short clause pause; the visible transcript is
      // unchanged, but speech no longer stalls between closely related phrases.
      .replace(/,(?=\s)/gu, '')
      .replace(/[.!?](?=\s+\S)/gu, ',')
      .replace(/\s+([,.;:!?])/gu, '$1')
      .replace(/\s+/gu, ' ')
      .trim()
  );
};

export const splitSpeechText = (text: string): string[] => {
  const sentences = text.match(/[^.!?;:]+[.!?;:]*/gu) ?? [text];
  const chunks: string[] = [];
  let pending = '';

  const pushPiece = (piece: string): void => {
    const trimmed = piece.trim();
    if (!trimmed) return;
    if (!pending) pending = trimmed;
    else if (pending.length + 1 + trimmed.length <= MAX_CHUNK_CHARS) pending += ` ${trimmed}`;
    else {
      chunks.push(pending);
      pending = trimmed;
    }
  };

  for (const sentence of sentences) {
    let rest = sentence.trim();
    while (rest.length > MAX_CHUNK_CHARS) {
      const candidate = rest.slice(0, MAX_CHUNK_CHARS + 1);
      const boundary = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf(','));
      const end = boundary >= MAX_CHUNK_CHARS / 2 ? boundary : MAX_CHUNK_CHARS;
      pushPiece(rest.slice(0, end));
      rest = rest.slice(end).trimStart();
    }
    pushPiece(rest);
  }
  if (pending) chunks.push(pending);
  return chunks;
};

const execText = (
  bin: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<string> => {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(
    bin,
    [...args],
    {
      env: options.env,
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
      timeout: 5_000,
    },
    (error, stdout) => (error ? reject(error) : resolve(stdout)),
  );
  return promise;
};

const phonemize = async (text: string, language: string): Promise<string> => {
  const config = NEURAL_LANGUAGE_CONFIG[language] ?? NEURAL_LANGUAGE_CONFIG['en-US']!;
  const stdout =
    process.platform === 'darwin'
      ? await execText(process.execPath, ['--input-type=module', '--eval', PHONEMIZER_SCRIPT], {
          env: {
            ...process.env,
            TTS_PHONEMIZER_INPUT: text,
            TTS_PHONEMIZER_LANGUAGE: config.phonemizer,
          },
        })
      : await execText('espeak-ng', ['-q', '--ipa=3', '-v', config.phonemizer, text]);

  let phonemes = stdout.trim();
  if (language.startsWith('en')) {
    phonemes = phonemes
      .replace(/kəkˈoːɹoʊ/gu, 'kˈoʊkəɹoʊ')
      .replace(/ʲ/gu, 'j')
      .replace(/r/gu, 'ɹ')
      .replace(/x/gu, 'k')
      .replace(/ɬ/gu, 'l');
  }
  return phonemes;
};

const chooseVoice = (requested: string | undefined, language: string, model: KokoroTTS): string => {
  const configured = NEURAL_LANGUAGE_CONFIG[language] ?? NEURAL_LANGUAGE_CONFIG['en-US']!;
  if (!language.startsWith('en')) return configured.voice;
  const candidate = VOICE_ALIASES[requested ?? 'coral'] ?? requested ?? configured.voice;
  return candidate in model.voices ? candidate : configured.voice;
};

const synthesizeNeural = async (
  text: string,
  language: string,
  voice: string | undefined,
  speed: number,
  signal?: AbortSignal,
): Promise<{ samples: Float32Array; voice: string }> => {
  const chunks = splitSpeechText(text);
  const generated: Float32Array[] = [];
  let sampleCount = 0;
  let selectedVoice = 'af_heart';

  for (const chunk of chunks) {
    if (signal?.aborted) throw abortError();
    const phonemes = await phonemize(chunk, language);
    await acquireInference(signal);
    try {
      const model = await loadModel();
      const { input_ids: inputIds } = model.tokenizer(phonemes, { truncation: false });
      selectedVoice = chooseVoice(voice, language, model);
      const audio = await model.generate_from_ids(inputIds, {
        // kokoro-js ships every v1 voice tensor, but its declaration still lists only
        // English voices. Hindi and Spanish are supported by the underlying model.
        voice: selectedVoice as 'af_heart',
        speed,
      });
      generated.push(audio.audio);
      sampleCount += audio.audio.length;
    } finally {
      releaseInference();
    }
  }

  const pauseSamples = Math.round(SAMPLE_RATE * 0.04);
  const output = new Float32Array(sampleCount + Math.max(0, generated.length - 1) * pauseSamples);
  let offset = 0;
  for (const audio of generated) {
    output.set(audio, offset);
    offset += audio.length + pauseSamples;
  }
  return { samples: output, voice: selectedVoice };
};

const pcm16 = (samples: Float32Array): Buffer => {
  let peak = 0;
  let sumSquares = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
    sumSquares += sample * sample;
  }
  const rms = samples.length === 0 ? 0 : Math.sqrt(sumSquares / samples.length);
  const gain = rms === 0 || peak === 0 ? 1 : Math.min(TARGET_RMS / rms, MAX_PEAK / peak, 2);
  const pcm = Buffer.allocUnsafe(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const normalized = Math.max(-1, Math.min(1, samples[index]! * gain));
    pcm.writeInt16LE(Math.round(normalized * (normalized < 0 ? 32_768 : 32_767)), index * 2);
  }
  return pcm;
};

const wav = (pcm: Buffer): Buffer => {
  const header = Buffer.allocUnsafe(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
};

const encodeCompressed = (
  pcm: Buffer,
  format: Exclude<SpeechFormat, 'pcm' | 'wav'>,
  signal?: AbortSignal,
): Promise<Buffer> => {
  const outputArgs: Record<typeof format, string[]> = {
    mp3: ['-codec:a', 'libmp3lame', '-q:a', '4', '-f', 'mp3'],
    aac: ['-codec:a', 'aac', '-b:a', '128k', '-f', 'adts'],
    opus: ['-codec:a', 'libopus', '-b:a', '48k', '-f', 'ogg'],
    flac: ['-codec:a', 'flac', '-f', 'flac'],
  };
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const child = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      's16le',
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '1',
      '-i',
      'pipe:0',
      ...outputArgs[format],
      'pipe:1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], signal },
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.on('error', reject);
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) resolve(Buffer.concat(stdout));
    else
      reject(
        new Error(
          `ffmpeg_tts_encode_failed: ${Buffer.concat(stderr).toString('utf8').slice(0, 512)}`,
        ),
      );
  });
  child.stdin.end(pcm);
  return promise;
};

export const synthesizeNeuralSpeech = async (options: {
  input: string;
  voice?: string;
  language: string;
  speed: number;
  format: SpeechFormat;
  signal?: AbortSignal;
}): Promise<{ audio: Buffer; voice: string }> => {
  const { samples, voice } = await synthesizeNeural(
    options.input,
    options.language,
    options.voice,
    options.speed,
    options.signal,
  );
  const pcm = pcm16(samples);
  if (options.format === 'pcm') return { audio: pcm, voice };
  if (options.format === 'wav') return { audio: wav(pcm), voice };
  return { audio: await encodeCompressed(pcm, options.format, options.signal), voice };
};
