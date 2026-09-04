import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LiveSessionDto } from '@shop/shared';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { GridSkeleton, ProductGrid, type ProductListDto } from '../components/ProductRail';
import { LiveBadge } from '../components/live/LiveBadge';
import { LivePreviewMedia, SessionCoverImage } from '../components/live/LivePreviewMedia';
import { ChevronRight, PlayIcon } from '../components/icons';
import { ApiError, api } from '../lib/api';
type Creator = {
    id: string;
    slug: string;
    name: string;
    productCount: number;
    rating: number;
};
type CreatorSource = {
    seller: Creator | null;
    sessions: LiveSessionDto[];
};
const loadCreator = async (slug: string): Promise<CreatorSource> => {
    try {
        const res = await api.get<{
            seller: Creator;
            sessions: LiveSessionDto[];
        }>(`/api/sellers/${encodeURIComponent(slug)}`);
        return { seller: res.seller, sessions: res.sessions };
    }
    catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
            return { seller: null, sessions: [] };
        }
        throw err;
    }
};
type CreatorView = {
    seller: Creator | null;
    live: LiveSessionDto[];
    scheduled: LiveSessionDto[];
    replays: LiveSessionDto[];
    cover: LiveSessionDto | null;
    next: LiveSessionDto | null;
    showCount: number;
    languages: string[];
    serverNowMs: number | null;
};
const time = (iso: string | null): number => (iso === null ? 0 : new Date(iso).getTime());
const toView = (source: CreatorSource): CreatorView => {
    const live = source.sessions
        .filter((s) => s.status === 'live')
        .sort((a, b) => b.viewerCount - a.viewerCount);
    const scheduled = source.sessions
        .filter((s) => s.status === 'scheduled')
        .sort((a, b) => time(a.scheduledFor) - time(b.scheduledFor));
    const replays = source.sessions
        .filter((s) => s.status === 'ended')
        .sort((a, b) => time(b.endedAt) - time(a.endedAt));
    const languages = [...new Set(source.sessions.map((s) => s.language))].sort();
    return {
        seller: source.seller,
        live,
        scheduled,
        replays,
        cover: live[0] ?? scheduled[0] ?? replays[0] ?? null,
        next: scheduled[0] ?? null,
        showCount: source.sessions.length,
        languages,
        serverNowMs: source.sessions[0]?.serverNowMs ?? null,
    };
};
const WHEN: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
};
const formatWhen = (iso: string | null): string => {
    if (iso === null)
        return '';
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? '' : at.toLocaleString('en-IN', WHEN);
};
const sessionWhen = (session: LiveSessionDto): string => {
    if (session.status === 'live') {
        const started = formatWhen(session.startedAt);
        return started === '' ? 'On air' : `On air since ${started}`;
    }
    if (session.status === 'scheduled')
        return formatWhen(session.scheduledFor);
    const ended = formatWhen(session.endedAt);
    return ended === '' ? 'Recorded earlier' : `Recorded ${ended}`;
};
const countdown = (iso: string | null, nowMs: number): string | null => {
    if (iso === null)
        return null;
    const ms = new Date(iso).getTime() - nowMs;
    if (!Number.isFinite(ms) || ms <= 0 || ms > 24 * 60 * 60 * 1000)
        return null;
    const mins = Math.max(1, Math.round(ms / 60000));
    if (mins < 60)
        return `Starts in ${mins} min`;
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    return rest === 0 ? `Starts in ${hours}h` : `Starts in ${hours}h ${rest}m`;
};
const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language' });
const languageName = (tag: string): string => {
    try {
        return LANGUAGE_NAMES.of(tag) ?? tag;
    }
    catch {
        return tag;
    }
};
const isPlayable = (session: LiveSessionDto): boolean => session.status !== 'ended' ||
    (session.recordingStatus === 'ready' && session.recordingUrl !== null);
const sessionHref = (session: LiveSessionDto): string => session.status === 'ended' ? `/replay/${session.slug}` : `/live/${session.slug}`;
const shownViewers = (session: LiveSessionDto): number | undefined => session.status === 'live' && session.viewerCount >= 10 ? session.viewerCount : undefined;
const useServerNow = (serverNowMs: number | null): number => {
    const [skewMs, setSkewMs] = useState(0);
    const [localMs, setLocalMs] = useState(() => Date.now());
    useEffect(() => {
        if (serverNowMs !== null)
            setSkewMs(serverNowMs - Date.now());
    }, [serverNowMs]);
    useEffect(() => {
        const timer = window.setInterval(() => setLocalMs(Date.now()), 30000);
        return () => window.clearInterval(timer);
    }, []);
    return localMs + skewMs;
};
const SHOW_MINUTES = 60;
const stamp = (at: Date): string => at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
const escapeIcs = (value: string): string => value.replace(/([\\,;])/g, '\\$1').replace(/\r?\n/g, '\\n');
const calendarLinks = (session: LiveSessionDto): {
    google: string;
    ics: string;
    filename: string;
} | null => {
    if (session.scheduledFor === null)
        return null;
    const start = new Date(session.scheduledFor);
    if (Number.isNaN(start.getTime()))
        return null;
    const end = new Date(start.getTime() + SHOW_MINUTES * 60000);
    const room = `${window.location.origin}/live/${session.slug}`;
    const title = `${session.title} · ${session.sellerName}`;
    const details = `${session.hostName} is selling live. Room: ${room}`;
    const google = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
        `&text=${encodeURIComponent(title)}` +
        `&dates=${stamp(start)}/${stamp(end)}` +
        `&details=${encodeURIComponent(details)}` +
        `&location=${encodeURIComponent(room)}`;
    const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//agoshop//shows//EN',
        'BEGIN:VEVENT',
        `UID:${session.id}@agoshop`,
        `DTSTAMP:${stamp(new Date())}`,
        `DTSTART:${stamp(start)}`,
        `DTEND:${stamp(end)}`,
        `SUMMARY:${escapeIcs(title)}`,
        `DESCRIPTION:${escapeIcs(details)}`,
        `URL:${room}`,
        'END:VEVENT',
        'END:VCALENDAR',
    ].join('\r\n');
    return {
        google,
        ics: `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`,
        filename: `${session.slug}.ics`,
    };
};
const RemindMe = ({ session, nowMs, }: {
    session: LiveSessionDto;
    nowMs: number;
}): JSX.Element | null => {
    const [open, setOpen] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);
    const links = useMemo(() => calendarLinks(session), [session]);
    useEffect(() => {
        if (!open)
            return undefined;
        const onKey = (event: globalThis.KeyboardEvent): void => {
            if (event.key === 'Escape')
                setOpen(false);
        };
        const onPointer = (event: MouseEvent): void => {
            if (wrap.current !== null && !wrap.current.contains(event.target as Node))
                setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onPointer);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onPointer);
        };
    }, [open]);
    if (links === null || time(session.scheduledFor) <= nowMs)
        return null;
    return (<div ref={wrap} className="relative">
      <button type="button" className="btn-standard" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        Remind me
      </button>

      {open && (<div role="menu" aria-label="Add this show to a calendar" className="animate-slide-down absolute right-0 z-20 mt-2 w-72 rounded-ctl border border-line bg-menu p-2 shadow-sheet">
          <a role="menuitem" href={links.google} target="_blank" rel="noreferrer" className="block rounded-ctl px-3 py-2 text-14 text-t1 hover:bg-surface" onClick={() => setOpen(false)}>
            Add to Google Calendar
          </a>
          <a role="menuitem" href={links.ics} download={links.filename} className="block rounded-ctl px-3 py-2 text-14 text-t1 hover:bg-surface" onClick={() => setOpen(false)}>
            Download calendar file
          </a>
          <p className="px-3 pb-1 pt-2 text-13 text-t2">
            This adds the show to your calendar. Nothing gets sent to you.
          </p>
        </div>)}
    </div>);
};
const CoverCta = ({ session }: {
    session: LiveSessionDto;
}): JSX.Element | null => {
    if (!isPlayable(session)) {
        return (<p className="text-on-video text-14 font-medium">The replay will be here in a few minutes.</p>);
    }
    if (session.status === 'live') {
        return (<Link to={sessionHref(session)} className="btn-commit btn-lg shrink-0">
        <PlayIcon className="h-4 w-4"/>
        Watch now
      </Link>);
    }
    return (<Link to={sessionHref(session)} className="btn on-video shrink-0">
      {session.status === 'scheduled' ? 'Open the room' : 'Watch the replay'}
    </Link>);
};
const Cover = ({ creator, session, nowMs, }: {
    creator: Creator;
    session: LiveSessionDto;
    nowMs: number;
}): JSX.Element => {
    const viewers = shownViewers(session);
    const starts = session.status === 'scheduled' ? countdown(session.scheduledFor, nowMs) : null;
    return (<section className="card relative overflow-hidden">
      <div className="aspect-video w-full overflow-hidden sm:aspect-[2/1] lg:aspect-[21/9]">
        {session.status === 'live' ? (<LivePreviewMedia session={session} variant="hero"/>) : (<SessionCoverImage session={session} variant="hero"/>)}
      </div>

      <div className="scrim-bottom absolute inset-x-0 bottom-0 p-4 pt-10 sm:p-5 sm:pt-14">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {session.status === 'live' ? (<span className="badge-live">
                  <span className="animate-breathe h-1.5 w-1.5 rounded-full bg-live-ink"/>
                  Live
                </span>) : (<span className="pill on-video text-14">
                  {session.status === 'scheduled' ? 'Scheduled' : 'Replay'}
                </span>)}
              {viewers !== undefined && (<span className="pill on-video tnum text-14">
                  {viewers.toLocaleString('en-IN')} watching
                </span>)}
            </div>

            <h1 className="text-on-video mt-2 truncate text-23 font-semibold tracking-[-0.01em] sm:text-28">
              {creator.name}
            </h1>
            <p className="text-on-video mt-0.5 text-14 font-medium">
              {session.title}
              {session.status !== 'live' && sessionWhen(session) !== '' && (<span> · {sessionWhen(session)}</span>)}
            </p>
            {starts !== null && (<p className="text-on-video tnum mt-0.5 text-14 font-medium">{starts}</p>)}
          </div>

          <CoverCta session={session}/>
        </div>
      </div>
    </section>);
};
const IdentityHeader = ({ creator }: {
    creator: Creator;
}): JSX.Element => (<section className="card p-5">
    <p className="eyebrow">Creator</p>
    <h1 className="mt-1 text-28 font-semibold tracking-[-0.01em] text-t1">{creator.name}</h1>
    <p className="tnum mt-1 text-14 text-t2">
      {creator.rating.toFixed(1)} out of 5 · {creator.productCount} product
      {creator.productCount === 1 ? '' : 's'}
    </p>
  </section>);
const ShowTile = ({ session, nowMs }: {
    session: LiveSessionDto;
    nowMs: number;
}): JSX.Element => {
    const playable = isPlayable(session);
    const href = sessionHref(session);
    const starts = session.status === 'scheduled' ? countdown(session.scheduledFor, nowMs) : null;
    const picture = session.status === 'live' ? (<LivePreviewMedia session={session} variant="tile"/>) : (<SessionCoverImage session={session} variant="tile"/>);
    return (<li className="card-hover flex flex-col gap-2.5 p-2.5">
      <div className="relative aspect-video w-full overflow-hidden rounded-ctl">
        {playable ? (<Link to={href} className="block h-full w-full" tabIndex={-1} aria-hidden="true">
            {picture}
          </Link>) : (picture)}
        <div className="absolute left-2 top-2">
          <LiveBadge status={session.status} viewerCount={shownViewers(session)} deliveryTier={session.deliveryTier} onDark/>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 px-1 pb-1">
        <h3 className="text-14 font-medium leading-snug text-t1">
          {playable ? (<Link to={href} className="transition-colors duration-ctl hover:text-accent">
              {session.title}
            </Link>) : (session.title)}
        </h3>
        <p className="text-13 text-t2">{sessionWhen(session)}</p>
        {starts !== null && <p className="tnum text-13 text-t2">{starts}</p>}
        {!playable && <p className="text-13 text-t2">The replay will be here in a few minutes.</p>}
      </div>
    </li>);
};
const ShowGroup = ({ title, sessions, nowMs, }: {
    title: string;
    sessions: LiveSessionDto[];
    nowMs: number;
}): JSX.Element => (<section>
    <h2 className="section-title">{title}</h2>
    <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sessions.map((session) => (<ShowTile key={session.id} session={session} nowMs={nowMs}/>))}
    </ul>
  </section>);
type SegmentId = 'shows' | 'catalog' | 'about';
type Segment = {
    id: SegmentId;
    label: string;
    count: number | null;
};
const Segments = ({ segments, active, onSelect, }: {
    segments: Segment[];
    active: SegmentId;
    onSelect: (id: SegmentId) => void;
}): JSX.Element => {
    const buttons = useRef<Partial<Record<SegmentId, HTMLButtonElement>>>({});
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const from = segments.findIndex((s) => s.id === active);
        const last = segments.length - 1;
        let to: number;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
            to = from >= last ? 0 : from + 1;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
            to = from <= 0 ? last : from - 1;
        else if (event.key === 'Home')
            to = 0;
        else if (event.key === 'End')
            to = last;
        else
            return;
        const target = segments[to];
        if (target === undefined)
            return;
        event.preventDefault();
        onSelect(target.id);
        buttons.current[target.id]?.focus();
    };
    return (<div role="tablist" aria-label="Creator sections" onKeyDown={onKeyDown} className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
      {segments.map((segment) => {
            const selected = segment.id === active;
            return (<button key={segment.id} ref={(node) => {
                    if (node === null)
                        delete buttons.current[segment.id];
                    else
                        buttons.current[segment.id] = node;
                }} type="button" role="tab" id={`creator-tab-${segment.id}`} aria-selected={selected} aria-controls={`creator-panel-${segment.id}`} tabIndex={selected ? 0 : -1} onClick={() => onSelect(segment.id)} className={selected ? 'chip-active' : 'chip'}>
            {segment.label}
            {segment.count !== null && <span className="tnum text-t3">{segment.count}</span>}
          </button>);
        })}
    </div>);
};
const AboutPanel = ({ creator, view }: {
    creator: Creator;
    view: CreatorView;
}): JSX.Element => {
    const facts: {
        term: string;
        value: string;
    }[] = [
        { term: 'Rating', value: `${creator.rating.toFixed(1)} out of 5` },
        { term: 'Products', value: String(creator.productCount) },
    ];
    if (view.showCount > 0)
        facts.push({ term: 'Shows', value: String(view.showCount) });
    if (view.languages.length > 0) {
        facts.push({ term: 'Hosted in', value: view.languages.map(languageName).join(', ') });
    }
    const newest = view.live[0] ?? view.scheduled[0] ?? view.replays[0] ?? null;
    const shows = view.showCount === 0
        ? ''
        : ` They have run ${view.showCount} live show${view.showCount === 1 ? '' : 's'} here.`;
    return (<div className="card p-5">
      <h2 className="section-title">About {creator.name}</h2>
      <p className="mt-2 max-w-prose text-16 leading-relaxed text-t2">
        {`${creator.name} lists ${creator.productCount} product${creator.productCount === 1 ? '' : 's'} on agoshop.${shows}`}
      </p>

      {facts.length > 0 && (<dl className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {facts.map((fact) => (<div key={fact.term} className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
              <dt className="text-13 text-t2">{fact.term}</dt>
              <dd className="text-14 font-medium text-t1">{fact.value}</dd>
            </div>))}
        </dl>)}

      {newest !== null && (<Link to={sessionHref(newest)} className="mt-5 inline-flex items-center gap-1 text-14 font-medium text-t1 hover:text-accent">
          {newest.status === 'live' ? 'Watch the current show' : `Latest show: ${newest.title}`}
          <ChevronRight className="h-4 w-4"/>
        </Link>)}
    </div>);
};
const CreatorSkeleton = (): JSX.Element => (<div className="space-y-4 py-4">
    <div className="skeleton aspect-video w-full sm:aspect-[2/1] lg:aspect-[21/9]"/>
    <div className="skeleton h-16 w-full"/>
    <div className="flex gap-2">
      <div className="skeleton h-8 w-24"/>
      <div className="skeleton h-8 w-24"/>
      <div className="skeleton h-8 w-20"/>
    </div>
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (<li key={i} className="skeleton h-64"/>))}
    </ul>
  </div>);
const Creator = (): JSX.Element => {
    const { slug = '' } = useParams<{
        slug: string;
    }>();
    const [segment, setSegment] = useState<SegmentId | null>(null);
    const profile = useQuery<CreatorSource, Error, CreatorView>({
        queryKey: ['creator', slug],
        queryFn: () => loadCreator(slug),
        select: toView,
        refetchInterval: (query) => query.state.data?.sessions.some((s) => s.status === 'live') === true ? 30000 : false,
    });
    const view = profile.data;
    const creator = view?.seller ?? null;
    const catalog = useQuery<ProductListDto, Error>({
        queryKey: ['products', { sellerId: creator?.id, pageSize: 24 }],
        queryFn: () => api.get<ProductListDto>(`/api/products?sellerId=${creator?.id ?? ''}&pageSize=24`),
        enabled: creator !== null,
    });
    const nowMs = useServerNow(view?.serverNowMs ?? null);
    const segments = useMemo<Segment[]>(() => {
        if (view === undefined || creator === null)
            return [];
        const rows: Segment[] = [];
        if (view.showCount > 0)
            rows.push({ id: 'shows', label: 'Shows', count: view.showCount });
        rows.push({
            id: 'catalog',
            label: 'Catalog',
            count: catalog.data?.total ?? creator.productCount,
        });
        rows.push({ id: 'about', label: 'About', count: null });
        return rows;
    }, [view, creator, catalog.data?.total]);
    const active: SegmentId = segment !== null && segments.some((s) => s.id === segment)
        ? segment
        : (segments[0]?.id ?? 'catalog');
    if (profile.isPending)
        return <CreatorSkeleton />;
    if (profile.isError) {
        return (<div className="py-4">
        <ErrorState title="This creator could not be loaded." error={profile.error} onRetry={() => void profile.refetch()}/>
      </div>);
    }
    if (view === undefined || creator === null) {
        return (<div className="py-4">
        <EmptyState title="We don’t have a creator at this link." body="The link may be out of date. Live shows are the quickest way to find someone selling right now." action={{ to: '/live', label: 'See what’s live' }}/>
      </div>);
    }
    const products = catalog.data?.items ?? [];
    const next = view.scheduled.find((s) => time(s.scheduledFor) > nowMs) ?? view.next;
    return (<div className="space-y-4 py-4">
      {view.cover !== null ? (<Cover creator={creator} session={view.cover} nowMs={nowMs}/>) : (<IdentityHeader creator={creator}/>)}

      {next !== null && (<section className="card flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3">
          <div className="min-w-0">
            <p className="eyebrow">Next show</p>
            <p className="mt-0.5 truncate text-16 font-medium text-t1">
              {formatWhen(next.scheduledFor)} · {next.title}
            </p>
            {countdown(next.scheduledFor, nowMs) !== null && (<p className="tnum mt-0.5 text-13 text-t2">{countdown(next.scheduledFor, nowMs)}</p>)}
          </div>
          <RemindMe session={next} nowMs={nowMs}/>
        </section>)}

      <Segments segments={segments} active={active} onSelect={setSegment}/>

      {active === 'shows' && (<div role="tabpanel" id="creator-panel-shows" aria-labelledby="creator-tab-shows" tabIndex={0} className="space-y-6">
          {view.live.length > 0 && (<ShowGroup title="On air now" sessions={view.live} nowMs={nowMs}/>)}
          {view.scheduled.length > 0 && (<ShowGroup title="Coming up" sessions={view.scheduled} nowMs={nowMs}/>)}
          {view.replays.length > 0 && (<ShowGroup title="Watch again" sessions={view.replays} nowMs={nowMs}/>)}
        </div>)}

      {active === 'catalog' && (<div role="tabpanel" id="creator-panel-catalog" aria-labelledby="creator-tab-catalog" tabIndex={0}>
          {catalog.isPending ? (<GridSkeleton />) : products.length > 0 ? (<ProductGrid products={products}/>) : (<EmptyState title={`${creator.name} has nothing listed yet.`} body="Their shows are the place to see what they sell next." action={{ to: '/live', label: 'See what’s live' }}/>)}
        </div>)}

      {active === 'about' && (<div role="tabpanel" id="creator-panel-about" aria-labelledby="creator-tab-about" tabIndex={0}>
          <AboutPanel creator={creator} view={view}/>
        </div>)}
    </div>);
};
export default Creator;
