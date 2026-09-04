import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatInr, type CheckoutOptionsDto, type PaymentMethod } from '@shop/shared';
import { api } from '../lib/api';
import { PinIcon, TruckIcon } from './icons';
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
    card: 'Card',
    upi: 'UPI',
    cod: 'Cash on delivery',
    emi: 'EMI',
    netbanking: 'Net banking',
};
export const BLOCKED_REASON_LABELS: Record<string, string> = {
    below_min_order: 'This order is below the minimum value for checkout.',
    pincode_required: 'Enter a delivery PIN code to see payment options.',
    pincode_not_serviceable: 'We do not deliver to this PIN code, so checkout is blocked.',
    pincode_blocked: 'Deliveries to this PIN code are paused right now.',
};
export const checkoutOptionsQuery = (pincode: string): {
    queryKey: [
        string,
        string
    ];
    queryFn: () => Promise<CheckoutOptionsDto>;
} => ({
    queryKey: ['checkout-options', pincode],
    queryFn: () => api.get<CheckoutOptionsDto>(`/api/checkout/options?pincode=${encodeURIComponent(pincode)}`),
});
export const PincodeCheck = ({ defaultPincode, }: {
    defaultPincode: string | null;
}): JSX.Element => {
    const [draft, setDraft] = useState(defaultPincode ?? '');
    const [submitted, setSubmitted] = useState(defaultPincode ?? '');
    const valid = /^\d{6}$/.test(draft);
    const options = useQuery({
        ...checkoutOptionsQuery(submitted),
        enabled: /^\d{6}$/.test(submitted),
    });
    const data = options.data;
    return (<div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <PinIcon className="h-4 w-4 text-t2"/>
        <h3 className="section-title">Delivery &amp; payment</h3>
      </div>

      <div className="p-4">
        <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            if (valid)
                setSubmitted(draft);
        }}>
          <input className="input tnum w-36" inputMode="numeric" maxLength={6} placeholder="PIN code" aria-label="Delivery PIN code" value={draft} onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 6))}/>
          <button type="submit" className="btn-standard" disabled={!valid}>
            Check
          </button>
        </form>

        {draft.length > 0 && !valid && (<p className="field-error">Indian PIN codes are 6 digits.</p>)}

        {options.isFetching && <p className="mt-3 text-13 text-t2">Checking {submitted}…</p>}

        {options.error !== null && !options.isFetching && (<p className="mt-3 text-13 text-danger">
            We could not check {submitted} just now. Try again in a moment.
          </p>)}

        {data !== undefined && !options.isFetching && (<div className="mt-3 animate-fade-in space-y-2.5 text-14">
            {data.pincodeServiceable === false ? (<p className="rounded-ctl bg-surface px-3 py-2 text-t2">
                We do not deliver to {submitted} yet. Try another PIN code.
              </p>) : (<p className="flex items-start gap-2 rounded-ctl bg-success-wash px-3 py-2 font-medium text-success">
                <TruckIcon className="mt-0.5 h-4 w-4 shrink-0"/>
                <span>
                  Delivers to {submitted}
                  {data.etaDays !== null && (<span className="text-t2">
                      {' '}
                      in {data.etaDays} {data.etaDays === 1 ? 'day' : 'days'}
                    </span>)}
                </span>
              </p>)}

            {data.blockedReason !== null && (<p className="rounded-ctl bg-accent-wash px-3 py-2 text-13 font-medium text-accent-text">
                {BLOCKED_REASON_LABELS[data.blockedReason] ??
                    'Checkout is blocked for this PIN code right now.'}
              </p>)}

            <div className="flex flex-wrap gap-1.5">
              {data.methods.length === 0 ? (<span className="text-13 text-t2">
                  No payment method is available for this PIN code.
                </span>) : (data.methods.map((m) => (<span key={m} className="badge-neutral">
                    {PAYMENT_METHOD_LABELS[m]}
                  </span>)))}
            </div>

            <p className="tnum text-13 text-t3">
              Minimum order {formatInr(data.minOrderMinorUnits)}.
            </p>
          </div>)}
      </div>
    </div>);
};
