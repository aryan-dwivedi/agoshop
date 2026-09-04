import { useEffect, useState } from 'react';

import type { LiveSessionDto } from '@shop/shared';

/**
 * The stage before it lights up.
 *
 * A room whose stream has not started is the one place a shopper is asked to wait, so
 * it answers the only question they have — *how long?* — instead of showing a black
 * rectangle. The cover art is the placeholder; the countdown is the answer.
 *
 * This is also the one countdown in the product, and it is attached to a *show start*,
 * never to a price, an offer or a stock level. A broadcast start time is a fact about
 * the world, not a scarcity device, so it renders in `--text-2` and never in amber or
 * red. The cover art is a still, which is why blurring it here is legal.
 *
 * It is anchored to the SERVER clock (`skewMs`), not the browser's. A device whose
 * clock is ten minutes fast would otherwise announce a premiere as overdue while it is
 * still on time, and the premiere itself is started by the server on that same clock.
 */

type Remaining = { days: number; hours: number; minutes: number; seconds: number };

const breakdown = (ms: number): Remaining => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
};

const Unit = ({ value, label }: { value: number; label: string }): JSX.Element => (
  <div className="flex min-w-[4rem] flex-col items-center px-3 py-2.5">
    <span className="tnum text-28 font-semibold leading-none tracking-[-0.03em] text-white">
      {String(value).padStart(2, '0')}
    </span>
    <span className="mt-1.5 text-11 font-semibold uppercase tracking-[0.1em] text-white/50">
      {label}
    </span>
  </div>
);

export const ScheduledStage = ({
  session,
  skewMs,
}: {
  session: LiveSessionDto;
  /** Client-to-server clock offset; the countdown is meaningless without it. */
  skewMs: number;
}): JSX.Element => {
  const startsAtMs =
    session.scheduledFor === null ? null : new Date(session.scheduledFor).getTime();

  // One second is the coarsest tick that still reads as a countdown rather than a
  // stale label. It runs only while there is a future instant left to count to.
  const [nowMs, setNowMs] = useState(() => Date.now() + skewMs);
  useEffect(() => {
    if (startsAtMs === null) return;
    setNowMs(Date.now() + skewMs);
    const timer = window.setInterval(() => setNowMs(Date.now() + skewMs), 1000);
    return () => window.clearInterval(timer);
  }, [startsAtMs, skewMs]);

  const remainingMs = startsAtMs === null ? null : startsAtMs - nowMs;
  const due = remainingMs !== null && remainingMs <= 0;
  const remaining = remainingMs === null ? null : breakdown(remainingMs);

  return (
    <div className="relative flex h-full min-h-[18rem] w-full flex-1 items-center justify-center overflow-hidden bg-[#090b10] p-4 sm:p-6">
      {/* A paused source, so the blur is allowed here and nowhere over live video. */}
      {session.coverImageUrl !== null && (
        <img
          src={session.coverImageUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-md"
        />
      )}
      <div aria-hidden className="absolute inset-0 bg-black/55" />

      <div className="relative w-full max-w-xl rounded-panel border border-white/15 bg-[#07172e]/95 px-5 py-6 text-center text-white shadow-float sm:px-8 sm:py-7">
        <p className="text-11 font-semibold uppercase tracking-[0.12em] text-white/55">
          {session.autoStart ? 'Scheduled premiere' : 'Upcoming live show'}
        </p>

        <h2 className="mt-4 line-clamp-2 font-display text-23 font-semibold leading-tight tracking-[-0.02em] text-white sm:text-28">
          {session.title}
        </h2>
        <p className="mt-1.5 text-14 font-medium text-white/65">
          {session.hostName} · {session.sellerName}
        </p>

        <div className="mt-6">
          {remaining !== null && !due ? (
            <>
              <p className="text-13 font-semibold uppercase tracking-[0.1em] text-white/55">
                Show starts in
              </p>
              <div
                className="mt-3 inline-flex max-w-full divide-x divide-white/10 overflow-hidden rounded-ctl border border-white/15 bg-white/[0.06]"
                role="timer"
                aria-live="off"
                aria-label={`Show starts in ${remaining.days} days, ${remaining.hours} hours, ${remaining.minutes} minutes and ${remaining.seconds} seconds`}
              >
                {remaining.days > 0 && <Unit value={remaining.days} label="days" />}
                {(remaining.days > 0 || remaining.hours > 0) && (
                  <Unit value={remaining.hours} label="hrs" />
                )}
                <Unit value={remaining.minutes} label="min" />
                <Unit value={remaining.seconds} label="sec" />
              </div>
            </>
          ) : (
            <p
              className="rounded-ctl border border-white/10 bg-white/[0.06] px-4 py-3 text-14 font-medium text-white"
              role="status"
            >
              {startsAtMs === null
                ? 'The host has not announced a start time yet.'
                : session.autoStart
                  ? 'Starting now — the stream is coming up.'
                  : 'The scheduled time has passed; waiting for the host.'}
            </p>
          )}

          {startsAtMs !== null && (
            <p className="tnum mt-3 text-13 font-medium text-white/65">
              {new Date(startsAtMs).toLocaleString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>

        <p className="mt-6 border-t border-white/10 pt-5 text-13 leading-relaxed text-white/60 sm:text-14">
          {session.autoStart
            ? 'This premiere begins automatically. Stay here and the video, chat and offers will appear without a refresh.'
            : 'Stay here. Video, chat and offers will appear as soon as the host goes live.'}
        </p>
      </div>
    </div>
  );
};
