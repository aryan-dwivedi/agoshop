import { describe, expect, it } from 'vitest';

import { syncedPosition } from './liveClock.js';

/**
 * The shared live clock is what makes a file-backed feed behave like a live stream:
 * every viewer must derive the same playhead from the same two server facts, and a
 * late joiner must land mid-stream rather than at the beginning. These are the
 * boundaries that guarantee it.
 */
describe('syncedPosition', () => {
  const startedAt = Date.UTC(2026, 0, 1, 12, 0, 0);
  const duration = 180;

  it('puts every viewer on the same playhead regardless of when they joined', () => {
    const now = startedAt + 95_000;
    expect(syncedPosition(startedAt, now, duration)).toBe(95);
    expect(syncedPosition(startedAt, now, duration)).toBe(95);
  });

  it('never starts a long-running stream from the beginning', () => {
    // 12m12s into a 3-minute loop: the fifth pass, 12 s in — not frame zero.
    expect(syncedPosition(startedAt, startedAt + 732_000, duration)).toBeCloseTo(12, 6);
  });

  it('wraps at the loop boundary instead of running past the asset', () => {
    expect(syncedPosition(startedAt, startedAt + duration * 1000, duration)).toBeCloseTo(0, 6);
    expect(syncedPosition(startedAt, startedAt + (duration + 4) * 1000, duration)).toBeCloseTo(
      4,
      6,
    );
  });

  it('holds at the start for a stream that has only just begun', () => {
    expect(syncedPosition(startedAt, startedAt, duration)).toBe(0);
    // A viewer whose clock runs ahead of the server must not seek to a negative time.
    expect(syncedPosition(startedAt, startedAt - 5_000, duration)).toBe(0);
  });

  it('declines to seek a genuinely live source', () => {
    // An HLS live playlist reports an infinite duration: it is already at its own edge.
    expect(syncedPosition(startedAt, startedAt + 60_000, Number.POSITIVE_INFINITY)).toBeNull();
    expect(syncedPosition(startedAt, startedAt + 60_000, Number.NaN)).toBeNull();
    expect(syncedPosition(startedAt, startedAt + 60_000, 0)).toBeNull();
  });

  it('declines to seek a session with no start time to anchor to', () => {
    expect(syncedPosition(null, startedAt, duration)).toBeNull();
  });
});
