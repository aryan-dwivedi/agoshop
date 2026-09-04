import { describe, expect, it } from 'vitest';

import { syncedPosition } from './liveClock.js';

describe('syncedPosition', () => {
    const startedAt = Date.UTC(2026, 0, 1, 12, 0, 0);
    const duration = 180;
    it('puts every viewer on the same playhead regardless of when they joined', () => {
        const now = startedAt + 95000;
        expect(syncedPosition(startedAt, now, duration)).toBe(95);
        expect(syncedPosition(startedAt, now, duration)).toBe(95);
    });
    it('never starts a long-running stream from the beginning', () => {
        expect(syncedPosition(startedAt, startedAt + 732000, duration)).toBeCloseTo(12, 6);
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
        expect(syncedPosition(startedAt, startedAt - 5000, duration)).toBe(0);
    });
    it('declines to seek a genuinely live source', () => {
        expect(syncedPosition(startedAt, startedAt + 60000, Number.POSITIVE_INFINITY)).toBeNull();
        expect(syncedPosition(startedAt, startedAt + 60000, Number.NaN)).toBeNull();
        expect(syncedPosition(startedAt, startedAt + 60000, 0)).toBeNull();
    });
    it('declines to seek a session with no start time to anchor to', () => {
        expect(syncedPosition(null, startedAt, duration)).toBeNull();
    });
});
