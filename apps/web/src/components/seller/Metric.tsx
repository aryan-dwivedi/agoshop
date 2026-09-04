import { Link } from 'react-router-dom';

export const Metric = ({
    label,
    value,
    hint,
    to,
}: {
    label: string;
    value: string | null;
    hint?: string;
    to?: string;
}): JSX.Element => {
    const body = (
        <>
            <div className="eyebrow">{label}</div>
            <div
                className={`mt-1 text-23 font-semibold tabular-nums tracking-[-0.01em] ${value === null ? 'text-t3' : 'text-t1'}`}
            >
                {value ?? '—'}
            </div>
            {hint !== undefined && (
                <div className="mt-0.5 text-11 leading-tight text-t3">{hint}</div>
            )}
        </>
    );
    return to === undefined ? (
        <div className="px-3 py-2">{body}</div>
    ) : (
        <Link
            to={to}
            className="block rounded-ctl px-3 py-2 transition duration-ctl hover:bg-surface"
        >
            {body}
        </Link>
    );
};
