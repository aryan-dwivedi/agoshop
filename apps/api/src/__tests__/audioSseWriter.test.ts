import { describe, expect, it, vi } from 'vitest';

import { AudioSseWriter } from '../ai/audioSseWriter.js';

class MemoryResponse {
  readonly chunks: string[] = [];

  writableEnded = false;

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(): void {
    this.writableEnded = true;
  }
}

const audioDeltas = (response: MemoryResponse): Array<{ data?: string; transcript?: string }> =>
  response.chunks
    .flatMap((chunk) => chunk.split('\n\n'))
    .filter((frame) => frame.startsWith('data: {'))
    .map((frame) => JSON.parse(frame.slice(6)) as { choices: Array<{ delta: { audio?: object } }> })
    .flatMap((frame) => frame.choices[0]?.delta.audio ?? []) as Array<{
    data?: string;
    transcript?: string;
  }>;

describe('direct audio SSE', () => {
  it('streams natural phrases without repeating prior transcript text', async () => {
    const response = new MemoryResponse();
    const pcm = Buffer.alloc(3_840, 4);
    const synthesize = vi.fn(async () => ({ audio: pcm, voice: 'af_heart' }));
    const writer = new AudioSseWriter(
      response,
      'test-model',
      {
        language: 'en-US',
        speed: 1.6,
        signal: new AbortController().signal,
      },
      synthesize,
    );

    writer.role();
    writer.text('Hello, I can help you compare ');
    await Promise.resolve();
    expect(synthesize).not.toHaveBeenCalled();

    const firstPhrase =
      'Hello, I can help you compare these products, check prices, delivery options, available offers, and ';
    writer.text('these products, check prices, delivery options, available offers, and ');
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(
        audioDeltas(response).some(
          (delta) => typeof delta.data === 'string' && delta.data.length > 0,
        ),
      ).toBe(true),
    );
    expect(response.writableEnded).toBe(false);

    const secondPhrase = 'add the best one to your cart.';
    writer.text(secondPhrase);
    await writer.finish();

    const transcripts = audioDeltas(response).flatMap((delta) =>
      delta.transcript === undefined ? [] : [delta.transcript],
    );
    expect(transcripts).toEqual([firstPhrase, secondPhrase]);
    expect(transcripts.join('')).toBe(`${firstPhrase}${secondPhrase}`);
    expect(response.writableEnded).toBe(true);
    expect(response.chunks.join('')).toContain('data: [DONE]');
    expect(synthesize).toHaveBeenCalledTimes(2);
  });
  it('flushes a continuously generated phrase on the latency deadline', async () => {
    vi.useFakeTimers();
    try {
      const response = new MemoryResponse();
      const synthesize = vi.fn(async () => ({ audio: Buffer.alloc(1_920, 4), voice: 'af_heart' }));
      const writer = new AudioSseWriter(
        response,
        'test-model',
        { language: 'en-US', speed: 1.6, signal: new AbortController().signal },
        synthesize,
      );

      writer.role();
      for (const delta of ['This ', 'answer ', 'keeps ', 'arriving ', 'without ', 'a ', 'pause ']) {
        writer.text(delta);
        await vi.advanceTimersByTimeAsync(100);
      }

      expect(synthesize).toHaveBeenCalledTimes(1);
      expect(response.writableEnded).toBe(false);
      await writer.finish();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops synthesis after the client disconnects', async () => {
    const response = new MemoryResponse();
    const controller = new AbortController();
    const synthesize = vi.fn(async () => ({ audio: Buffer.alloc(1_920), voice: 'af_heart' }));
    const writer = new AudioSseWriter(
      response,
      'test-model',
      { language: 'en-US', speed: 1.6, signal: controller.signal },
      synthesize,
    );

    controller.abort();
    writer.text('Hello ');
    await writer.finish();

    expect(synthesize).not.toHaveBeenCalled();
    expect(audioDeltas(response).every((delta) => !delta.data)).toBe(true);
  });
});
