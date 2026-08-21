import { getSql } from './index';
import type { BuildingConfig, CustomerInfo, PricingResult } from '../building/types';

export interface NewQuote {
  id: string;
  dealerId: string;
  config: BuildingConfig;
  pricing: PricingResult;
  customer: CustomerInfo;
}

export async function insertQuote(q: NewQuote): Promise<string> {
  const sql = getSql();
  const totalCents = Math.round(q.pricing.total * 100);
  await sql`
    INSERT INTO quotes (id, dealer_id, config, pricing, customer, total_cents)
    VALUES (${q.id}, ${q.dealerId}, ${JSON.stringify(q.config)}::jsonb,
            ${JSON.stringify(q.pricing)}::jsonb,
            ${JSON.stringify(q.customer)}::jsonb, ${totalCents})
  `;
  return q.id;
}

/**
 * Flag a committed quote whose dealer notification never went out.
 *
 * RETURNING + a row-count check, because this is the only durable record that
 * a lead was lost: an UPDATE matching no row succeeds silently, so a bad id
 * would leave the row at `status = 'new'` and log nothing at all — the exact
 * silent-success failure this whole path exists to eliminate.
 */
export async function markNotifyFailed(id: string): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    UPDATE quotes SET status = 'notify_failed' WHERE id = ${id} RETURNING id
  ` as unknown[];
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error(`[quotes] markNotifyFailed matched no row for quote id "${id}" — ` +
                  'the lead is undelivered AND unflagged');
  }
}
