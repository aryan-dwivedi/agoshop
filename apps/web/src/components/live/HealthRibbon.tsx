import {
  HEALTH_STATE_BY_CODE,
  type StreamHealth,
  type StreamHealthState,
} from '../../hooks/useStreamHealth';

/**
 * Stream health, welded to the monitor's bottom edge.
 *
 * The seller is looking at a lens above the screen, so this lives in their peripheral
 * vision and encodes itself four ways at once — colour, height, position and two
 * words. Any one of those alone would fail somebody: colour fails a colour-blind
 * seller, height fails a glance, a word fails a seller who is talking. Redundant is
 * the point.
 *
 * There is no sound, no modal and no number that has to be parsed. The escalation is
 * a 2px inset border on the monitor (`monitorInsetShadow`), because a change at the
 * edge of the thing you are already staring at is detectable without reading.
 */

const CELLS = 60;

/** 6px when good, 10px when not: the ribbon grows toward you as it degrades. */
const CELL: Record<StreamHealthState, string> = {
  unknown: 'h-1.5 bg-line',
  good: 'h-1.5 bg-success',
  strain: 'h-2.5 bg-accent',
  bad: 'h-2.5 bg-live',
};

const CELL_EXPANDED: Record<StreamHealthState, string> = {
  unknown: 'h-2.5 bg-line',
  good: 'h-2.5 bg-success',
  strain: 'h-4 bg-accent',
  bad: 'h-4 bg-live',
};

const LABEL_TONE: Record<StreamHealthState, string> = {
  unknown: 'text-t3',
  good: 'text-success',
  strain: 'text-accent',
  bad: 'text-live',
};

/**
 * The monitor's own escalation. One `box-shadow: inset` — no layout, no repaint of
 * the frame, and nothing over the video.
 */
export const monitorInsetShadow = (state: StreamHealthState): string | undefined =>
  state === 'strain'
    ? 'inset 0 0 0 2px var(--accent)'
    : state === 'bad'
      ? 'inset 0 0 0 2px var(--live)'
      : undefined;

/** Bitrate the way a seller reads it, not the way WebRTC reports it. */
const formatRate = (kbps: number | null): string | null =>
  kbps === null || kbps <= 0
    ? null
    : kbps >= 1000
      ? `${(kbps / 1000).toFixed(1)} Mbps`
      : `${kbps} kbps`;

export const HealthRibbon = ({
  health,
  /** Pre-flight was skipped, so the first half minute shows more of it. */
  expanded = false,
  className = '',
}: {
  health: StreamHealth;
  expanded?: boolean;
  className?: string;
}): JSX.Element => {
  const cellClass = expanded ? CELL_EXPANDED : CELL;
  // Fixed geometry: the ribbon is always 60 cells wide and fills from the right, so
  // nothing under the monitor moves as the show gets longer.
  const cells =
    health.history.length >= CELLS
      ? health.history
      : [...new Array<number>(CELLS - health.history.length).fill(0), ...health.history];

  const rate = formatRate(health.bitrateKbps);

  return (
    <div className={className}>
      <div
        className={`flex ${expanded ? 'h-4' : 'h-2.5'} items-end gap-px`}
        role="img"
        aria-label={`Uplink over the last minute: ${health.label}`}
      >
        {cells.map((code, index) => (
          <div
            key={index}
            className={`flex-1 ${cellClass[HEALTH_STATE_BY_CODE[code] ?? 'unknown']}`}
          />
        ))}
      </div>

      <div className="mt-1 flex items-baseline gap-2 text-14">
        <span className={`font-medium ${LABEL_TONE[health.state]}`}>{health.label}</span>
        {rate !== null && (
          <span className="tnum text-t2">
            {rate}
            {health.rttMs !== null ? ` · ${health.rttMs} ms` : ''}
            {health.lossPct !== null && health.lossPct > 0 ? ` · ${health.lossPct}% lost` : ''}
          </span>
        )}
      </div>

      {/* Announced only when the state actually changes: the text is the state. */}
      <span className="sr-only" aria-live="polite">
        {health.label}
      </span>
    </div>
  );
};

/**
 * The same three states at top-strip size: one dot, two words, one number. It is the
 * summary a seller sees while their eyes are on the monitor, not on the strip.
 */
export const HealthSummary = ({
  health,
  className = '',
}: {
  health: StreamHealth;
  className?: string;
}): JSX.Element => {
  const rate = formatRate(health.bitrateKbps);
  return (
    <span className={`inline-flex items-center gap-2 text-14 ${className}`}>
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${
          health.state === 'good'
            ? 'bg-success'
            : health.state === 'strain'
              ? 'bg-accent'
              : health.state === 'bad'
                ? 'bg-live'
                : 'bg-line-ctl'
        }`}
      />
      <span className={`font-medium ${LABEL_TONE[health.state]}`}>{health.label}</span>
      {rate !== null && <span className="tnum text-t2">{rate}</span>}
    </span>
  );
};
