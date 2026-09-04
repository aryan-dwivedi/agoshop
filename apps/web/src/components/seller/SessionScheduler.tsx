import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactNode } from 'react';

import { formatInr, type LiveSessionDto } from '@shop/shared';

import { ApiError, api } from '../../lib/api';
import { useSellerProducts } from '../../lib/sellerApi';
import { useSession } from '../../state/session';

/**
 * The session builder: three columns, one screen, no wizard.
 *
 * Details, Line-up and Pricing & schedule are the three questions a show is, and they
 * are independent — a wizard would impose an order the seller does not have, and the
 * single 655-line column it replaces put the line-up (the part that decides whether
 * anything can be sold at all) below the fold.
 *
 * How a show leaves this form:
 *
 *   `manual`   — created `scheduled`; the seller goes live from the broadcast room.
 *   `premiere` — created `scheduled` with `autoStart`; the server takes it live at
 *                `scheduledFor` with nobody at a console, so the uploaded video is the
 *                broadcast and an upload is mandatory.
 *   `now`      — created and started in the same request; `scheduledFor` is moot.
 *
 * A show on air keeps its line-up and live price editable and locks its schedule: chat
 * capacity is fixed at go-live and every client derives its shard from that number, so
 * moving it mid-show would split the room in half.
 */

type StartMode = 'manual' | 'premiere' | 'now';

/** A show being edited or duplicated: the public DTO plus the operator-only capacity hint. */
export type EditableShow = { session: LiveSessionDto; expectedPeakViewers: number };

export type SchedulerResult = {
  session: LiveSessionDto;
  /** Non-null when the show exists but its video did not upload. */
  uploadError: string | null;
  /** The file that failed, so the caller can offer a retry against the saved show. */
  videoFile: File | null;
};

type Draft = {
  title: string;
  slug: string;
  description: string;
  hostName: string;
  scheduledFor: string;
  language: string;
  expectedPeakViewers: string;
  /**
   * The room's live-only markdown, in whole percent. Empty means the show adds no rule
   * of its own and shoppers see whatever the catalog already carries.
   */
  liveDiscountPercent: string;
  coverImageUrl: string;
};

/** `datetime-local` gives wall-clock text; the API stores an instant. */
const localInputToIso = (value: string): string | null => {
  if (value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

/** An instant as the wall-clock text `datetime-local` expects; blank defaults to an hour out. */
const isoToLocalInput = (iso: string | null): string => {
  const t = iso === null ? new Date(Date.now() + 60 * 60 * 1000) : new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  t.setSeconds(0, 0);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
};

/** The server's ceiling for a show markdown, mirrored so the form refuses first. */
const MAX_LIVE_DISCOUNT_PERCENT = 90;

const DISCOUNT_PRESETS = [10, 20, 30];

/**
 * Blank and 0 both mean "this room adds no rule of its own", which the API stores as
 * `null` — an explicit 0% would otherwise read as a live price that saves nothing.
 */
const parseLiveDiscount = (value: string): number | null => {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const START_MODES: { value: StartMode; label: string; hint: string }[] = [
  {
    value: 'manual',
    label: 'I’ll go live',
    hint: 'Nothing is broadcast until you open the room and start it.',
  },
  {
    value: 'premiere',
    label: 'Premiere a video',
    hint: 'Goes live by itself at the start time, playing the uploaded video.',
  },
  {
    value: 'now',
    label: 'Go live now',
    hint: 'Created already on air — open the room to publish camera or the video.',
  },
];

/**
 * Multipart cannot go through the shared `api` helper: it serialises JSON and would
 * overwrite the boundary `content-type` the browser generates. Raw fetch, exactly as
 * the replay upload does it.
 *
 * Exported because a failed upload is retried from the show's row, not from this form:
 * the show already exists, and reopening the builder to retry a file invites the seller
 * to schedule the whole thing twice.
 */
export const uploadSourceVideo = async (sessionId: string, file: File): Promise<LiveSessionDto> => {
  const form = new FormData();
  form.append('video', file);

  const res = await fetch(`/api/sessions/${sessionId}/source-video`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  } catch {
    // A size rejection can come back as plain text from the body parser.
    parsed = null;
  }

  if (!res.ok) {
    const failure = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
    throw new Error(
      failure?.message ?? failure?.code ?? `The server rejected the upload (${res.status}).`,
    );
  }

  const body = parsed as { session?: LiveSessionDto } | null;
  if (!body?.session) throw new Error('The upload succeeded but the server returned no session.');
  return body.session;
};

const Column = ({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}): JSX.Element => (
  <section className="min-w-0 border-line px-3 py-3 lg:border-l lg:first:border-l-0">
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-14 font-semibold text-t1">{title}</h3>
      {note !== undefined && <span className="text-11 text-t3">{note}</span>}
    </div>
    {children}
  </section>
);

export const SessionScheduler = ({
  show,
  mode,
  onSaved,
  onClose,
}: {
  /** Prefill: the show being edited, or the ended show being duplicated. */
  show?: EditableShow | null;
  mode: 'create' | 'edit';
  onSaved: (result: SchedulerResult) => void;
  onClose: () => void;
}): JSX.Element => {
  const { config, user } = useSession();
  const queryClient = useQueryClient();
  const products = useSellerProducts(true);

  const source = show ?? null;
  const existing = mode === 'edit' ? source : null;
  const onAir = existing?.session.status === 'live';

  const [draft, setDraft] = useState<Draft>(() => ({
    title:
      source === null
        ? ''
        : mode === 'edit'
          ? source.session.title
          : `${source.session.title} (copy)`,
    slug: existing === null ? '' : existing.session.slug,
    description: source?.session.description ?? '',
    hostName: source?.session.hostName ?? user?.displayName ?? '',
    scheduledFor: isoToLocalInput(mode === 'edit' ? (source?.session.scheduledFor ?? null) : null),
    language: source?.session.language ?? config?.supportedLanguages[0] ?? 'en-US',
    expectedPeakViewers: String(source?.expectedPeakViewers ?? 50),
    liveDiscountPercent:
      source?.session.discountPercent == null ? '' : String(source.session.discountPercent),
    coverImageUrl: source?.session.coverImageUrl ?? '',
  }));
  const [startMode, setStartMode] = useState<StartMode>(
    source?.session.autoStart === true ? 'premiere' : 'manual',
  );
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>(() =>
    source === null
      ? []
      : [...source.session.products]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((product) => product.productId),
  );
  const [featured, setFeatured] = useState<string | null>(
    () => source?.session.products.find((product) => product.isFeatured)?.productId ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  const languages = config?.supportedLanguages ?? [];
  const catalogue = products.data?.products ?? [];

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return catalogue;
    return catalogue.filter(
      (product) =>
        product.title.toLowerCase().includes(needle) ||
        product.brand.toLowerCase().includes(needle) ||
        product.categorySlug.includes(needle),
    );
  }, [catalogue, query]);

  const outOfStock = useMemo(() => {
    const byId = new Map(catalogue.map((product) => [product.productId, product]));
    return picked.filter((id) => byId.get(id)?.totalStock === 0).length;
  }, [catalogue, picked]);

  const save = useMutation({
    mutationFn: async (): Promise<SchedulerResult> => {
      const discount = parseLiveDiscount(draft.liveDiscountPercent);
      let session: LiveSessionDto;

      if (existing === null) {
        session = await api.post<LiveSessionDto>('/api/sessions', {
          title: draft.title.trim(),
          ...(draft.slug.trim() === '' ? {} : { slug: draft.slug.trim() }),
          description: draft.description.trim(),
          hostName: draft.hostName.trim(),
          // An instant show starts now, so a wall-clock start time would be a lie.
          scheduledFor: startMode === 'now' ? null : localInputToIso(draft.scheduledFor),
          language: draft.language,
          expectedPeakViewers: Number.parseInt(draft.expectedPeakViewers, 10),
          coverImageUrl: draft.coverImageUrl.trim() === '' ? null : draft.coverImageUrl.trim(),
          // A show can open with its markdown already set, so the first viewer of a
          // premiere sees the same live price as one who joins an hour in.
          discountPercent: discount,
          autoStart: startMode === 'premiere',
          startNow: startMode === 'now',
        });
      } else {
        const body = await api.patch<{ session: LiveSessionDto }>(
          `/api/sessions/${existing.session.id}`,
          {
            title: draft.title.trim(),
            description: draft.description.trim(),
            hostName: draft.hostName.trim(),
            language: draft.language,
            coverImageUrl: draft.coverImageUrl.trim() === '' ? null : draft.coverImageUrl.trim(),
            // A show on air has its capacity fixed and its slot behind it: the schedule
            // is not editable, so it is not sent.
            ...(onAir
              ? {}
              : {
                  scheduledFor: localInputToIso(draft.scheduledFor),
                  expectedPeakViewers: Number.parseInt(draft.expectedPeakViewers, 10),
                  autoStart: startMode === 'premiere',
                }),
          },
        );
        session = body.session;

        // The live price has its own endpoint because it republishes the room's ladder;
        // a silent path through PATCH would leave open carts on a stale badge.
        if (discount !== (existing.session.discountPercent ?? null)) {
          const priced = await api.patch<{ session: LiveSessionDto }>(
            `/api/sessions/${session.id}/pricing`,
            { discountPercent: discount },
          );
          session = priced.session;
        }
      }

      let failedUpload: string | null = null;
      if (videoFile !== null) {
        try {
          session = await uploadSourceVideo(session.id, videoFile);
        } catch (err) {
          failedUpload = err instanceof Error ? err.message : 'The video upload failed.';
        }
      }

      if (picked.length > 0) {
        // Replace semantics: the posted set becomes the line-up, in the order shown.
        await api.post(`/api/sessions/${session.id}/products`, {
          items: picked.map((productId, index) => ({
            productId,
            sortOrder: index,
            isFeatured: productId === (featured ?? picked[0]),
          })),
        });
      }

      return { session, uploadError: failedUpload, videoFile };
    },
    onSuccess: async (result) => {
      setError(null);
      if (result.uploadError === null) {
        setVideoFile(null);
        if (videoInputRef.current) videoInputRef.current.value = '';
      }
      onSaved(result);
      // Prefix match: every storefront scope of the shows list is stale, and so are the
      // public lists the storefront and the premiere markers read.
      await queryClient.invalidateQueries({ queryKey: ['seller', 'sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(
          err.code === 'slug_taken'
            ? 'That address is taken — pick another, or leave it blank to derive one from the title.'
            : err.code === 'multiple_featured'
              ? 'Only one product can be on camera first.'
              : err.message,
        );
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not save this show.');
    },
  });

  const expected = Number.parseInt(draft.expectedPeakViewers, 10);
  /**
   * A premiere runs with nobody at the console: without a video the server would take
   * the show live into an empty channel, so the combination is refused here rather than
   * shipped to viewers as a black screen.
   */
  const premiereNeedsVideo =
    startMode === 'premiere' && videoFile === null && existing?.session.sourceVideoUrl == null;
  const premiereNeedsTime =
    startMode === 'premiere' && localInputToIso(draft.scheduledFor) === null;
  const liveDiscount = parseLiveDiscount(draft.liveDiscountPercent);
  const discountOutOfRange = liveDiscount !== null && liveDiscount > MAX_LIVE_DISCOUNT_PERCENT;
  /** The API replaces a line-up but cannot empty one, so the form will not pretend it can. */
  const emptiedLineUp =
    existing !== null && picked.length === 0 && existing.session.products.length > 0;

  const blocked =
    draft.title.trim().length < 3
      ? 'a title of at least three characters'
      : !onAir && (!Number.isFinite(expected) || expected <= 0)
        ? 'an expected peak above zero'
        : premiereNeedsVideo
          ? 'a video — a premiere has no host to fall back on'
          : premiereNeedsTime
            ? 'a start time — that instant is what the server watches for'
            : discountOutOfRange
              ? `a live price at or under ${MAX_LIVE_DISCOUNT_PERCENT}% off`
              : emptiedLineUp
                ? 'at least one product on the line-up'
                : null;

  return (
    <form
      className="card mb-4 overflow-hidden"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-14 font-semibold text-t1">
          {existing !== null
            ? `Editing ${existing.session.title}`
            : source === null
              ? 'New show'
              : `Duplicate of ${source.session.title}`}
        </h2>
        <div className="flex items-center gap-2">
          {onAir && (
            <span className="badge-live">
              <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-live-ink" />
              on air
            </span>
          )}
          <button type="button" className="btn-quiet btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      <div className="grid lg:grid-cols-3">
        <Column title="Details">
          <label className="mb-2 block">
            <span className="label">Title</span>
            <input
              className="input"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="Festive Edit — handloom sarees"
              required
            />
          </label>

          <label className="mb-2 block">
            <span className="label">Address</span>
            <input
              className="input"
              value={draft.slug}
              disabled={existing !== null}
              onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
              placeholder="derived from the title if left blank"
              pattern="[a-z0-9][a-z0-9-]{1,60}"
            />
            <span className="mt-1 block text-11 text-t3">
              {existing === null
                ? 'The address shoppers open this show at.'
                : 'Fixed once the show exists — shoppers may already hold the link.'}
            </span>
          </label>

          <label className="mb-2 block">
            <span className="label">Description</span>
            <textarea
              className="input min-h-[64px]"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="What shoppers see on the show card."
            />
          </label>

          <label className="mb-2 block">
            <span className="label">Host name</span>
            <input
              className="input"
              value={draft.hostName}
              onChange={(event) => setDraft({ ...draft, hostName: event.target.value })}
            />
          </label>

          <label className="mb-2 block">
            <span className="label">Language</span>
            <select
              className="input"
              value={draft.language}
              onChange={(event) => setDraft({ ...draft, language: event.target.value })}
            >
              {languages.length === 0 ? (
                <option value="en-US">en-US</option>
              ) : (
                languages.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="mb-2 block">
            <span className="label">Cover image</span>
            <input
              className="input"
              value={draft.coverImageUrl}
              onChange={(event) => setDraft({ ...draft, coverImageUrl: event.target.value })}
              placeholder="/media/covers/festive-edit.jpg"
            />
          </label>

          <label className="block">
            <span className="label">Expected peak viewers</span>
            <input
              type="number"
              min={1}
              className="input"
              value={draft.expectedPeakViewers}
              disabled={onAir}
              onChange={(event) => setDraft({ ...draft, expectedPeakViewers: event.target.value })}
            />
            <span className="mt-1 block text-11 leading-tight text-t3">
              {onAir
                ? 'Fixed for the rest of this show — chat capacity was set when it went on air.'
                : 'A capacity hint, not a cap. Chat capacity is set from it at go-live and holds for the whole show.'}
            </span>
          </label>
        </Column>

        <Column
          title="Line-up"
          note={
            picked.length === 0
              ? 'only products here can carry the live price'
              : `${picked.length} selected${outOfStock === 0 ? '' : ` · ${outOfStock} out of stock`}`
          }
        >
          <input
            className="input mb-2"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your catalog"
            aria-label="Search your catalog"
          />

          {products.isLoading && (
            <div className="space-y-1">
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className="skeleton h-8" />
              ))}
            </div>
          )}
          {products.isError && (
            <p role="alert" className="text-13 text-danger">
              Could not read your catalog, so nothing can go on the line-up right now.
            </p>
          )}
          {products.isSuccess && catalogue.length === 0 && (
            <p className="text-13 text-t2">
              No products are assigned to you yet, so there is nothing to sell.
            </p>
          )}
          {products.isSuccess && catalogue.length > 0 && matches.length === 0 && (
            <p className="text-13 text-t2">Nothing in your catalog matches that.</p>
          )}

          {matches.length > 0 && (
            <ul className="max-h-[22rem] divide-y divide-line overflow-y-auto scroll-thin">
              {matches.map((product) => {
                const index = picked.indexOf(product.productId);
                const isPicked = index >= 0;
                return (
                  <li key={product.productId} className="flex items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 shrink-0 accent-accent"
                      checked={isPicked}
                      onChange={() => {
                        setPicked((current) =>
                          current.includes(product.productId)
                            ? current.filter((id) => id !== product.productId)
                            : [...current, product.productId],
                        );
                        setFeatured((current) => (current === product.productId ? null : current));
                      }}
                      aria-label={`Put ${product.title} on the line-up`}
                    />
                    <span className="w-4 shrink-0 text-11 tabular-nums text-t3">
                      {isPicked ? index + 1 : '·'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-13 text-t1">{product.title}</span>
                        {product.totalStock === 0 && (
                          <span className="shrink-0 text-11 font-semibold text-danger">OUT</span>
                        )}
                        {product.totalStock > 0 && product.lowStock && (
                          <span className="shrink-0 text-11 font-semibold text-accent">LOW</span>
                        )}
                      </span>
                      <span className="block truncate text-11 text-t3">
                        {product.brand} · {formatInr(product.priceMinorUnits)}
                      </span>
                    </span>
                    <label
                      className={`flex shrink-0 items-center gap-1 text-11 ${
                        isPicked ? 'text-t2' : 'text-t3'
                      }`}
                      title="On camera first"
                    >
                      <input
                        type="radio"
                        name="featured-product"
                        className="h-3 w-3 accent-accent"
                        disabled={!isPicked}
                        checked={featured === product.productId}
                        onChange={() => setFeatured(product.productId)}
                      />
                      <span aria-hidden="true">★</span>
                      <span className="sr-only">On camera first</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-2 text-11 leading-tight text-t3">
            ★ is on camera first — the pin bar opens on it. The order here is the order shoppers
            scroll.
            {picked.length > 0 && featured === null && ' No star yet, so the first product opens.'}
          </p>
          {outOfStock > 0 && (
            <p className="mt-1 text-11 font-medium text-danger">
              {outOfStock} product{outOfStock === 1 ? '' : 's'} on this line-up cannot be bought.
              Restock or remove {outOfStock === 1 ? 'it' : 'them'} before you go on camera.
            </p>
          )}
        </Column>

        <Column title="Pricing & schedule">
          <fieldset className="mb-3">
            <legend className="label">Live price</legend>
            <div className="flex flex-wrap items-center gap-1.5">
              {DISCOUNT_PRESETS.map((percent) => (
                <button
                  key={percent}
                  type="button"
                  className={liveDiscount === percent ? 'chip-active' : 'chip'}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      liveDiscountPercent: liveDiscount === percent ? '' : String(percent),
                    })
                  }
                >
                  −{percent}%
                </button>
              ))}
              <input
                type="number"
                min={0}
                max={MAX_LIVE_DISCOUNT_PERCENT}
                className="input w-20"
                value={draft.liveDiscountPercent}
                onChange={(event) =>
                  setDraft({ ...draft, liveDiscountPercent: event.target.value })
                }
                placeholder="none"
                aria-label="Live price, percent off"
              />
            </div>
            <p className="mt-1 text-11 leading-tight text-t3">
              Off your shop price, and only while this show is on air. Blank means the show adds no
              rule of its own.
            </p>
            {discountOutOfRange && (
              <p className="field-error">
                A live price cannot go past {MAX_LIVE_DISCOUNT_PERCENT}% off.
              </p>
            )}
          </fieldset>

          <label className="mb-3 block">
            <span className="label">Starts at</span>
            <input
              type="datetime-local"
              className="input"
              value={startMode === 'now' ? '' : draft.scheduledFor}
              disabled={startMode === 'now' || onAir}
              onChange={(event) => setDraft({ ...draft, scheduledFor: event.target.value })}
            />
            <span className="mt-1 block text-11 leading-tight text-t3">
              {onAir
                ? 'This show is already on air.'
                : startMode === 'now'
                  ? 'Not used — the show starts the moment you save.'
                  : startMode === 'premiere'
                    ? 'The server takes the premiere live at this instant, whether or not you are here.'
                    : 'When shoppers are told to turn up; you still press Go live.'}
            </span>
          </label>

          {!onAir && (
            <fieldset className="mb-3">
              <legend className="label">Mode</legend>
              <div className="space-y-1">
                {START_MODES.filter((option) => existing === null || option.value !== 'now').map(
                  (option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer gap-2 rounded-ctl px-1 py-1 transition duration-ctl hover:bg-surface"
                    >
                      <input
                        type="radio"
                        name="start-mode"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent"
                        checked={startMode === option.value}
                        onChange={() => setStartMode(option.value)}
                      />
                      <span className="min-w-0">
                        <span className="block text-13 font-medium text-t1">{option.label}</span>
                        <span className="block text-11 leading-tight text-t3">{option.hint}</span>
                      </span>
                    </label>
                  ),
                )}
              </div>
            </fieldset>
          )}

          <label className="block">
            <span className="label">Video to broadcast</span>
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/webm"
              className="input py-1 file:mr-2 file:rounded-chip file:border-0 file:bg-surface file:px-2 file:py-1 file:text-11 file:font-semibold file:text-t1"
              onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)}
            />
            <span className="mt-1 block text-11 leading-tight text-t3">
              {videoFile !== null
                ? `${videoFile.name} · ${(videoFile.size / (1024 * 1024)).toFixed(1)} MB`
                : existing?.session.sourceVideoUrl != null
                  ? 'A video is already attached — upload another to replace it.'
                  : 'Optional, unless this show premieres. Uploaded after the show is saved.'}
            </span>
          </label>
        </Column>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-line bg-surface px-3 py-2">
        <button type="submit" className="btn-commit" disabled={blocked !== null || save.isPending}>
          {save.isPending
            ? videoFile === null
              ? 'Saving…'
              : 'Uploading the video…'
            : existing !== null
              ? 'Save changes'
              : startMode === 'now'
                ? 'Go live now'
                : startMode === 'premiere'
                  ? 'Schedule premiere'
                  : 'Schedule show'}
        </button>
        {blocked !== null && <span className="text-13 text-t2">Still needs {blocked}.</span>}
        {error !== null && (
          <span role="alert" className="text-13 text-danger">
            {error}
          </span>
        )}
      </footer>
    </form>
  );
};
