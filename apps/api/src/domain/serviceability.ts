import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
export type DeliveryCheck = {
    serviceable: boolean;
    codAvailable: boolean;
    etaDays: number | null;
    city?: string;
    state?: string;
    reason?: string;
};
type PincodeRow = {
    pincode: string;
    city: string;
    state: string;
    serviceable: boolean;
    cod_available: boolean;
    eta_days: number;
};
export const checkDelivery = async (pincode: string): Promise<DeliveryCheck> => {
    const normalized = pincode.trim();
    if (!/^\d{6}$/.test(normalized)) {
        return { serviceable: false, codAvailable: false, etaDays: null, reason: 'invalid_pincode' };
    }
    const { rows } = await db.execute<PincodeRow>(sql `
    select pincode, city, state, serviceable, cod_available, eta_days
    from pincodes
    where pincode = ${normalized}
  `);
    const row = rows[0];
    if (!row) {
        return { serviceable: false, codAvailable: false, etaDays: null, reason: 'unknown_pincode' };
    }
    if (!row.serviceable) {
        return {
            serviceable: false,
            codAvailable: false,
            etaDays: null,
            city: row.city,
            state: row.state,
            reason: 'not_serviceable',
        };
    }
    return {
        serviceable: true,
        codAvailable: row.cod_available,
        etaDays: row.eta_days,
        city: row.city,
        state: row.state,
    };
};
