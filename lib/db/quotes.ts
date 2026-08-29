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

/**
 * The building most recently quoted in a conversation.
 *
 * A thread is reset once quoted, so the customer's next message arrives with no
 * dimensions attached -- which is right for "what about a 30x40?" and wrong for
 * "how much are the other roof styles", a follow-up ABOUT the building they
 * were just quoted. The quote row outlives the reset, so it is what we ask.
 */
export async function lastQuotedConfig(
  conversationId: string,
): Promise<BuildingConfig | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT q.config
      FROM conversations c
      JOIN quotes q ON q.id = c.quote_id
     WHERE c.id = ${conversationId}
     LIMIT 1
  `) as Array<Record<string, unknown>>;
  const config = rows[0]?.config;
  return config ? (config as BuildingConfig) : null;
}
