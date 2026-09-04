/** Elapsed show time as a clock, not a duration: `HH:MM:SS`, always three fields. */
export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

/** The three markdowns a host calls out on air; anything else is typed on pre-flight. */
export const QUICK_DISCOUNTS = [10, 20, 30];

/** Seconds of a stalled uplink before talking becomes the better option. */
export const AUDIO_ONLY_AFTER_S = 8;

/** How long the ribbon stays expanded when the checks were skipped. */
export const EXPANDED_RIBBON_MS = 30_000;

/** Ribbon block height, so the monitor can be sized around it to the pixel. */
export const RIBBON_H = 34;
export const RIBBON_H_EXPANDED = 40;

export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: '1 – 9', does: 'Pin that line-up slot' },
  { keys: '0', does: 'Clear the pin' },
  { keys: 'M', does: 'Mute or unmute your mic' },
  { keys: 'V', does: 'Stop or start your camera' },
  { keys: 'D', does: 'Live price for this room' },
  { keys: 'P', does: 'Open or close a poll' },
  { keys: 'C', does: 'Show or hide captions' },
  { keys: 'Shift + E', does: 'Hold to end the show' },
  { keys: '?', does: 'This list' },
];
