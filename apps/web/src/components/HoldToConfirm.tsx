import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

/**
 * An irreversible action guarded by a gesture instead of a dialog.
 *
 * The intentional case is one press and 0.7 seconds; the accidental case is
 * impossible, because releasing early does nothing at all. That trade is deliberate:
 * a host who has to read and dismiss a modal while talking to a camera stops looking
 * at the lens, and a confirmation dialog is exactly what makes ending a show feel
 * dangerous rather than final.
 *
 * Traded away: discoverability. A hold is less obvious than a click, so the label
 * says "Hold to …" and an inline hint appears the first time the control is focused.
 */

export type HoldToConfirmHandle = {
  /**
   * Starts the hold from outside the button — this is how a caller wires a
   * `Shift`+key equivalent without duplicating the timing or the fill.
   */
  begin: () => void;
  abort: () => void;
};

const DEFAULT_HOLD_MS = 700;

export const HoldToConfirm = forwardRef<
  HoldToConfirmHandle,
  {
    label: string;
    /** Shown only while the fill runs — the stake, at the moment it matters. */
    subLabel?: string;
    holdMs?: number;
    onConfirm: () => void;
    disabled?: boolean;
    /**
     * Classes for the button itself, so the caller picks the intent: destructive by
     * default, `btn-commit btn-lg` where the guarded action is going live.
     */
    className?: string;
  }
>(
  (
    { label, subLabel, holdMs = DEFAULT_HOLD_MS, onConfirm, disabled = false, className = '' },
    ref,
  ) => {
    const [holding, setHolding] = useState(false);
    /** One-time: the hint appears on first focus and then stops asking. */
    const [hinted, setHinted] = useState(false);
    const timerRef = useRef<number | null>(null);
    const hintId = useId();

    const clear = useCallback((): void => {
      if (timerRef.current === null) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }, []);

    const abort = useCallback((): void => {
      clear();
      setHolding(false);
    }, [clear]);

    const begin = useCallback((): void => {
      if (disabled || timerRef.current !== null) return;
      setHolding(true);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setHolding(false);
        onConfirm();
      }, holdMs);
    }, [disabled, holdMs, onConfirm]);

    useImperativeHandle(ref, () => ({ begin, abort }), [begin, abort]);

    /** Esc aborts with the pointer still down, which is the whole point of Esc. */
    useEffect(() => {
      if (!holding) return;
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') abort();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [holding, abort]);

    /** A control disabled mid-hold must not fire when its timer lands. */
    useEffect(() => {
      if (disabled) abort();
    }, [disabled, abort]);

    useEffect(() => clear, [clear]);

    const fill = {
      width: holding ? '100%' : '0%',
      transitionProperty: 'width',
      transitionTimingFunction: 'linear',
      transitionDuration: holding ? `${holdMs}ms` : '0ms',
    };

    return (
      <div className="relative flex flex-col">
        <button
          type="button"
          disabled={disabled}
          aria-describedby={hintId}
          className={`relative select-none overflow-hidden ${className === '' ? 'btn-danger' : className}`}
          onPointerDown={begin}
          onPointerUp={abort}
          onPointerLeave={abort}
          onPointerCancel={abort}
          onKeyDown={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            // Space would scroll and Enter fires on press; the gesture owns both keys.
            event.preventDefault();
            if (event.repeat) return;
            begin();
          }}
          onKeyUp={(event) => {
            if (event.key === ' ' || event.key === 'Enter') abort();
          }}
          onFocus={() => setHinted(true)}
          onBlur={abort}
        >
          {/*
            The fill is inside the button and linear, so the time remaining is a
            length rather than a number. Both layers draw in `currentColor`, which is
            how one component carries two intents without a second colour decision —
            and why a destructive hold never becomes a filled red pill, the shape
            reserved for LIVE.
          */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 bg-current opacity-20"
            style={fill}
          />
          <span aria-hidden className="absolute bottom-0 left-0 h-0.5 bg-current" style={fill} />
          <span className="relative flex flex-col items-center leading-tight">
            <span>{label}</span>
            {holding && subLabel !== undefined && (
              <span className="tnum text-13 font-normal">{subLabel}</span>
            )}
          </span>
        </button>

        {/* Absolute, so a hint that appears on focus never resizes the bar it sits in. */}
        <span
          id={hintId}
          className={
            hinted
              ? 'on-video absolute right-0 top-full z-40 mt-1 whitespace-nowrap rounded-chip px-2 py-1 text-14'
              : 'sr-only'
          }
        >
          Press and hold. Release, or press Esc, to cancel.
        </span>
      </div>
    );
  },
);

HoldToConfirm.displayName = 'HoldToConfirm';
