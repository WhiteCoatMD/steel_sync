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

export async function markNotifyFailed(id: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE quotes SET status = 'notify_failed' WHERE id = ${id}`;
}
