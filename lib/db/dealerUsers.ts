import { getSql } from './index';
import type { Plan } from '../plans';
import { DEFAULT_PRICING_RULES } from '../building/defaultConfig';

/**
 * Dealer accounts: who may sign in, and the rows a signup creates.
 *
 * Kept out of dealers.ts, which is about how a dealer is CONFIGURED and priced.
 * This file is about who a dealer IS to the login system.
 */

const MAX_ID_LENGTH = 40;

/**
 * A business name to a URL-safe dealer id.
 *
 * The id is the dealer's public address (/site/<id>) and a foreign key on every
 * quote and conversation, so it must be stable, lowercase and free of anything
 * needing escaping. A name that leaves nothing behind still has to produce an
 * id, hence the fallback — an empty primary key is not an option.
 */
export function slugify(name: string): string {
  const s = (name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    // Apostrophes are dropped, not treated as a separator: "Bob's" -> "bobs",
    // not "bob-s". Everything else non-alphanumeric collapses to a hyphen.
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/g, '');
  return s || 'dealer';
}

/**
 * A free dealer id derived from the name.
 *
 * Resolved at CREATION time, not when the form is submitted, so two people
 * signing up at once cannot both be promised the same id. The suffix is
 * numeric and short: a dealer reads their own URL out loud.
 */
export async function allocateDealerId(name: string): Promise<string> {
  const sql = getSql();
  const base = slugify(name);
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const rows = (await sql`SELECT 1 FROM dealers WHERE id = ${candidate} LIMIT 1`) as any[];
    if (!rows.length) return candidate;
  }
  // 50 dealers sharing a name is not a real case; a random tail beats failing.
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Create the dealer and its first login, INACTIVE.
 *
 * `active = false` is the whole safety property: getDealer() and dealerForPage()
 * both filter on it, so a dealer nobody has approved is dark on every public
 * path without a new check anywhere.
 *
 * pricing_rules is seeded as DEFAULT_PRICING_RULES plus `_placeholder: true` —
 * the same convention scripts/seed-dealer.ts uses for a dealer whose real
 * prices have not been entered. mergePricingRules() deliberately preserves
 * that marker, so a bare `{}` here would merge to identical numbers while
 * losing the signal that lets downstream code tell a self-signed-up dealer's
 * placeholder pricing from prices someone actually entered.
 *
 * Returns created:false when the email already has an account, so the caller
 * can behave identically either way rather than leaking who has signed up.
 */
export async function createPendingDealer(p: {
  businessName: string;
  email: string;
  phone: string;
}): Promise<{ dealerId: string; created: boolean }> {
  const sql = getSql();
  const email = p.email.trim().toLowerCase();

  const existing = (await sql`
    SELECT dealer_id FROM dealer_users WHERE email = ${email} LIMIT 1
  `) as any[];
  if (existing.length) return { dealerId: existing[0].dealer_id, created: false };

  const dealerId = await allocateDealerId(p.businessName);
  const pricingRules = { ...DEFAULT_PRICING_RULES, _placeholder: true };

  await sql`
    INSERT INTO dealers (id, name, email, phone, pricing_rules, active, plan)
    VALUES (${dealerId}, ${p.businessName.trim()}, ${email}, ${p.phone.trim()},
            ${JSON.stringify(pricingRules)}::jsonb, false, 'none')
  `;
  await sql`
    INSERT INTO dealer_users (email, dealer_id) VALUES (${email}, ${dealerId})
  `;

  return { dealerId, created: true };
}

/** The dealer this address may sign in to, or null. */
export async function dealerForLogin(email: string): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT dealer_id FROM dealer_users WHERE email = ${email.trim().toLowerCase()} LIMIT 1
  `) as any[];
  return rows.length ? rows[0].dealer_id : null;
}

/**
 * Is this session still good?
 *
 * Checked on EVERY request, unlike an admin session, which is stateless because
 * its allowlist lives in the environment. A dealer has no such allowlist, and
 * the point of this query is that deactivating a dealer locks them out now
 * rather than whenever their cookie happens to expire.
 *
 * Deliberately does NOT filter on d.active — a pending dealer (just signed up,
 * not yet approved) must still be able to sign in and see their own empty
 * dashboard. Deactivation is handled by the login guard, which reads `active`
 * separately and routes accordingly.
 */
export async function activeDealerForSession(
  dealerId: string,
  email: string,
): Promise<boolean> {
  const sql = getSql();
  const rows = (await sql`
    SELECT 1
      FROM dealer_users u
      JOIN dealers d ON d.id = u.dealer_id
     WHERE u.email = ${email.trim().toLowerCase()}
       AND u.dealer_id = ${dealerId}
     LIMIT 1
  `) as any[];
  return rows.length > 0;
}

export async function setDealerPlan(dealerId: string, plan: Plan): Promise<void> {
  const sql = getSql();
  await sql`UPDATE dealers SET plan = ${plan}, updated_at = now() WHERE id = ${dealerId}`;
}

export async function setDealerActive(dealerId: string, active: boolean): Promise<void> {
  const sql = getSql();
  await sql`UPDATE dealers SET active = ${active}, updated_at = now() WHERE id = ${dealerId}`;
}
