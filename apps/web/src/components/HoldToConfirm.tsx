import {
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useImperativeHandle,
    useRef,
    useState,
} from 'react';

export type HoldToConfirmHandle = {
    begin: () => void;
    abort: () => void;
};
const DEFAULT_HOLD_MS = 700;
export const HoldToConfirm = forwardRef<
    HoldToConfirmHandle,
    {
        label: string;
        subLabel?: string;
        holdMs?: number;
        onConfirm: () => void;
        disabled?: boolean;
        className?: string;
    }
>(
    (
        { label, subLabel, holdMs = DEFAULT_HOLD_MS, onConfirm, disabled = false, className = '' },
        ref,
    ) => {
        const [holding, setHolding] = useState(false);
        const [hinted, setHinted] = useState(false);
        const timerRef = useRef<number | null>(null);
        const hintId = useId();
        const clear = useCallback((): void => {
            if (timerRef.current === null) return;
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }, []);
        const abort = useCallback((): void => {
            clear();
            setHolding(false);
        }, [clear]);
        const begin = useCallback((): void => {
            if (disabled || timerRef.current !== null) return;
            setHolding(true);
            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                setHolding(false);
                onConfirm();
            }, holdMs);
        }, [disabled, holdMs, onConfirm]);
        useImperativeHandle(ref, () => ({ begin, abort }), [begin, abort]);
        useEffect(() => {
            if (!holding) return;
            const onKey = (event: KeyboardEvent): void => {
                if (event.key === 'Escape') abort();
            };
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
        }, [holding, abort]);
        useEffect(() => {
            if (disabled) abort();
        }, [disabled, abort]);
        useEffect(() => clear, [clear]);
        const fill = {
            width: holding ? '100%' : '0%',
            transitionProperty: 'width',
            transitionTimingFunction: 'linear',
            transitionDuration: holding ? `${holdMs}ms` : '0ms',
        };
        return (
            <div className="relative flex flex-col">
                <button
                    type="button"
                    disabled={disabled}
                    aria-describedby={hintId}
                    className={`relative select-none overflow-hidden ${className === '' ? 'btn-danger' : className}`}
                    onPointerDown={begin}
                    onPointerUp={abort}
                    onPointerLeave={abort}
                    onPointerCancel={abort}
                    onKeyDown={(event) => {
                        if (event.key !== ' ' && event.key !== 'Enter') return;
                        event.preventDefault();
                        if (event.repeat) return;
                        begin();
                    }}
                    onKeyUp={(event) => {
                        if (event.key === ' ' || event.key === 'Enter') abort();
                    }}
                    onFocus={() => setHinted(true)}
                    onBlur={abort}
                >
                    <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 bg-current opacity-20"
                        style={fill}
                    />
                    <span
                        aria-hidden
                        className="absolute bottom-0 left-0 h-0.5 bg-current"
                        style={fill}
                    />
                    <span className="relative flex flex-col items-center leading-tight">
                        <span>{label}</span>
                        {holding && subLabel !== undefined && (
                            <span className="tnum text-13 font-normal">{subLabel}</span>
                        )}
                    </span>
                </button>

                <span
                    id={hintId}
                    className={
                        hinted
                            ? 'on-video absolute right-0 top-full z-40 mt-1 whitespace-nowrap rounded-chip px-2 py-1 text-14'
                            : 'sr-only'
                    }
                >
                    Press and hold. Release, or press Esc, to cancel.
                </span>
            </div>
        );
    },
);
HoldToConfirm.displayName = 'HoldToConfirm';
