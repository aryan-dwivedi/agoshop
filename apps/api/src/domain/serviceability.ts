import { sql } from 'drizzle-orm';

import { db } from '../db/client.js';

/**
 * MOCK SERVICE — delivery serviceability.
 *
 * There is no carrier integration in this prototype. Serviceability, COD
 * availability and ETA are read from the seeded `pincodes` table, which is the
 * mock the assignment's pragmatic clause explicitly permits. No external call is
 * made here. A real implementation would call the courier aggregator's
 * serviceability API per pincode + seller warehouse and cache the answer.
 */

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

  const { rows } = await db.execute<PincodeRow>(sql`
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
