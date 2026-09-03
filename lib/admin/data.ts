import { getSql } from '../db';

/** Read-only summaries for the admin dashboard. */

export interface DealerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  plan: string;
  createdAt: string;
  /** Which captured price file they quote from, if any. */
  manufacturerKey: string | null;
  /** True when their pricing is still the invented placeholder set. */
  placeholderPricing: boolean;
  /** Whether a Facebook page is attached. The TOKEN is never sent to a browser. */
  facebookPageId: string | null;
  hasFacebookToken: boolean;
  autoReply: boolean;
  quoteCount: number;
  lastQuoteAt: string | null;
}

export async function listDealers(): Promise<DealerRow[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT d.id, d.name, d.email, d.phone, d.active, d.plan, d.created_at,
           d.pricing_rules, d.facebook_page_id, d.facebook_page_token, d.auto_reply,
           COUNT(q.id)::int AS quote_count,
           MAX(q.created_at) AS last_quote_at
      FROM dealers d
      LEFT JOIN quotes q ON q.dealer_id = d.id
     GROUP BY d.id, d.name, d.email, d.phone, d.active, d.plan, d.created_at,
              d.pricing_rules, d.facebook_page_id, d.facebook_page_token, d.auto_reply
     ORDER BY d.active, d.name
  `) as any[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    active: r.active,
    plan: r.plan ?? 'none',
    createdAt: new Date(r.created_at).toISOString(),
    manufacturerKey: r.pricing_rules?.manufacturerKey ?? null,
    placeholderPricing: r.pricing_rules?._placeholder === true,
    facebookPageId: r.facebook_page_id ?? null,
    // Presence only. The ciphertext never leaves the server, let alone the
    // token — see lib/admin/secretBox.ts.
    hasFacebookToken: Boolean(r.facebook_page_token),
    autoReply: r.auto_reply === true,
    quoteCount: r.quote_count ?? 0,
    lastQuoteAt: r.last_quote_at ? new Date(r.last_quote_at).toISOString() : null,
  }));
}

export interface QuoteRow {
  id: string;
  dealerId: string;
  createdAt: string;
  totalCents: number | null;
  status: string;
  customerName: string | null;
}

export async function recentQuotes(limit = 25): Promise<QuoteRow[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, dealer_id, created_at, total_cents, status, customer
      FROM quotes ORDER BY created_at DESC LIMIT ${limit}
  `) as any[];
  return rows.map(r => ({
    id: r.id,
    dealerId: r.dealer_id,
    createdAt: new Date(r.created_at).toISOString(),
    totalCents: r.total_cents,
    status: r.status,
    customerName:
      [r.customer?.firstName, r.customer?.lastName].filter(Boolean).join(' ') || null,
  }));
}

export interface ConversationRow {
  id: string;
  dealerId: string;
  channel: string;
  lastOutcome: string | null;
  turns: number;
  updatedAt: string;
}

export async function recentConversations(limit = 25): Promise<ConversationRow[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, dealer_id, channel, last_outcome, transcript, updated_at
      FROM conversations ORDER BY updated_at DESC LIMIT ${limit}
  `) as any[];
  return rows.map(r => ({
    id: r.id,
    dealerId: r.dealer_id,
    channel: r.channel,
    lastOutcome: r.last_outcome,
    turns: Array.isArray(r.transcript) ? r.transcript.length : 0,
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}
