import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Clock, Sparkles, X } from 'lucide-react';
import { useEffect } from 'react';
import { create } from 'zustand';

import { FEATURE_LABELS, isFeatureLive, type StudioFeature } from './studioFeatures';

type Toast = {
    id: number;
    feature: StudioFeature;
    message?: string;
};

type ToastState = {
    queue: Toast[];
    push: (feature: StudioFeature, message?: string) => void;
    dismiss: (id: number) => void;
};

const useToastState = create<ToastState>((set) => ({
    queue: [],
    push: (feature, message) =>
        set((state) => ({
            queue: [...state.queue, { id: Date.now(), feature, message }],
        })),
    dismiss: (id) =>
        set((state) => ({
            queue: state.queue.filter((toast) => toast.id !== id),
        })),
}));

export const showComingSoon = (feature: StudioFeature, message?: string): void => {
    useToastState.getState().push(feature, message);
};

const ToastItem = ({ toast }: { toast: Toast }): JSX.Element => {
    const dismiss = useToastState((s) => s.dismiss);
    useEffect(() => {
        const timer = window.setTimeout(() => dismiss(toast.id), 4200);
        return () => window.clearTimeout(timer);
    }, [dismiss, toast.id]);
    const label = FEATURE_LABELS[toast.feature];
    return (
        <div
            role="status"
            className="animate-slide-up pointer-events-auto flex max-w-sm items-start gap-3 rounded-panel border border-line bg-elev px-4 py-3 shadow-sheet"
        >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
                <Sparkles
                    className="h-4 w-4"
                    strokeWidth={2}
                />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-13 font-semibold text-t1">Coming soon</p>
                <p className="mt-0.5 text-13 leading-relaxed text-t2">
                    {toast.message ?? `${label} will be live soon.`}
                </p>
            </div>
            <button
                type="button"
                aria-label="Dismiss"
                className="shrink-0 rounded-chip p-1 text-t3 transition hover:bg-surface hover:text-t1"
                onClick={() => dismiss(toast.id)}
            >
                <X
                    className="h-4 w-4"
                    strokeWidth={2}
                />
            </button>
        </div>
    );
};

export const ComingSoonToasts = (): JSX.Element => {
    const queue = useToastState((s) => s.queue);
    if (queue.length === 0) return <></>;
    return (
        <div
            aria-live="polite"
            className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2"
        >
            {queue.map((toast) => (
                <ToastItem
                    key={toast.id}
                    toast={toast}
                />
            ))}
        </div>
    );
};

export const ComingSoonBadge = ({ className = '' }: { className?: string }): JSX.Element => (
    <span
        className={`inline-flex items-center gap-1 rounded-full bg-accent-wash px-2 py-0.5 text-11 font-semibold text-accent-text ${className}`}
    >
        <Clock
            className="h-3 w-3"
            strokeWidth={2.5}
        />
        Soon
    </span>
);

export const ComingSoonTrigger = ({
    feature,
    message,
    children,
    className = '',
    title,
}: {
    feature: StudioFeature;
    message?: string;
    children: ReactNode;
    className?: string;
    title?: string;
}): JSX.Element => (
    <button
        type="button"
        title={title ?? `${FEATURE_LABELS[feature]} — coming soon`}
        className={`group relative cursor-not-allowed opacity-70 ${className}`}
        onClick={() => showComingSoon(feature, message)}
    >
        {children}
    </button>
);

export const ComingSoonIconButton = ({
    feature,
    message,
    icon: Icon,
    label,
    className = '',
}: {
    feature: StudioFeature;
    message?: string;
    icon: LucideIcon;
    label: string;
    className?: string;
}): JSX.Element => (
    <ComingSoonTrigger
        feature={feature}
        message={message}
        title={label}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-ctl border border-line bg-surface text-t2 transition hover:border-line-ctl hover:text-t1 ${className}`}
    >
        <Icon
            className="h-4 w-4"
            strokeWidth={1.8}
        />
        <span className="sr-only">{label}</span>
    </ComingSoonTrigger>
);

export const ComingSoonPanel = ({
    feature,
    title,
    description,
}: {
    feature: StudioFeature;
    title?: string;
    description?: string;
}): JSX.Element => (
    <section className="studio-coming-soon">
        <span className="studio-coming-soon-icon">
            <Sparkles
                className="h-6 w-6"
                strokeWidth={1.8}
            />
        </span>
        <h2 className="mt-4 text-19 font-semibold text-t1">
            {title ?? `${FEATURE_LABELS[feature]} is on the way`}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-14 leading-relaxed text-t2">
            {description ??
                `We're building ${FEATURE_LABELS[feature].toLowerCase()}. This will be live soon — check back after the next release.`}
        </p>
        <ComingSoonBadge className="mt-4" />
    </section>
);

/** Wraps children; if feature is not live, renders coming-soon panel instead. */
export const FeatureGate = ({
    feature,
    children,
    fallback,
}: {
    feature: StudioFeature;
    children: ReactNode;
    fallback?: ReactNode;
}): JSX.Element => {
    if (isFeatureLive(feature)) return <>{children}</>;
    return (
        <>
            {fallback ?? (
                <ComingSoonPanel feature={feature} />
            )}
        </>
    );
};
