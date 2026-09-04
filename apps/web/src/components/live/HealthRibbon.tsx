import { HEALTH_STATE_BY_CODE, type StreamHealth, type StreamHealthState, } from '../../hooks/useStreamHealth';
const CELLS = 60;
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
export const monitorInsetShadow = (state: StreamHealthState): string | undefined => state === 'strain'
    ? 'inset 0 0 0 2px var(--accent)'
    : state === 'bad'
        ? 'inset 0 0 0 2px var(--live)'
        : undefined;
const formatRate = (kbps: number | null): string | null => kbps === null || kbps <= 0
    ? null
    : kbps >= 1000
        ? `${(kbps / 1000).toFixed(1)} Mbps`
        : `${kbps} kbps`;
export const HealthRibbon = ({ health, expanded = false, className = '', }: {
    health: StreamHealth;
    expanded?: boolean;
    className?: string;
}): JSX.Element => {
    const cellClass = expanded ? CELL_EXPANDED : CELL;
    const cells = health.history.length >= CELLS
        ? health.history
        : [...new Array<number>(CELLS - health.history.length).fill(0), ...health.history];
    const rate = formatRate(health.bitrateKbps);
    return (<div className={className}>
      <div className={`flex ${expanded ? 'h-4' : 'h-2.5'} items-end gap-px`} role="img" aria-label={`Uplink over the last minute: ${health.label}`}>
        {cells.map((code, index) => (<div key={index} className={`flex-1 ${cellClass[HEALTH_STATE_BY_CODE[code] ?? 'unknown']}`}/>))}
      </div>

      <div className="mt-1 flex items-baseline gap-2 text-14">
        <span className={`font-medium ${LABEL_TONE[health.state]}`}>{health.label}</span>
        {rate !== null && (<span className="tnum text-t2">
            {rate}
            {health.rttMs !== null ? ` · ${health.rttMs} ms` : ''}
            {health.lossPct !== null && health.lossPct > 0 ? ` · ${health.lossPct}% lost` : ''}
          </span>)}
      </div>

      <span className="sr-only" aria-live="polite">
        {health.label}
      </span>
    </div>);
};
export const HealthSummary = ({ health, className = '', }: {
    health: StreamHealth;
    className?: string;
}): JSX.Element => {
    const rate = formatRate(health.bitrateKbps);
    return (<span className={`inline-flex items-center gap-2 text-14 ${className}`}>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${health.state === 'good'
            ? 'bg-success'
            : health.state === 'strain'
                ? 'bg-accent'
                : health.state === 'bad'
                    ? 'bg-live'
                    : 'bg-line-ctl'}`}/>
      <span className={`font-medium ${LABEL_TONE[health.state]}`}>{health.label}</span>
      {rate !== null && <span className="tnum text-t2">{rate}</span>}
    </span>);
};
