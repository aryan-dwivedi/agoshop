import { env } from '../env.js';

const OUTPUT_FORMAT: Record<string, string> = {
  pcm: 'pcm_24000',
  mp3: 'mp3_44100_128',
  wav: 'wav_24000',
  aac: 'mp3_44100_128',
  opus: 'opus_48000_128',
  flac: 'pcm_24000',
};

const OPENAI_VOICES = new Set(['alloy', 'coral', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);

export const resolveElevenLabsVoiceId = (voice?: string): string => {
  const candidate = (voice ?? env.CONVOAI_TTS_VOICE).trim();
  if (!candidate || OPENAI_VOICES.has(candidate.toLowerCase())) {
    return env.CONVOAI_TTS_VOICE;
  }
  return candidate;
};

export const synthesizeElevenLabsSpeech = async (options: {
  input: string;
  voiceId: string;
  modelId: string;
  speed: number;
  format: string;
  signal?: AbortSignal;
}): Promise<Buffer> => {
  const outputFormat = OUTPUT_FORMAT[options.format] ?? 'pcm_24000';
  const url = new URL(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}`,
  );
  url.searchParams.set('output_format', outputFormat);

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': env.ELEVENLABS_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text: options.input,
      model_id: options.modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        speed: options.speed,
      },
    }),
    signal: options.signal,
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    throw new Error(`elevenlabs_tts_failed:${upstream.status}:${detail.slice(0, 300)}`);
  }

  return Buffer.from(await upstream.arrayBuffer());
};
