import { getSql } from '../db/index';

/**
 * What a signed-in dealer may read and write about themselves.
 *
 * Every function takes dealerId as its FIRST argument, supplied by
 * requireDealer() from the session token. No function here derives a dealer
 * from a request, and no route may pass one in from a URL or a body — that is
 * the whole tenancy boundary, and it is enforced by never offering a way to
 * name someone else.
 *
 * Separate from lib/admin/data.ts, which reads across ALL dealers on purpose.
 */

export interface QuoteRow {
  id: string;
  createdAt: string;
  totalCents: number | null;
  status: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
}

export async function dealerQuotes(dealerId: string, limit = 50): Promise<QuoteRow[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, created_at, total_cents, status, customer
      FROM quotes
     WHERE dealer_id = ${dealerId}
     ORDER BY created_at DESC
     LIMIT ${limit}
  `) as any[];
  return rows.map(r => ({
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    totalCents: r.total_cents,
    status: r.status,
    customerName:
      [r.customer?.firstName, r.customer?.lastName].filter(Boolean).join(' ') || null,
    customerEmail: r.customer?.email ?? null,
    customerPhone: r.customer?.phone ?? null,
  }));
}

export interface ConversationRow {
  id: string;
  channel: string;
  lastOutcome: string | null;
  turns: number;
  lastMessage: string | null;
  updatedAt: string;
}

export async function dealerConversations(
  dealerId: string,
  limit = 50,
): Promise<ConversationRow[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, channel, last_outcome, transcript, updated_at
      FROM conversations
     WHERE dealer_id = ${dealerId}
     ORDER BY updated_at DESC
     LIMIT ${limit}
  `) as any[];
  return rows.map(r => {
    // Guarded the same way the array itself is: a hand-edited or malformed
    // transcript row can contain a non-string entry, and rendering that
    // straight through would show "[object Object]" on the dashboard.
    const transcript: unknown[] = Array.isArray(r.transcript) ? r.transcript : [];
    const last = transcript.length ? transcript[transcript.length - 1] : undefined;
    return {
      id: r.id,
      channel: r.channel,
      lastOutcome: r.last_outcome,
      turns: transcript.length,
      lastMessage: typeof last === 'string' ? last : null,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  });
}

export interface DealerAccount {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  serviceArea: string | null;
  policies: string | null;
  offersRto: boolean;
  plan: string;
  active: boolean;
  /** null while nobody has approved them yet. See lib/db/dealerUsers.ts. */
  approvedAt: string | null;
}

export async function dealerAccount(dealerId: string): Promise<DealerAccount | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, name, email, phone, website, service_area, policies, offers_rto, plan,
           active, approved_at
      FROM dealers WHERE id = ${dealerId} LIMIT 1
  `) as any[];
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    website: r.website,
    serviceArea: r.service_area,
    policies: r.policies,
    offersRto: r.offers_rto === true,
    plan: r.plan,
    active: r.active === true,
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
  };
}

export interface DealerProfileInput {
  name: string;
  email: string;
  phone: string;
  website: string;
  serviceArea: string;
  policies: string;
  offersRto: boolean;
}

/**
 * The fields a dealer may change about themselves.
 *
 * Named explicitly rather than spread from the request. `plan`, `active` and
 * `pricing_rules` are absent DELIBERATELY: the first two decide what this
 * dealer is allowed to do, and the third is the platform's margin. A dealer
 * editing any of them would be editing their own permissions.
 */
export async function updateDealerProfile(
  dealerId: string,
  p: DealerProfileInput,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE dealers
       SET name         = ${p.name},
           email        = ${p.email},
           phone        = ${p.phone},
           website      = ${p.website},
           service_area = ${p.serviceArea},
           policies     = ${p.policies},
           offers_rto   = ${p.offersRto},
           updated_at   = now()
     WHERE id = ${dealerId}
  `;
}
