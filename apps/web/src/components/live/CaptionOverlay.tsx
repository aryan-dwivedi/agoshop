import type { CaptionLine } from '../../hooks/useLiveSession';

/**
 * One stable caption surface, matching familiar broadcast captions. Mutable STT
 * segments replace themselves by id upstream, while the latest two segments share
 * this single high-contrast block instead of stacking as separate floating pills.
 */

const SEGMENTS_SHOWN = 2;

export const CaptionOverlay = ({
  captions,
  enabled,
  /** Lets the stage lift captions clear of its own control band. */
  className,
}: {
  captions: CaptionLine[];
  enabled: boolean;
  className?: string;
}): JSX.Element | null => {
  if (!enabled) return null;
  const text = captions
    .slice(-SEGMENTS_SHOWN)
    .map((line) => line.text)
    .join(' ')
    .trim();
  if (text.length === 0) return null;

  return (
    <div
      className={`pointer-events-none absolute inset-x-3 z-20 flex justify-center sm:inset-x-6 ${
        className ?? 'bottom-4'
      }`}
    >
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="max-w-[48rem] rounded-md bg-black/85 px-3.5 py-2 text-center text-15 font-semibold leading-snug text-white shadow-float backdrop-blur-sm sm:px-5 sm:py-2.5 sm:text-16"
      >
        {text}
      </p>
    </div>
  );
};
