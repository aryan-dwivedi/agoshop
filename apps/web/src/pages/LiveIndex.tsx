import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import type { LiveSessionDto, SessionStatus } from '@shop/shared';

import { LiveBadge } from '../components/live/LiveBadge';
import { LivePreviewMedia, SessionCoverImage } from '../components/live/LivePreviewMedia';
import { ChevronRight, PlayIcon, TagIcon } from '../components/icons';
import { api } from '../lib/api';
import { sellerUrl } from '../lib/origins';
import { useSession } from '../state/session';

/** Upcoming, live now, watch again — the three states a session can be shopped in. */

const RAILS: {
  status: SessionStatus;
  title: string;
  blurb: string;
  empty: string;
  /** Narrows the rail to the sessions it can honestly link to. */
  playable?: (session: LiveSessionDto) => boolean;
}[] = [
  {
    status: 'scheduled',
    title: 'Upcoming',
    blurb: 'Open the room early to browse the line-up.',
    empty: 'No sessions scheduled yet.',
  },
  {
    status: 'ended',
    title: 'Watch again',
    blurb: 'Recordings with searchable transcripts and the same assistant.',
    empty: 'No recordings ready yet — a session lands here once its video finishes processing.',
    // An ended session whose recording never became `ready` has no video to play, so
    // advertising it as a replay would send the shopper to an empty player.
    playable: (session) => session.recordingStatus === 'ready' && session.recordingUrl !== null,
  },
];

const formatWhen = (session: LiveSessionDto): string => {
  const iso =
    session.status === 'live'
      ? session.startedAt
      : session.status === 'scheduled'
        ? session.scheduledFor
        : session.endedAt;
  if (!iso) return '';
  const date = new Date(iso);
  const time = date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  if (session.status === 'live') return `Started ${time}`;
  if (session.status === 'scheduled') return time;
  return `Ended ${time}`;
};

/** The one session on air, given the storefront's biggest tile. */
const LiveHero = ({
  session,
  canHost,
}: {
  session: LiveSessionDto;
  canHost: boolean;
}): JSX.Element => (
  <section className="card animate-fade-in overflow-hidden lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
    <div className="group relative block overflow-hidden bg-bg">
      <div className="aspect-video w-full overflow-hidden">
        <LivePreviewMedia session={session} variant="hero" />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10" />
      <div className="absolute left-3 top-3">
        <LiveBadge
          status={session.status}
          viewerCount={session.viewerCount}
          deliveryTier={session.deliveryTier}
          onDark
        />
      </div>
    </div>

    <div className="flex flex-col justify-center gap-3 p-5 md:p-6">
      <p className="eyebrow text-live">On air now</p>
      <h2 className="font-display text-23 font-semibold leading-tight text-t1 md:text-28">
        {session.title}
      </h2>
      <p className="text-14 text-t2">
        {session.hostName} · {session.sellerName}
      </p>
      {session.description && (
        <p className="line-clamp-2 text-13 leading-relaxed text-t2">{session.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {session.viewerCount >= 10 && (
          <span className="badge-neutral tnum">
            {session.viewerCount.toLocaleString('en-IN')} watching
          </span>
        )}
        <span className="badge-accent">
          <TagIcon className="h-3.5 w-3.5" />
          Live offer
        </span>
      </div>

      {session.products.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="flex -space-x-2">
            {session.products
              .slice(0, 5)
              .map((p) =>
                p.imageUrl === null ? null : (
                  <img
                    key={p.productId}
                    src={p.imageUrl}
                    alt=""
                    loading="lazy"
                    className="h-10 w-10 rounded-ctl border-2 border-white bg-bg object-cover shadow-e1"
                  />
                ),
              )}
          </span>
          <span className="text-13 font-medium text-t3">
            {session.products.length} product{session.products.length === 1 ? '' : 's'} in the
            line-up
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Link to={`/live/${session.slug}`} className="btn-commit">
          <PlayIcon className="h-4 w-4" />
          Watch live
        </Link>
        {canHost && (
          <a
            href={sellerUrl(`/live/${session.slug}`)}
            target="_blank"
            rel="noreferrer"
            className="btn-standard"
          >
            Host console
          </a>
        )}
      </div>
    </div>
  </section>
);

/** The "nothing is on air" hero: the schedule below is the next best thing. */
const IdleHero = (): JSX.Element => (
  <section className="card flex flex-col justify-center gap-3 p-6 md:p-8">
    <p className="eyebrow text-accent-text">Live shopping</p>
    <h2 className="max-w-2xl font-display text-23 font-semibold leading-tight text-t1 md:text-28">
      More ways to shop, live.
    </h2>
    <p className="max-w-2xl text-14 leading-relaxed text-t2">
      Browse upcoming shows and recent replays, or continue shopping the catalog.
    </p>
    <div className="flex flex-wrap gap-2 pt-1">
      <Link to="/search?sort=rating" className="btn-standard">
        Top-rated catalog
      </Link>
    </div>
  </section>
);

const HeroSkeleton = (): JSX.Element => (
  <section className="card overflow-hidden lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
    <div className="skeleton aspect-video w-full rounded-none" />
    <div className="space-y-3 p-6">
      <div className="skeleton h-4 w-24" />
      <div className="skeleton h-7 w-3/4" />
      <div className="skeleton h-4 w-1/2" />
      <div className="skeleton h-10 w-36" />
    </div>
  </section>
);

const SessionTile = ({
  session,
  canHost,
}: {
  session: LiveSessionDto;
  canHost: boolean;
}): JSX.Element => {
  // Ended sessions open their recording; everything else opens the room.
  const target = session.status === 'ended' ? `/replay/${session.slug}` : `/live/${session.slug}`;

  return (
    <li className="card-hover group flex flex-col overflow-hidden">
      <Link to={target} className="relative block overflow-hidden bg-bg">
        <div className="aspect-video w-full overflow-hidden">
          {session.status === 'live' ? (
            <LivePreviewMedia session={session} variant="tile" />
          ) : (
            <SessionCoverImage session={session} variant="tile" />
          )}
        </div>
        <div className="absolute left-2.5 top-2.5">
          <LiveBadge
            status={session.status}
            viewerCount={session.viewerCount}
            deliveryTier={session.deliveryTier}
            peakViewers={session.peakViewers}
          />
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <Link
          to={target}
          className="line-clamp-2 text-14 font-semibold leading-snug text-t1 group-hover:text-accent-text"
        >
          {session.title}
        </Link>
        <p className="text-13 font-medium text-t2">
          {session.hostName} · {session.sellerName}
        </p>
        <p className="text-13 text-t3">{formatWhen(session)}</p>
        <p className="line-clamp-2 pt-0.5 text-13 leading-relaxed text-t3">{session.description}</p>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          <Link
            to={target}
            className={`${session.status === 'live' ? 'btn-commit' : 'btn-standard'} btn-sm`}
          >
            {session.status === 'live'
              ? 'Watch live'
              : session.status === 'ended'
                ? 'Watch replay'
                : 'Open room'}
          </Link>
          {canHost && session.status !== 'ended' && (
            <a
              href={sellerUrl(`/live/${session.slug}`)}
              target="_blank"
              rel="noreferrer"
              className="btn-quiet btn-sm"
            >
              Host console
            </a>
          )}
          {session.products.length > 0 && (
            <span className="ml-auto text-13 font-medium text-t3">
              {session.products.length} product{session.products.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
    </li>
  );
};

const Rail = ({
  status,
  title,
  blurb,
  empty,
  playable,
  canHost,
}: (typeof RAILS)[number] & { canHost: boolean }): JSX.Element => {
  // Same key *and* same cached shape as the header badge and the home spotlight:
  // a bare array under this key would break every other reader of the cache.
  const query = useQuery<{ sessions: LiveSessionDto[] }, Error>({
    queryKey: ['sessions', status],
    queryFn: () => api.get<{ sessions: LiveSessionDto[] }>(`/api/sessions?status=${status}`),
    refetchInterval: status === 'live' ? 30_000 : false,
  });
  const rows = query.data?.sessions;
  const sessions = rows === undefined || playable === undefined ? rows : rows.filter(playable);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-3">
        <h2 className="section-title">{title}</h2>
        <p className="text-13 text-t3">{blurb}</p>
      </div>

      <div className="p-4">
        {query.isLoading && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <li key={i} className="skeleton aspect-[4/5]" />
            ))}
          </ul>
        )}

        {query.isError && (
          <p className="text-14 text-danger">Shows could not be loaded. {query.error.message}</p>
        )}

        {sessions && sessions.length === 0 && <p className="text-14 text-t3">{empty}</p>}

        {sessions && sessions.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((session) => (
              <SessionTile key={session.id} session={session} canHost={canHost} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

const LiveIndex = (): JSX.Element => {
  const { user } = useSession();
  const canHost = user?.role === 'seller';

  const liveQuery = useQuery<{ sessions: LiveSessionDto[] }, Error>({
    queryKey: ['sessions', 'live'],
    queryFn: () => api.get<{ sessions: LiveSessionDto[] }>('/api/sessions?status=live'),
    refetchInterval: 30_000,
  });

  const onAir = liveQuery.data?.sessions[0];
  const alsoLive = liveQuery.data?.sessions.slice(1) ?? [];

  return (
    <div className="space-y-8 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <p className="eyebrow text-live">Live shopping</p>
          <h1 className="mt-1 font-display text-28 font-semibold text-t1">
            Shop shows and replays
          </h1>
          <p className="mt-1 text-14 leading-relaxed text-t2">
            See products demonstrated by hosts, ask questions, and add them to the same cart you use
            across the store.
          </p>
        </div>
        <Link
          to="/search"
          className="inline-flex items-center gap-1 text-14 font-semibold text-accent-text hover:underline"
        >
          Browse the catalog
          <ChevronRight className="h-4 w-4" />
        </Link>
      </header>

      {liveQuery.isLoading ? (
        <HeroSkeleton />
      ) : onAir ? (
        <LiveHero session={onAir} canHost={canHost} />
      ) : (
        <IdleHero />
      )}

      {alsoLive.length > 0 && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-3">
            <h2 className="section-title">Also live now</h2>
            <p className="text-13 text-t3">Other shows on air now.</p>
          </div>
          <ul className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {alsoLive.map((session) => (
              <SessionTile key={session.id} session={session} canHost={canHost} />
            ))}
          </ul>
        </section>
      )}

      {RAILS.map((rail) => (
        <Rail key={rail.status} {...rail} canHost={canHost} />
      ))}
    </div>
  );
};

export default LiveIndex;
