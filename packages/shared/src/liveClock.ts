/**
 * The shared live clock.
 *
 * A file-backed live feed (the standby loop, and the `simulated-origin` VOD ladder
 * that stands in for a CDN) has no live edge of its own: every `<video>` element
 * starts at t=0, so two viewers who opened the room a minute apart watched two
 * different things and both watched from the beginning. That is wrong for a live
 * room in a way no amount of UI copy fixes.
 *
 * The fix is to stop treating the asset as a file and derive the playhead from wall
 * time instead: position = (now - startedAt) mod duration. Every viewer computes the
 * same number from the same two server-supplied facts, so the room is frame-aligned
 * within the drift budget below and a late joiner lands mid-stream — exactly like a
 * real live edge. `serverNowMs` travels with every session payload so a client whose
 * own clock is wrong still resolves the same position.
 *
 * Real live sources (Agora RTC, or Media Push into a sliding HLS window) already have
 * a genuine live edge and are never touched by this: `syncedPosition` returns null for
 * a non-finite duration, which is what an actual live playlist reports.
 */

/** Beyond this the playhead is wrong enough that a hard seek beats a rate nudge. */
export const LIVE_SYNC_SEEK_THRESHOLD_SECONDS = 2;
/** Under this, correcting would be more visible than the drift itself. */
export const LIVE_SYNC_NUDGE_THRESHOLD_SECONDS = 0.35;
/** Playback-rate correction applied between the two thresholds. */
export const LIVE_SYNC_NUDGE_RATE = 0.06;
/** How often a viewer re-checks its playhead against the shared clock. */
export const LIVE_SYNC_INTERVAL_MS = 4_000;

/**
 * Where a viewer joining at `nowMs` must place its playhead in a looping asset of
 * `durationSeconds`, for a stream that went live at `startedAtMs`.
 *
 * Returns null when the answer is "wherever the source says", i.e. a genuinely live
 * source (infinite duration) or a stream with no start time to anchor to.
 */
export const syncedPosition = (
  startedAtMs: number | null,
  nowMs: number,
  durationSeconds: number,
): number | null => {
  if (startedAtMs === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0)
    return null;
  const elapsedSeconds = (nowMs - startedAtMs) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
  // `%` on a float is exact enough here: the drift correction re-anchors every tick.
  return elapsedSeconds % durationSeconds;
};
