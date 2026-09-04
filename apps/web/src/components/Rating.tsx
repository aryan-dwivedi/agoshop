import { useId } from 'react';

/** One five-point star. Shared with the listing rating facet so both draw the same glyph. */
export const STAR_PATH =
  'M10 1.6l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.2l-4.94 2.6.94-5.5-4-3.9 5.53-.8z';

const Star = ({
  fill,
  size,
  onDark,
}: {
  fill: number;
  size: number;
  onDark: boolean;
}): JSX.Element => {
  // One path, clipped by a percentage-width overlay: no half-star assets needed.
  // `useId` is stable across re-renders and unique per instance; its colons are
  // stripped because this id is dereferenced as a `url(#…)` fragment.
  const clipId = `star${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      <defs>
        <clipPath id={clipId}>
          {/* Rounded to 0.01 so a fractional rating cannot leak float noise into the DOM. */}
          <rect x="0" y="0" width={Math.round(2000 * fill) / 100} height="20" />
        </clipPath>
      </defs>
      <path d={STAR_PATH} className="fill-line" />
      {/*
       * `--accent-text` is the amber that survives both themes: the raw fill on dark,
       * a dark ochre on light where amber-on-white measures 1.80:1. A dark panel
       * inside a light route asks for the raw amber instead, which is what `onDark` is.
       */}
      <path
        d={STAR_PATH}
        className={onDark ? 'fill-accent' : 'fill-accent-text'}
        clipPath={`url(#${clipId})`}
      />
    </svg>
  );
};

/**
 * Catalog rating, 0–5. `count` is the number of ratings behind it.
 *
 * `count === 0` renders as words, not as stars: a listing nobody has rated yet has no
 * score to draw, and a 0.0 badge beside five empty stars reads as "rated badly".
 */
export const Rating = ({
  value,
  count,
  size = 14,
  className = '',
  onDark = false,
}: {
  value: number;
  count?: number;
  size?: number;
  className?: string;
  /** Set on a dark panel that sits inside a light route. */
  onDark?: boolean;
}): JSX.Element =>
  count === 0 ? (
    <p className={`text-13 text-t3 ${className}`}>No ratings yet</p>
  ) : (
    <div
      className={`flex items-center gap-1.5 ${className}`}
      aria-label={`Rated ${value.toFixed(1)} out of 5${count === undefined ? '' : ` from ${count} ratings`}`}
    >
      <span className="tnum inline-flex items-center gap-1 rounded-chip bg-surface px-1.5 py-0.5 text-13 font-semibold text-t1">
        {value.toFixed(1)}
        <svg
          width="9"
          height="9"
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={onDark ? 'fill-accent' : 'fill-accent-text'}
        >
          <path d={STAR_PATH} />
        </svg>
      </span>
      <span className="flex items-center gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} size={size} fill={Math.min(1, Math.max(0, value - i))} onDark={onDark} />
        ))}
      </span>
      {count !== undefined && (
        <span className="tnum text-13 text-t3">({count.toLocaleString('en-IN')})</span>
      )}
    </div>
  );
