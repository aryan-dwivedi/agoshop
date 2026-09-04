import type { SessionProductDto } from '@shop/shared';

import { useUpdateSessionPricing } from '../../lib/sellerApi';
import { PriceTag } from '../PriceTag';
import { QUICK_DISCOUNTS } from './constants';

export const PricePanel = ({
    sessionId,
    discountPercent,
    focus,
    onClose,
}: {
    sessionId: string;
    discountPercent: number | null;
    focus: SessionProductDto | null;
    onClose: () => void;
}): JSX.Element => {
    const pricing = useUpdateSessionPricing();
    return (
        <div
            role="dialog"
            aria-label="Live price for this room"
            className="card animate-slide-up absolute bottom-full left-0 z-30 mb-2 w-[22rem] p-3 shadow-sheet"
        >
            <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-14 font-semibold text-t1">Live price for this room</h2>
                <button
                    type="button"
                    className="btn-quiet btn-sm"
                    onClick={onClose}
                >
                    Close
                </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
                {QUICK_DISCOUNTS.map((percent) => (
                    <button
                        key={percent}
                        type="button"
                        className={discountPercent === percent ? 'chip-active' : 'chip'}
                        disabled={pricing.isPending}
                        onClick={() => pricing.mutate({ sessionId, discountPercent: percent })}
                    >
                        {percent}% off
                    </button>
                ))}
                <button
                    type="button"
                    className={discountPercent === null ? 'chip-active' : 'chip'}
                    disabled={pricing.isPending}
                    onClick={() => pricing.mutate({ sessionId, discountPercent: null })}
                >
                    No markdown
                </button>
            </div>

            {focus !== null && (
                <div className="panel mt-3 p-2">
                    <span className="eyebrow">On air now</span>
                    <p className="mt-0.5 truncate text-14 font-medium text-t1">{focus.title}</p>
                    <PriceTag
                        ladder={focus.price}
                        size="sm"
                        className="mt-1"
                    />
                </div>
            )}

            {pricing.isError && <p className="field-error">{pricing.error.message}</p>}

            <p className="mt-2 text-13 text-t2">
                Viewers and their open carts are repriced the moment you press it. No reload, no
                re-join.
            </p>
        </div>
    );
};
