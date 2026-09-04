import { type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { formatInr, type SessionAnalyticsDto } from '@shop/shared';

import { RoleGate } from '../../components/seller/RoleGate';
import { Metric } from '../../components/seller/Metric';
import { ViewerChart } from '../../components/seller/ViewerChart';
import { customerUrl } from '../../lib/origins';
import { useSellerSessions, useSessionAnalytics } from '../../lib/sellerApi';

const nf = new Intl.NumberFormat('en-IN');

const Panel = ({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}): JSX.Element => (
  <section className="card overflow-hidden">
    <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
      <h2 className="section-title">{title}</h2>
      {note !== undefined && <span className="text-13 text-t3">{note}</span>}
    </header>
    {children}
  </section>
);

const DiscountTable = ({
  discountByCode,
}: {
  discountByCode: SessionAnalyticsDto['discountByCode'];
}): JSX.Element => {
  const rows = Object.entries(discountByCode).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, minorUnits]) => sum + minorUnits, 0);

  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-14 text-t3">
        No promotions were used during this show.
      </p>
    );
  }

  return (
    <table className="w-full text-13">
      <thead className="border-b border-line bg-bg text-left text-t3">
        <tr>
          <th className="px-4 py-2 font-medium">Code</th>
          <th className="px-4 py-2 text-right font-medium">Discount</th>
          <th className="px-4 py-2 text-right font-medium">Share</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map(([code, minorUnits]) => (
          <tr key={code}>
            <td className="px-4 py-2.5">
              <span className="badge-neutral font-mono text-t1">{code}</span>
            </td>
            <td className="tnum px-4 py-2.5 text-right font-semibold text-success">
              {formatInr(minorUnits)}
            </td>
            <td className="tnum px-4 py-2.5 text-right text-t2">
              {total === 0 ? '—' : `${((minorUnits / total) * 100).toFixed(0)}%`}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-line bg-bg text-t1">
          <td className="px-4 py-2.5 text-13 font-medium text-t3">Total</td>
          <td className="tnum px-4 py-2.5 text-right font-semibold">{formatInr(total)}</td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
};

const Body = ({ sessionId }: { sessionId: string }): JSX.Element => {
  const analytics = useSessionAnalytics(sessionId, true);
  const sessions = useSellerSessions(true);
  const session = sessions.data?.sessions.find((s) => s.id === sessionId) ?? null;

  if (analytics.isLoading) {
    return <div className="card p-8 text-14 text-t3">Loading show report…</div>;
  }

  if (analytics.isError) {
    return (
      <div className="card p-6">
        <p className="rounded-ctl border border-live bg-live-wash px-3 py-2 text-14 text-danger">
          This show report could not be loaded.
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-standard" onClick={() => void analytics.refetch()}>
            Try again
          </button>
          <Link to="/shows" className="btn-quiet">
            Back to shows
          </Link>
        </div>
      </div>
    );
  }

  const data = analytics.data;
  if (data === undefined) {
    return <div className="card p-8 text-14 text-t3">No report is available for this show.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Peak viewers"
          value={nf.format(data.peakViewers)}
          hint={`${nf.format(data.uniqueViewers)} unique viewers`}
        />
        <Metric
          label="Average watch"
          value={`${Math.floor(data.avgWatchSeconds / 60)}m ${String(Math.round(data.avgWatchSeconds % 60)).padStart(2, '0')}s`}
        />
        <Metric
          label="Sales"
          value={formatInr(data.gmvMinorUnits)}
          hint={`${nf.format(data.orders)} paid orders`}
        />
        <Metric
          label="Conversion"
          value={`${(data.conversionRate * 100).toFixed(1)}%`}
          hint={`${nf.format(data.addToCarts)} added to cart`}
        />
        <Metric label="Checkout declines" value={nf.format(data.checkoutDeclines)} />
        <Metric label="Chat messages" value={nf.format(data.chatMessages)} />
        <Metric label="Reactions" value={nf.format(data.reactions)} />
        <Metric label="Poll votes" value={nf.format(data.pollVotes)} />
      </div>

      <Panel title="Viewers over time" note="one point per minute">
        <div className="p-4">
          <ViewerChart series={data.viewerSeries} peakViewers={data.peakViewers} />
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Discount by code">
          <DiscountTable discountByCode={data.discountByCode} />
        </Panel>

        <Panel title="Top products" note="while each product was featured">
          {data.topProducts.length === 0 ? (
            <p className="px-4 py-8 text-center text-14 text-t3">
              No product activity was recorded for this show.
            </p>
          ) : (
            <table className="w-full text-13">
              <thead className="border-b border-line bg-bg text-left text-t3">
                <tr>
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 text-right font-medium">Added</th>
                  <th className="px-4 py-2 text-right font-medium">Orders</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.topProducts.map((product) => (
                  <tr key={product.productId} className="transition hover:bg-bg">
                    <td className="px-4 py-2.5 font-medium text-t1">{product.title}</td>
                    <td className="tnum px-4 py-2.5 text-right text-t2">
                      {nf.format(product.addToCarts)}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-t2">
                      {nf.format(product.orders)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {session !== null && (
        <div className="card flex flex-wrap items-center gap-3 px-4 py-3 text-13 text-t2">
          <span className="font-medium text-t1">{session.title}</span>
          <Link
            to={`/audience?sessionId=${sessionId}`}
            className="font-semibold text-accent-text hover:underline"
          >
            Audience log →
          </Link>
          {session.status === 'ended' && session.recordingStatus === 'ready' && (
            <a
              href={customerUrl(`/replay/${session.slug}`)}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-accent-text hover:underline"
            >
              Watch replay →
            </a>
          )}
        </div>
      )}
    </div>
  );
};

const SessionAnalytics = (): JSX.Element => {
  const { id } = useParams<{ id: string }>();

  return (
    <RoleGate
      roles={['seller']}
      title="Show report"
      subtitle="Audience, engagement, product activity, and paid sales from this show."
      actions={
        <Link to="/shows" className="btn-standard">
          All shows
        </Link>
      }
    >
      {id === undefined ? (
        <div className="card p-6 text-sm text-slate-600">No session id in the URL.</div>
      ) : (
        <Body sessionId={id} />
      )}
    </RoleGate>
  );
};

export default SessionAnalytics;
