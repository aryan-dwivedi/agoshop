import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { formatInr, type LiveSessionDto } from '@shop/shared';

import { Metric } from '../../components/seller/Metric';
import { RoleGate } from '../../components/seller/RoleGate';
import { api } from '../../lib/api';
import { useSellerOverview, useSellerSessions, type SellerSessionRow } from '../../lib/sellerApi';
import { useSession } from '../../state/session';

/**
 * Today — the console home.
 *
 * First thing noticed: the next thing that requires the seller. Everything else on the
 * screen is a number you *may* want; `NEXT UP` is the one thing that will cost money if
 * it is missed, so it is the only card here with 48px controls and it is the only card
 * that is conditional. Outside the hour before a show it is not rendered at all — an
 * empty "no upcoming shows" card would occupy the most valuable strip of the console to
 * say nothing.
 */

const nf = new Intl.NumberFormat('en-IN');

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** The hour before a show is when pre-flight still fixes something. */
const NEXT_UP_WINDOW_MS = 60 * 60 * 1000;
/** A show 15 minutes past its slot is late, not gone — it is still the next thing. */
const LATE_GRACE_MS = 15 * 60 * 1000;

const clock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

/**
 * The blockers `NEXT UP` exists to surface. Each one is a thing that has gone wrong
 * *before* anybody is watching, which is the only time it is cheap to fix.
 */
const blockersFor = (show: SellerSessionRow, session: LiveSessionDto | undefined): string[] => {
  const blockers: string[] = [];
  // Pre-flight writes this key once camera, mic and uplink have all passed here.
  if (window.localStorage.getItem(`studio.preflight.${show.id}`) === null) {
    blockers.push('Camera and mic not tested on this device');
  }
  if (session !== undefined) {
    const out = session.products.filter((product) => product.stock === 0);
    if (out.length > 0) {
      blockers.push(
        out.length === 1
          ? `${out[0]!.title} is out of stock`
          : `${out.length} line-up products are out of stock`,
      );
    }
    if (session.products.length === 0) blockers.push('Nothing on the line-up');
    if (session.coverImageUrl === null) blockers.push('No cover image');
    if (session.autoStart && session.sourceVideoUrl === null) {
      blockers.push('Set to premiere a video, but no video has been uploaded');
    }
  }
  return blockers;
};

const NextUp = ({ show, now }: { show: SellerSessionRow; now: number }): JSX.Element => {
  const detail = useQuery({
    queryKey: ['session', show.slug],
    queryFn: async () =>
      (await api.get<{ session: LiveSessionDto }>(`/api/sessions/${show.slug}`)).session,
    staleTime: 30_000,
  });
  const session = detail.data;
  const blockers = blockersFor(show, session);
  const untilMs = show.scheduledFor === null ? 0 : Date.parse(show.scheduledFor) - now;
  const minutes = Math.round(Math.abs(untilMs) / 60_000);

  return (
    <section className="card animate-slide-up mb-4 border-accent p-4">
      <p className="eyebrow text-accent">Next up</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-19 font-semibold tracking-[-0.01em] text-t1">{show.title}</h2>
        <p className="text-14 text-t2">
          {untilMs >= 0 ? `starts in ${minutes} min` : `${minutes} min past its start time`} ·{' '}
          {show.productCount} product{show.productCount === 1 ? '' : 's'}
          {session?.discountPercent != null && ` · live price −${session.discountPercent}%`}
        </p>
      </div>

      {detail.isLoading ? (
        <div className="skeleton mt-3 h-4 w-64" />
      ) : blockers.length === 0 ? (
        <p className="mt-3 text-14 text-success">Nothing is blocking this show.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {blockers.map((blocker) => (
            <li key={blocker} className="flex items-baseline gap-2 text-14 text-t1">
              <span aria-hidden="true" className="text-accent">
                ▸
              </span>
              {blocker}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={`/live/${show.slug}/preflight`} className="btn-commit h-12 px-5 text-16">
          Pre-flight
        </Link>
        <Link to={`/shows?show=${show.id}`} className="btn-standard h-12 px-5 text-16">
          Edit line-up
        </Link>
      </div>
    </section>
  );
};

const LiveNow = ({ shows, now }: { shows: SellerSessionRow[]; now: number }): JSX.Element => (
  <section className="mb-4">
    <h2 className="eyebrow mb-1.5">Live now</h2>
    <ul className="card divide-y divide-line">
      {shows.map((show) => (
        <li key={show.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <span className="badge-live">
            <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-live-ink" />
            live
          </span>
          <span className="min-w-0 flex-1 truncate text-14 font-medium text-t1">{show.title}</span>
          <span className="tabular-nums text-t2">
            {show.startedAt === null ? '—' : clock(now - Date.parse(show.startedAt))}
          </span>
          <span className="tabular-nums text-t2">
            {show.viewerCount < 10 ? '—' : `${nf.format(show.viewerCount)} watching`}
          </span>
          <span className="tabular-nums font-semibold text-t1">
            {formatInr(show.gmvMinorUnits)}
          </span>
          <Link to={`/live/${show.slug}`} className="btn-standard btn-sm">
            Open
          </Link>
        </li>
      ))}
    </ul>
  </section>
);

const Today = (): JSX.Element => {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const sellerId = params.get('sellerId');
  const allowed = user?.role === 'seller';
  const overview = useSellerOverview(allowed, sellerId);
  const sessions = useSellerSessions(allowed, sellerId);
  const [now, setNow] = useState(() => Date.now());

  // One clock for the elapsed timers and the countdown; nothing else on the page moves.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const rows = sessions.data?.sessions ?? [];
  const live = rows.filter((row) => row.status === 'live');
  const nextUp =
    rows
      .filter((row) => {
        if (row.status !== 'scheduled' || row.scheduledFor === null) return false;
        const until = Date.parse(row.scheduledFor) - now;
        return until <= NEXT_UP_WINDOW_MS && until >= -LATE_GRACE_MS;
      })
      .sort((a, b) => Date.parse(a.scheduledFor!) - Date.parse(b.scheduledFor!))[0] ?? null;

  const data = overview.data;
  const emptyLineUps = rows.filter(
    (row) => row.status === 'scheduled' && row.productCount === 0,
  ).length;

  const needs: { text: string; to: string }[] = [];
  if ((data?.lowStockCount ?? 0) > 0) {
    needs.push({
      text: `${nf.format(data!.lowStockCount)} product${data!.lowStockCount === 1 ? '' : 's'} low on stock`,
      to: '/catalog',
    });
  }
  if (emptyLineUps > 0) {
    needs.push({
      text: `${emptyLineUps} scheduled show${emptyLineUps === 1 ? '' : 's'} with nothing to sell`,
      to: '/shows',
    });
  }
  if ((data?.checkoutDeclines ?? 0) > 0) {
    needs.push({
      text: `${nf.format(data!.checkoutDeclines)} payment${data!.checkoutDeclines === 1 ? '' : 's'} declined in your rooms`,
      to: '/orders',
    });
  }

  return (
    <RoleGate
      roles={['seller']}
      title="Today"
      subtitle="What needs you next, and what your shows have earned."
      scope={
        data === undefined
          ? undefined
          : {
              sellers: data.sellers,
              value: sellerId,
              allLabel: 'Primary storefront',
              onChange: (next) => setParams(next === null ? {} : { sellerId: next }),
            }
      }
    >
      {sessions.isError && (
        <p role="alert" className="card mb-4 px-3 py-2 text-13 text-danger">
          Could not read your shows.{' '}
          <button type="button" className="link" onClick={() => void sessions.refetch()}>
            Retry
          </button>
        </p>
      )}

      {nextUp !== null && <NextUp show={nextUp} now={now} />}
      {live.length > 0 && <LiveNow shows={live} now={now} />}

      <section className="mb-4">
        <h2 className="eyebrow mb-1.5">Across every show you have run</h2>
        {overview.isLoading ? (
          <div className="skeleton h-20 w-full" />
        ) : overview.isError ? (
          <div className="card px-3 py-3">
            <p role="alert" className="text-13 text-danger">
              Could not load your numbers.
            </p>
            <button
              type="button"
              className="btn-standard btn-sm mt-2"
              onClick={() => void overview.refetch()}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="card grid grid-cols-2 divide-line py-1 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
            <Metric label="GMV" value={data === undefined ? null : formatInr(data.gmvMinorUnits)} />
            <Metric
              label="Orders"
              value={data === undefined ? null : nf.format(data.orders)}
              to="/orders"
            />
            <Metric
              label="Conv."
              value={data === undefined ? null : `${(data.conversionRate * 100).toFixed(1)}%`}
              hint="Orders per viewer who joined"
            />
            <Metric label="Peak" value={data === undefined ? null : nf.format(data.peakViewers)} />
            <Metric
              label="Discount"
              value={data === undefined ? null : formatInr(data.discountGivenMinorUnits)}
              hint="Given on attributed lines"
            />
          </div>
        )}
      </section>

      <section className="mb-4">
        <h2 className="eyebrow mb-1.5">Needs you</h2>
        {overview.isLoading ? (
          <div className="skeleton h-8 w-72" />
        ) : needs.length === 0 ? (
          <p className="text-14 text-t2">Nothing needs you right now.</p>
        ) : (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-14">
            {needs.map((item, index) => (
              <span key={item.text} className="flex items-center gap-2">
                {index > 0 && <span className="text-t3">·</span>}
                <Link to={item.to} className="link">
                  {item.text}
                </Link>
              </span>
            ))}
          </p>
        )}
      </section>

      <section>
        <h2 className="eyebrow mb-1.5">Last five shows</h2>
        {overview.isLoading ? (
          <div className="skeleton h-32 w-full" />
        ) : data === undefined || data.recentSessions.length === 0 ? (
          <div className="card px-3 py-8 text-center">
            <p className="text-14 font-medium text-t1">You have not run a show yet.</p>
            <p className="mx-auto mt-1 max-w-sm text-13 leading-relaxed text-t2">
              Schedule one, put products on its line-up, then go live. Everything on this screen
              fills in from what that show does.
            </p>
            <Link to="/shows" className="btn-commit mt-3">
              Schedule a show
            </Link>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-13">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-3 py-1.5 font-medium text-t3">Show</th>
                  <th className="px-3 py-1.5 font-medium text-t3">When</th>
                  <th className="px-3 py-1.5 text-right font-medium text-t3">Peak</th>
                  <th className="px-3 py-1.5 text-right font-medium text-t3">Orders</th>
                  <th className="px-3 py-1.5 text-right font-medium text-t3">GMV</th>
                  <th className="px-3 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.recentSessions.slice(0, 5).map((show) => {
                  const when = show.startedAt ?? show.scheduledFor;
                  return (
                    <tr key={show.id} className="h-[var(--row-h)] hover:bg-surface">
                      <td className="max-w-[24rem] truncate px-3 font-medium text-t1">
                        {show.title}
                      </td>
                      <td className="whitespace-nowrap px-3 tabular-nums text-t2">
                        {when === null ? 'unscheduled' : dateTime.format(new Date(when))}
                      </td>
                      <td className="px-3 text-right tabular-nums text-t2">
                        {nf.format(show.peakViewers)}
                      </td>
                      <td className="px-3 text-right tabular-nums text-t2">
                        {nf.format(show.orders)}
                      </td>
                      <td className="px-3 text-right font-semibold tabular-nums text-t1">
                        {formatInr(show.gmvMinorUnits)}
                      </td>
                      <td className="px-3 text-right">
                        <Link to={`/shows/${show.id}/report`} className="link">
                          Report
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </RoleGate>
  );
};

export default Today;
