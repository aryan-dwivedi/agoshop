import type { LiveSessionDto } from '@shop/shared';
import type { ReactNode } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Star, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { formatInr } from '@shop/shared';

import { ApiError, api } from '../../lib/api';
import { useSellerProducts } from '../../lib/sellerApi';
import { useSession } from '../../state/session';
import { ComingSoonIconButton } from './ComingSoon';

type StartMode = 'manual' | 'premiere' | 'now';
export type EditableShow = {
    session: LiveSessionDto;
    expectedPeakViewers: number;
};
export type SchedulerResult = {
    session: LiveSessionDto;
    uploadError: string | null;
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
    liveDiscountPercent: string;
    coverImageUrl: string;
};
type Tab = 'details' | 'lineup' | 'schedule';

const localInputToIso = (value: string): string | null => {
    if (value === '') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
const isoToLocalInput = (iso: string | null): string => {
    const t = iso === null ? new Date(Date.now() + 60 * 60 * 1000) : new Date(iso);
    if (Number.isNaN(t.getTime())) return '';
    t.setSeconds(0, 0);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
};
const MAX_LIVE_DISCOUNT_PERCENT = 90;
const DISCOUNT_PRESETS = [10, 20, 30];
const parseLiveDiscount = (value: string): number | null => {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const START_MODES: {
    value: StartMode;
    label: string;
    hint: string;
}[] = [
    {
        value: 'manual',
        label: 'I’ll go live',
        hint: 'Nothing broadcasts until you open the room.',
    },
    {
        value: 'premiere',
        label: 'Premiere a video',
        hint: 'Goes live automatically at the start time.',
    },
    {
        value: 'now',
        label: 'Go live now',
        hint: 'Created on air — open the room to start.',
    },
];
const TABS: {
    id: Tab;
    label: string;
}[] = [
    { id: 'details', label: 'Details' },
    { id: 'lineup', label: 'Line-up' },
    { id: 'schedule', label: 'Schedule' },
];

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
        parsed = null;
    }
    if (!res.ok) {
        const failure = (
            parsed as {
                error?: { code?: string; message?: string };
            } | null
        )?.error;
        throw new Error(
            failure?.message ?? failure?.code ?? `The server rejected the upload (${res.status}).`,
        );
    }
    const body = parsed as { session?: LiveSessionDto } | null;
    if (!body?.session) throw new Error('The upload succeeded but the server returned no session.');
    return body.session;
};

const Field = ({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: ReactNode;
}): JSX.Element => (
    <label className="studio-field">
        <span className="label">{label}</span>
        {children}
        {hint !== undefined && (
            <span className="mt-1 block text-11 leading-relaxed text-t3">{hint}</span>
        )}
    </label>
);

export const SessionScheduler = ({
    show,
    mode,
    onSaved,
    onClose,
}: {
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
    const [tab, setTab] = useState<Tab>('details');
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
        scheduledFor: isoToLocalInput(
            mode === 'edit' ? (source?.session.scheduledFor ?? null) : null,
        ),
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

    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

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
                    scheduledFor: startMode === 'now' ? null : localInputToIso(draft.scheduledFor),
                    language: draft.language,
                    expectedPeakViewers: Number.parseInt(draft.expectedPeakViewers, 10),
                    coverImageUrl:
                        draft.coverImageUrl.trim() === '' ? null : draft.coverImageUrl.trim(),
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
                        coverImageUrl:
                            draft.coverImageUrl.trim() === '' ? null : draft.coverImageUrl.trim(),
                        ...(onAir
                            ? {}
                            : {
                                  scheduledFor: localInputToIso(draft.scheduledFor),
                                  expectedPeakViewers: Number.parseInt(
                                      draft.expectedPeakViewers,
                                      10,
                                  ),
                                  autoStart: startMode === 'premiere',
                              }),
                    },
                );
                session = body.session;
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
            await queryClient.invalidateQueries({ queryKey: ['seller', 'sessions'] });
            await queryClient.invalidateQueries({ queryKey: ['sessions'] });
            await queryClient.invalidateQueries({ queryKey: ['session'] });
        },
        onError: (err) => {
            if (err instanceof ApiError) {
                setError(
                    err.code === 'slug_taken'
                        ? 'That address is taken — pick another, or leave it blank.'
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
    const premiereNeedsVideo =
        startMode === 'premiere' && videoFile === null && existing?.session.sourceVideoUrl == null;
    const premiereNeedsTime =
        startMode === 'premiere' && localInputToIso(draft.scheduledFor) === null;
    const liveDiscount = parseLiveDiscount(draft.liveDiscountPercent);
    const discountOutOfRange = liveDiscount !== null && liveDiscount > MAX_LIVE_DISCOUNT_PERCENT;
    const emptiedLineUp =
        existing !== null && picked.length === 0 && existing.session.products.length > 0;
    const blocked =
        draft.title.trim().length < 3
            ? 'a title of at least three characters'
            : !onAir && (!Number.isFinite(expected) || expected <= 0)
              ? 'an expected peak above zero'
              : premiereNeedsVideo
                ? 'a video for the premiere'
                : premiereNeedsTime
                  ? 'a start time for the premiere'
                  : discountOutOfRange
                    ? `a live price at or under ${MAX_LIVE_DISCOUNT_PERCENT}% off`
                    : emptiedLineUp
                      ? 'at least one product on the line-up'
                      : null;

    const title =
        existing !== null
            ? `Edit ${existing.session.title}`
            : source === null
              ? 'New show'
              : `Duplicate of ${source.session.title}`;

    return (
        <div
            className="studio-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scheduler-title"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <form
                className="studio-modal"
                onSubmit={(event) => {
                    event.preventDefault();
                    save.mutate();
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <header className="studio-modal-header">
                    <div className="min-w-0">
                        <h2
                            id="scheduler-title"
                            className="truncate text-16 font-semibold text-t1"
                        >
                            {title}
                        </h2>
                        {onAir && (
                            <span className="badge-live mt-1">
                                <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-live-ink" />
                                on air
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-ctl text-t3 transition hover:bg-surface hover:text-t1"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        <X
                            className="h-4 w-4"
                            strokeWidth={2}
                        />
                    </button>
                </header>

                <nav
                    className="studio-tabs"
                    aria-label="Show form sections"
                >
                    {TABS.map((entry) => (
                        <button
                            key={entry.id}
                            type="button"
                            className={tab === entry.id ? 'studio-tab-active' : 'studio-tab'}
                            onClick={() => setTab(entry.id)}
                            aria-selected={tab === entry.id}
                        >
                            {entry.label}
                            {entry.id === 'lineup' && picked.length > 0 && (
                                <span className="ml-1.5 tabular-nums text-t3">
                                    ({picked.length})
                                </span>
                            )}
                        </button>
                    ))}
                </nav>

                <div className="studio-modal-body">
                    {tab === 'details' && (
                        <div className="studio-form-grid">
                            <Field
                                label="Title"
                                hint="What shoppers see on the show card."
                            >
                                <input
                                    className="input-studio"
                                    value={draft.title}
                                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                                    placeholder="Festive Edit — handloom sarees"
                                    required
                                />
                            </Field>

                            <Field
                                label="Host name"
                                hint="Shown on the show card and in the room."
                            >
                                <input
                                    className="input-studio"
                                    value={draft.hostName}
                                    onChange={(e) =>
                                        setDraft({ ...draft, hostName: e.target.value })
                                    }
                                />
                            </Field>

                            <Field
                                label="Address"
                                hint={
                                    existing === null
                                        ? 'Derived from the title if left blank.'
                                        : 'Fixed once the show exists.'
                                }
                            >
                                <input
                                    className="input-studio"
                                    value={draft.slug}
                                    disabled={existing !== null}
                                    onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                                    placeholder="festive-edit"
                                    pattern="[a-z0-9][a-z0-9-]{1,60}"
                                />
                            </Field>

                            <Field label="Language">
                                <select
                                    className="input-studio"
                                    value={draft.language}
                                    onChange={(e) =>
                                        setDraft({ ...draft, language: e.target.value })
                                    }
                                >
                                    {languages.length === 0 ? (
                                        <option value="en-US">en-US</option>
                                    ) : (
                                        languages.map((code) => (
                                            <option
                                                key={code}
                                                value={code}
                                            >
                                                {code}
                                            </option>
                                        ))
                                    )}
                                </select>
                            </Field>

                            <div className="studio-field-full">
                                <Field
                                    label="Description"
                                    hint="Optional — appears on the show card."
                                >
                                    <textarea
                                        className="input-studio"
                                        value={draft.description}
                                        onChange={(e) =>
                                            setDraft({ ...draft, description: e.target.value })
                                        }
                                        placeholder="What shoppers see on the show card."
                                    />
                                </Field>
                            </div>

                            <div className="studio-field-full">
                                <span className="label">Cover image</span>
                                <div className="flex flex-wrap items-center gap-2">
                                    <ComingSoonIconButton
                                        feature="coverImageUpload"
                                        icon={ImagePlus}
                                        label="Upload cover image"
                                        message="Cover image upload will be live soon. For now, paste a URL below."
                                    />
                                    <input
                                        className="input-studio min-w-0 flex-1"
                                        value={draft.coverImageUrl}
                                        onChange={(e) =>
                                            setDraft({ ...draft, coverImageUrl: e.target.value })
                                        }
                                        placeholder="Or paste image URL — /media/covers/…"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {tab === 'lineup' && (
                        <div>
                            <input
                                className="input-studio mb-3"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search your catalog…"
                                aria-label="Search catalog"
                            />

                            {products.isLoading && (
                                <div className="space-y-1.5">
                                    {[0, 1, 2, 3].map((row) => (
                                        <div
                                            key={row}
                                            className="skeleton h-10 rounded-ctl"
                                        />
                                    ))}
                                </div>
                            )}
                            {products.isError && (
                                <p
                                    role="alert"
                                    className="text-13 text-danger"
                                >
                                    Could not load your catalog.
                                </p>
                            )}
                            {products.isSuccess && catalogue.length === 0 && (
                                <p className="text-14 text-t2">
                                    No products yet — list one from Catalog first.
                                </p>
                            )}
                            {products.isSuccess && catalogue.length > 0 && matches.length === 0 && (
                                <p className="text-14 text-t2">No matches for that search.</p>
                            )}

                            {matches.length > 0 && (
                                <ul className="divide-y divide-line rounded-ctl border border-line">
                                    {matches.map((product) => {
                                        const index = picked.indexOf(product.productId);
                                        const isPicked = index >= 0;
                                        return (
                                            <li
                                                key={product.productId}
                                                className={`flex items-center gap-3 px-3 py-2.5 transition ${isPicked ? 'bg-accent-wash/50' : 'hover:bg-surface'}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="h-4 w-4 shrink-0 accent-accent"
                                                    checked={isPicked}
                                                    onChange={() => {
                                                        setPicked((current) =>
                                                            current.includes(product.productId)
                                                                ? current.filter(
                                                                      (id) =>
                                                                          id !== product.productId,
                                                                  )
                                                                : [...current, product.productId],
                                                        );
                                                        setFeatured((current) =>
                                                            current === product.productId
                                                                ? null
                                                                : current,
                                                        );
                                                    }}
                                                    aria-label={`Add ${product.title}`}
                                                />
                                                <span className="w-5 shrink-0 text-center text-11 tabular-nums text-t3">
                                                    {isPicked ? index + 1 : ''}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="truncate text-13 font-medium text-t1">
                                                            {product.title}
                                                        </span>
                                                        {product.totalStock === 0 && (
                                                            <span className="shrink-0 text-11 font-bold uppercase text-danger">
                                                                Out
                                                            </span>
                                                        )}
                                                        {product.totalStock > 0 &&
                                                            product.lowStock && (
                                                                <span className="shrink-0 text-11 font-bold uppercase text-accent">
                                                                    Low
                                                                </span>
                                                            )}
                                                    </div>
                                                    <span className="block truncate text-11 text-t3">
                                                        {product.brand} ·{' '}
                                                        {formatInr(product.priceMinorUnits)}
                                                    </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={!isPicked}
                                                    title={
                                                        isPicked
                                                            ? 'Pin on camera first'
                                                            : 'Add to line-up first'
                                                    }
                                                    onClick={() => setFeatured(product.productId)}
                                                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-ctl transition ${featured === product.productId ? 'bg-accent text-accent-ink' : 'text-t3 hover:bg-surface hover:text-t1'} disabled:opacity-30`}
                                                >
                                                    <Star
                                                        className="h-3.5 w-3.5"
                                                        fill={
                                                            featured === product.productId
                                                                ? 'currentColor'
                                                                : 'none'
                                                        }
                                                        strokeWidth={2}
                                                    />
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}

                            <p className="mt-3 text-11 leading-relaxed text-t3">
                                Star marks the product on camera first. Order here is the scroll
                                order for shoppers.
                                {outOfStock > 0 && (
                                    <span className="mt-1 block font-medium text-danger">
                                        {outOfStock} product{outOfStock === 1 ? '' : 's'} out of
                                        stock on this line-up.
                                    </span>
                                )}
                            </p>
                        </div>
                    )}

                    {tab === 'schedule' && (
                        <div className="space-y-5">
                            <fieldset>
                                <legend className="label">Live price</legend>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {DISCOUNT_PRESETS.map((percent) => (
                                        <button
                                            key={percent}
                                            type="button"
                                            className={
                                                liveDiscount === percent ? 'chip-active' : 'chip'
                                            }
                                            onClick={() =>
                                                setDraft({
                                                    ...draft,
                                                    liveDiscountPercent:
                                                        liveDiscount === percent
                                                            ? ''
                                                            : String(percent),
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
                                        className="input-studio w-20"
                                        value={draft.liveDiscountPercent}
                                        onChange={(e) =>
                                            setDraft({
                                                ...draft,
                                                liveDiscountPercent: e.target.value,
                                            })
                                        }
                                        placeholder="none"
                                        aria-label="Custom discount percent"
                                    />
                                </div>
                                <p className="mt-1.5 text-11 text-t3">
                                    Off shop price, only while the show is on air.
                                </p>
                                {discountOutOfRange && (
                                    <p className="field-error">
                                        Cannot exceed {MAX_LIVE_DISCOUNT_PERCENT}% off.
                                    </p>
                                )}
                            </fieldset>

                            <Field
                                label="Starts at"
                                hint={
                                    onAir
                                        ? 'This show is already on air.'
                                        : startMode === 'now'
                                          ? 'Not used — starts when you save.'
                                          : startMode === 'premiere'
                                            ? 'Server takes it live at this time.'
                                            : 'When shoppers are told to tune in.'
                                }
                            >
                                <input
                                    type="datetime-local"
                                    className="input-studio"
                                    value={startMode === 'now' ? '' : draft.scheduledFor}
                                    disabled={startMode === 'now' || onAir}
                                    onChange={(e) =>
                                        setDraft({ ...draft, scheduledFor: e.target.value })
                                    }
                                />
                            </Field>

                            <Field
                                label="Expected peak viewers"
                                hint={
                                    onAir
                                        ? 'Fixed for the rest of this show.'
                                        : 'Capacity hint for chat — not a hard cap.'
                                }
                            >
                                <input
                                    type="number"
                                    min={1}
                                    className="input-studio max-w-[120px]"
                                    value={draft.expectedPeakViewers}
                                    disabled={onAir}
                                    onChange={(e) =>
                                        setDraft({
                                            ...draft,
                                            expectedPeakViewers: e.target.value,
                                        })
                                    }
                                />
                            </Field>

                            {!onAir && (
                                <fieldset>
                                    <legend className="label">Mode</legend>
                                    <div className="space-y-1">
                                        {START_MODES.filter(
                                            (option) => existing === null || option.value !== 'now',
                                        ).map((option) => (
                                            <label
                                                key={option.value}
                                                className={`flex cursor-pointer gap-3 rounded-ctl border px-3 py-2.5 transition ${startMode === option.value ? 'border-accent bg-accent-wash' : 'border-line hover:border-line-ctl'}`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="start-mode"
                                                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                                                    checked={startMode === option.value}
                                                    onChange={() => setStartMode(option.value)}
                                                />
                                                <span className="min-w-0">
                                                    <span className="block text-13 font-medium text-t1">
                                                        {option.label}
                                                    </span>
                                                    <span className="block text-11 text-t3">
                                                        {option.hint}
                                                    </span>
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                            )}

                            <Field
                                label="Video to broadcast"
                                hint={
                                    videoFile !== null
                                        ? `${videoFile.name} · ${(videoFile.size / (1024 * 1024)).toFixed(1)} MB`
                                        : existing?.session.sourceVideoUrl != null
                                          ? 'A video is attached — upload to replace.'
                                          : 'Optional unless premiering. Uploaded after save.'
                                }
                            >
                                <input
                                    ref={videoInputRef}
                                    type="file"
                                    accept="video/mp4,video/webm"
                                    className="input-studio py-1.5 file:mr-2 file:rounded-chip file:border-0 file:bg-surface file:px-2 file:py-1 file:text-11 file:font-semibold"
                                    onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
                                />
                            </Field>
                        </div>
                    )}
                </div>

                <footer className="studio-modal-footer">
                    <button
                        type="submit"
                        className="btn-commit"
                        disabled={blocked !== null || save.isPending}
                    >
                        {save.isPending
                            ? videoFile === null
                                ? 'Saving…'
                                : 'Uploading video…'
                            : existing !== null
                              ? 'Save changes'
                              : startMode === 'now'
                                ? 'Go live now'
                                : startMode === 'premiere'
                                  ? 'Schedule premiere'
                                  : 'Schedule show'}
                    </button>
                    {blocked !== null && <span className="text-13 text-t2">Needs {blocked}.</span>}
                    {error !== null && (
                        <span
                            role="alert"
                            className="text-13 text-danger"
                        >
                            {error}
                        </span>
                    )}
                    <button
                        type="button"
                        className="btn-quiet ml-auto"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                </footer>
            </form>
        </div>
    );
};
