import { useId } from 'react';

export const STAR_PATH =
    'M10 1.6l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.2l-4.94 2.6.94-5.5-4-3.9 5.53-.8z';
const Star = ({
    fill,
    size,
    onDark,
}: {
    fill: number;
    size: number;
    onDark: boolean;
}): JSX.Element => {
    const clipId = `star${useId().replace(/:/g, '')}`;
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="shrink-0"
        >
            <defs>
                <clipPath id={clipId}>
                    <rect
                        x="0"
                        y="0"
                        width={Math.round(2000 * fill) / 100}
                        height="20"
                    />
                </clipPath>
            </defs>
            <path
                d={STAR_PATH}
                className="fill-line"
            />

            <path
                d={STAR_PATH}
                className={onDark ? 'fill-accent' : 'fill-accent-text'}
                clipPath={`url(#${clipId})`}
            />
        </svg>
    );
};
export const Rating = ({
    value,
    count,
    size = 14,
    className = '',
    onDark = false,
}: {
    value: number;
    count?: number;
    size?: number;
    className?: string;
    onDark?: boolean;
}): JSX.Element =>
    count === 0 ? (
        <p className={`text-13 text-t3 ${className}`}>No ratings yet</p>
    ) : (
        <div
            className={`flex items-center gap-1.5 ${className}`}
            aria-label={`Rated ${value.toFixed(1)} out of 5${count === undefined ? '' : ` from ${count} ratings`}`}
        >
            <span className="tnum inline-flex items-center gap-1 rounded-chip bg-surface px-1.5 py-0.5 text-13 font-semibold text-t1">
                {value.toFixed(1)}
                <svg
                    width="9"
                    height="9"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                    className={onDark ? 'fill-accent' : 'fill-accent-text'}
                >
                    <path d={STAR_PATH} />
                </svg>
            </span>
            <span className="flex items-center gap-0.5">
                {[0, 1, 2, 3, 4].map((i) => (
                    <Star
                        key={i}
                        size={size}
                        fill={Math.min(1, Math.max(0, value - i))}
                        onDark={onDark}
                    />
                ))}
            </span>
            {count !== undefined && (
                <span className="tnum text-13 text-t3">({count.toLocaleString('en-IN')})</span>
            )}
        </div>
    );
