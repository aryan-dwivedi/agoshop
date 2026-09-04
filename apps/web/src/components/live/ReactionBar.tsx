import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../lib/api';
import { HeartIcon } from '../icons';

/**
 * Reactions are aggregated, never fanned out.
 *
 * A tap is one `POST /api/sessions/:id/reactions` that increments a counter; the
 * background process broadcasts an aggregate to the room, which drives the drifting
 * burst in `FlyingReactionsOverlay` on the video.
 *
 * The bar deliberately shows NO tally. A number next to an emoji turns a gesture into
 * a scoreboard: it reads as a vote count, invites comparison between emoji, and the
 * aggregate makes it visibly lag the tap that produced it. The burst on the video is
 * the feedback that a reaction landed, and it is immediate.
 *
 * Two shapes, because a five-button row that is right on a desktop stage eats 40% of
 * a phone's frame width: `bar` for the wide bottom band, `tap` for a single
 * thumb-reachable zone on the stage's right edge whose long-press opens the picker.
 * Long-press has no keyboard equivalent, so the same control also opens on ArrowUp.
 */

const REACTIONS = ['❤️', '👍', '🔥', '🤩', '🎉'] as const;

/** Long enough not to fire on a tap, short enough not to feel stuck. */
const LONG_PRESS_MS = 450;

export const ReactionBar = ({
  sessionId,
  disabled,
  onSpawn,
  variant = 'bar',
}: {
  sessionId: string;
  disabled?: boolean;
  /** Fires immediately on tap so the local viewer sees a burst before the aggregate. */
  onSpawn?: (emoji: string) => void;
  variant?: 'bar' | 'tap';
}): JSX.Element => {
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const longPressRef = useRef<number | null>(null);
  const openedByHoldRef = useRef(false);

  const react = useCallback(
    (emoji: string) => {
      onSpawn?.(emoji);
      void api
        .post(`/api/sessions/${sessionId}/reactions`, { emoji })
        .then(() => setError(null))
        .catch(() => setError('Too many reactions — try again in a moment.'));
    },
    [onSpawn, sessionId],
  );

  useEffect(
    () => () => {
      if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    },
    [],
  );

  const emojiButton = (emoji: string, onPick?: () => void): JSX.Element => (
    <button
      key={emoji}
      type="button"
      disabled={disabled}
      onClick={() => {
        react(emoji);
        onPick?.();
      }}
      className="on-video inline-flex h-11 w-11 items-center justify-center rounded-full text-19 leading-none transition duration-ctl ease-out hover:scale-105 active:scale-90 disabled:cursor-not-allowed disabled:opacity-50"
      aria-label={`React ${emoji}`}
    >
      <span aria-hidden>{emoji}</span>
    </button>
  );

  if (variant === 'tap') {
    return (
      <div className="relative flex flex-col items-end gap-2">
        {pickerOpen && (
          <div className="flex animate-slide-up flex-col gap-2">
            {REACTIONS.map((emoji) => emojiButton(emoji, () => setPickerOpen(false)))}
          </div>
        )}
        <button
          type="button"
          disabled={disabled}
          aria-label="Send a heart"
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
          aria-keyshortcuts="ArrowUp"
          title="Tap to react · hold to choose"
          className="on-video inline-flex h-12 w-12 items-center justify-center rounded-full text-white transition duration-ctl ease-out active:scale-90 disabled:cursor-not-allowed disabled:opacity-50"
          onPointerDown={() => {
            openedByHoldRef.current = false;
            longPressRef.current = window.setTimeout(() => {
              openedByHoldRef.current = true;
              setPickerOpen(true);
            }, LONG_PRESS_MS);
          }}
          onPointerUp={() => {
            if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
          }}
          onPointerLeave={() => {
            if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowUp') return;
            e.preventDefault();
            setPickerOpen((open) => !open);
          }}
          onClick={() => {
            // A hold that already opened the picker is not also a heart.
            if (openedByHoldRef.current) {
              openedByHoldRef.current = false;
              return;
            }
            if (pickerOpen) {
              setPickerOpen(false);
              return;
            }
            react(REACTIONS[0]);
          }}
        >
          <HeartIcon className="h-5 w-5" filled />
        </button>
        {error !== null && (
          <span
            role="status"
            className="on-video pointer-events-none absolute bottom-0 right-14 w-max max-w-[min(16rem,calc(100vw-5rem))] rounded-full px-3 py-2 text-13 text-white"
          >
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      {REACTIONS.map((emoji) => emojiButton(emoji))}
      {error !== null && (
        <span
          role="status"
          className="on-video pointer-events-none absolute bottom-full right-0 mb-2 w-max max-w-[18rem] rounded-full px-3 py-2 text-13 text-white"
        >
          {error}
        </span>
      )}
    </div>
  );
};
