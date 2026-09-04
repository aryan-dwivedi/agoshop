import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { SessionAnalyticsDto } from '@shop/shared';

/**
 * Per-minute concurrency for one session. The series is sampled once a minute by
 * the background process (`viewer_sample`), so gaps mean "no sample", never zero.
 */

type Point = SessionAnalyticsDto['viewerSeries'][number];

const clockLabel = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export const ViewerChart = ({
  series,
  peakViewers,
}: {
  series: Point[];
  peakViewers: number;
}): JSX.Element => {
  if (series.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-1 text-center">
        <p className="text-14 font-semibold text-t1">No viewer activity for this show</p>
        <p className="max-w-sm text-13 leading-relaxed text-t3">
          Viewer activity appears here after a show has been live.
        </p>
      </div>
    );
  }

  const points = series.map((p) => ({ ...p, t: Date.parse(p.minute) }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id="viewerFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0b74d1" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#0b74d1" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v: number) => clockLabel.format(v)}
            tick={{ fill: '#64748b', fontSize: 11 }}
            stroke="#e2e8f0"
            minTickGap={28}
          />
          <YAxis
            allowDecimals={false}
            width={48}
            tick={{ fill: '#64748b', fontSize: 11 }}
            stroke="#e2e8f0"
          />
          <Tooltip
            cursor={{ stroke: '#0b74d166' }}
            contentStyle={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              boxShadow: '0 24px 48px -12px rgb(15 23 42 / 0.35)',
              color: '#0f172a',
              fontSize: 12,
            }}
            labelStyle={{ color: '#64748b' }}
            itemStyle={{ color: '#0f172a' }}
            labelFormatter={(v: number) => clockLabel.format(v)}
            formatter={(v: number) => [String(v), 'viewers']}
          />
          {peakViewers > 0 && (
            <ReferenceLine
              y={peakViewers}
              stroke="#e11d48"
              strokeDasharray="4 4"
              label={{
                value: `peak ${peakViewers}`,
                fill: '#e11d48',
                fontSize: 11,
                position: 'insideTopRight',
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="viewers"
            stroke="#0b74d1"
            strokeWidth={2}
            fill="url(#viewerFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
