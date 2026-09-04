import { randomUUID } from 'node:crypto';

import { normalizeSpeechText, synthesizeNeuralSpeech } from './speechSynthesis.js';

const PCM_FRAME_BYTES = 1_920; // 40 ms of mono 24 kHz signed 16-bit PCM.
const SILENCE_THRESHOLD = 256;
const EDGE_PADDING_SAMPLES = 240; // Retain 10 ms around speech; discard model tail silence.
const STREAM_IDLE_FLUSH_MS = 220;
const MAX_PHRASE_WAIT_MS = 700;
const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' });

type SseResponse = {
  readonly writableEnded: boolean;
  write(chunk: string): unknown;
  end(): unknown;
};

type SpeechSynthesizer = typeof synthesizeNeuralSpeech;

type AudioWriterOptions = {
  language: string;
  voice?: string;
  speed: number;
  signal: AbortSignal;
};

const trimPcmSilence = (pcm: Buffer): Buffer => {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  let first = 0;
  while (first < sampleCount && Math.abs(pcm.readInt16LE(first * 2)) <= SILENCE_THRESHOLD) {
    first += 1;
  }
  if (first === sampleCount) return pcm;

  let last = sampleCount - 1;
  while (last > first && Math.abs(pcm.readInt16LE(last * 2)) <= SILENCE_THRESHOLD) {
    last -= 1;
  }
  const start = Math.max(0, first - EDGE_PADDING_SAMPLES) * 2;
  const end = Math.min(sampleCount, last + EDGE_PADDING_SAMPLES + 1) * 2;
  return pcm.subarray(start, end);
};
const completedWordBoundary = (text: string): number => {
  if (/[\s,.!?;:]$/u.test(text)) return text.length;

  const segments = [...WORD_SEGMENTER.segment(text)];
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    if (segment.isWordLike && segment.index > 0) return segment.index;
  }
  return 0;
};

/**
 * Agora audio-output SSE writer. Chunk size adapts to the model stream: a brief token
 * pause flushes the completed words already available, while a maximum wait keeps a
 * continuously generated sentence from delaying first audio. No character count is
 * involved, so fast and slow models naturally produce different phrase sizes.
 */
export class AudioSseWriter {
  private readonly id = `chatcmpl-${randomUUID()}`;

  private readonly created = Math.floor(Date.now() / 1000);

  private pendingText = '';

  private synthesisQueue: Promise<void> = Promise.resolve();
  private idleFlushTimer: NodeJS.Timeout | null = null;

  private phraseDeadlineTimer: NodeJS.Timeout | null = null;

  private synthesisError: unknown;

  private closed = false;

  constructor(
    private readonly res: SseResponse,
    private readonly model: string,
    private readonly options: AudioWriterOptions,
    private readonly synthesize: SpeechSynthesizer = synthesizeNeuralSpeech,
  ) {}

  private frame(delta: Record<string, unknown>, finishReason: string | null): void {
    if (this.closed || this.res.writableEnded) return;
    this.res.write(
      `data: ${JSON.stringify({
        id: this.id,
        object: 'chat.completion.chunk',
        created: this.created,
        model: this.model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`,
    );
  }

  role(): void {
    this.frame({ role: 'assistant', audio: { data: '' } }, null);
  }

  text(delta: string): void {
    if (delta.length === 0 || this.closed) return;
    this.pendingText += delta;
    this.scheduleAdaptiveFlush();
  }

  private scheduleAdaptiveFlush(): void {
    clearTimeout(this.idleFlushTimer ?? undefined);
    this.idleFlushTimer = setTimeout(() => {
      this.idleFlushTimer = null;
      this.flushCompletedText(false);
    }, STREAM_IDLE_FLUSH_MS);

    if (!this.phraseDeadlineTimer) {
      this.phraseDeadlineTimer = setTimeout(() => {
        this.phraseDeadlineTimer = null;
        this.flushCompletedText(false);
      }, MAX_PHRASE_WAIT_MS);
    }
  }

  private clearAdaptiveFlush(): void {
    clearTimeout(this.idleFlushTimer ?? undefined);
    clearTimeout(this.phraseDeadlineTimer ?? undefined);
    this.idleFlushTimer = null;
    this.phraseDeadlineTimer = null;
  }

  private flushCompletedText(force: boolean): void {
    this.pendingText = this.pendingText.trimStart();
    const end = force ? this.pendingText.length : completedWordBoundary(this.pendingText);
    if (end === 0) return;

    this.clearAdaptiveFlush();
    const segment = this.pendingText.slice(0, end);
    this.pendingText = this.pendingText.slice(end);
    this.enqueue(segment);
  }

  private enqueue(segment: string): void {
    this.synthesisQueue = this.synthesisQueue.then(async () => {
      if (this.synthesisError || this.options.signal.aborted || this.res.writableEnded) return;
      try {
        const input = normalizeSpeechText(segment, this.options.language);
        if (input.length === 0) return;
        const synthesized = await this.synthesize({
          input,
          voice: this.options.voice,
          language: this.options.language,
          speed: this.options.speed,
          format: 'pcm',
          signal: this.options.signal,
        });
        if (this.options.signal.aborted || this.res.writableEnded) return;

        this.frame({ audio: { transcript: segment } }, null);
        const pcm = trimPcmSilence(synthesized.audio);
        for (let offset = 0; offset < pcm.byteLength; offset += PCM_FRAME_BYTES) {
          this.frame(
            { audio: { data: pcm.subarray(offset, offset + PCM_FRAME_BYTES).toString('base64') } },
            null,
          );
        }
      } catch (err) {
        this.synthesisError = err;
      }
    });
  }

  keepalive(): void {
    if (this.closed || this.res.writableEnded) return;
    this.res.write(': keepalive\n\n');
  }

  async finish(): Promise<void> {
    if (this.closed || this.res.writableEnded) return;
    this.clearAdaptiveFlush();
    this.flushCompletedText(true);
    await this.synthesisQueue;
    if (this.synthesisError) throw this.synthesisError;
    if (this.options.signal.aborted || this.res.writableEnded) return;

    this.frame({}, 'stop');
    this.res.write('data: [DONE]\n\n');
    this.closed = true;
    this.res.end();
  }
}
