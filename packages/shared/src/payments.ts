import type { PaymentMethod } from './types.js';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
    card: 'credit card',
    upi: 'UPI',
    cod: 'cash on delivery',
    emi: 'EMI',
    netbanking: 'net banking',
};

export const BLOCKED_REASON_LABELS: Record<string, string> = {
    below_min_order: 'order is below the minimum checkout value',
    pincode_required: 'a delivery PIN code is required',
    pincode_not_serviceable: 'we do not deliver to this PIN code',
    pincode_blocked: 'deliveries to this PIN code are paused',
};
