export const LIVE_SYNC_SEEK_THRESHOLD_SECONDS = 2;
export const LIVE_SYNC_NUDGE_THRESHOLD_SECONDS = 0.35;
export const LIVE_SYNC_NUDGE_RATE = 0.06;
export const LIVE_SYNC_INTERVAL_MS = 4000;
export const syncedPosition = (
    startedAtMs: number | null,
    nowMs: number,
    durationSeconds: number,
): number | null => {
    if (startedAtMs === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0)
        return null;
    const elapsedSeconds = (nowMs - startedAtMs) / 1000;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
    return elapsedSeconds % durationSeconds;
};
