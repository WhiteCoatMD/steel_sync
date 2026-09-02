# Dealer Accounts and Plan Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a dealer sign up for their own account and see their own leads and settings, while the super-admin approves them and sets a plan that decides whether their AI answers customers.

**Architecture:** Dealer identity reuses the existing HMAC token machinery in `lib/admin/auth.ts` with two new `kind` values (`'signup'`, `'dealer'`), so a dealer token can never satisfy `requireAdmin()`. A signup writes no rows until the emailed link is clicked. A `plan` column on `dealers` maps to capabilities in `lib/plans.ts`, enforced in exactly one place — `handleInboundMessage()`, before any model call.

**Tech Stack:** Next.js 15 App Router (server components), TypeScript, Neon serverless Postgres via `getSql()`, Resend for email, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-dealer-accounts-and-plan-gating-design.md`

## Global Constraints

- **The super-admin allowlist stays in the environment.** `SUPER_ADMIN_EMAILS` remains the sole source of super-admin. No task adds a database-backed admin role.
- **`isAllowedAdmin()` must remain unconditional for `kind: 'magic'` and `kind: 'session'`.** Getting this wrong in the permissive direction is an admin bypass.
- **`dealerId` always comes from the session token**, never from a URL segment, query string, or request body, on every dealer-scoped route and query.
- **Emails are stored and compared lowercased and trimmed.**
- **An unknown plan string denies every capability.**
- **Plan values are exactly** `'none'`, `'starter'`, `'pro'`.
- **Tests live in `__tests__/` beside the code**, named `*.test.ts`. Run with `npm test`.
- **Route tests must send a distinct `x-forwarded-for` per request** or the shared in-memory rate limiter fails later tests with a 429. See `app/api/quote/__tests__/route.test.ts`.
- **Never log a magic link or a token.** `sendMagicLink` deliberately does not.
- **Commit after every task.** Commit messages describe the behaviour change, not the mechanics.
- **`vi.mock()` must name the exact specifier the file under test imports.** Files under `lib/` import each other relatively (`'../db/dealerUsers'`); files under `app/` use the `@/` alias. Both resolve to the same module, but matching the source removes any doubt — if a mock appears not to take effect, this is the first thing to check.

---

### Task 1: Plan capabilities

**Files:**
- Create: `lib/plans.ts`
- Test: `lib/__tests__/plans.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Plan = 'none' | 'starter' | 'pro'`, `type Capability = 'aiAutoReply'`, `planAllows(plan: unknown, capability: Capability): boolean`, `PLAN_IDS: readonly Plan[]`, `isPlan(v: unknown): v is Plan`.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/plans.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planAllows, isPlan, PLAN_IDS } from '../plans';

describe('planAllows', () => {
  it('grants AI auto-reply only on pro', () => {
    expect(planAllows('pro', 'aiAutoReply')).toBe(true);
    expect(planAllows('starter', 'aiAutoReply')).toBe(false);
    expect(planAllows('none', 'aiAutoReply')).toBe(false);
  });

  // A typo in a hand-edited database column must not hand out a paid feature.
  it('denies everything for an unknown or malformed plan', () => {
    expect(planAllows('PRO', 'aiAutoReply')).toBe(false);
    expect(planAllows('enterprise', 'aiAutoReply')).toBe(false);
    expect(planAllows('', 'aiAutoReply')).toBe(false);
    expect(planAllows(null, 'aiAutoReply')).toBe(false);
    expect(planAllows(undefined, 'aiAutoReply')).toBe(false);
    expect(planAllows(7, 'aiAutoReply')).toBe(false);
  });
});

describe('isPlan', () => {
  it('accepts exactly the three known plans', () => {
    expect(PLAN_IDS).toEqual(['none', 'starter', 'pro']);
    for (const p of PLAN_IDS) expect(isPlan(p)).toBe(true);
    expect(isPlan('enterprise')).toBe(false);
    expect(isPlan(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/plans.test.ts`
Expected: FAIL — cannot resolve `../plans`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/plans.ts`:

```ts
/**
 * What a dealer's subscription lets them do.
 *
 * The plan is a LABEL on the dealer row; what it means lives here, next to the
 * gate that enforces it, so reading one tells you the other. Billing, when it
 * arrives, writes the label and nothing downstream changes.
 *
 * `starter` and `none` grant the same thing today. That is deliberate: they are
 * different BILLING states — unapproved or lapsed, versus paying without AI —
 * and keeping them apart now means a future paid capability has a tier to land
 * on without a data migration.
 */

export const PLAN_IDS = ['none', 'starter', 'pro'] as const;

export type Plan = (typeof PLAN_IDS)[number];

export type Capability = 'aiAutoReply';

const PLANS: Record<Plan, Record<Capability, boolean>> = {
  none: { aiAutoReply: false },
  starter: { aiAutoReply: false },
  pro: { aiAutoReply: true },
};

export function isPlan(v: unknown): v is Plan {
  return typeof v === 'string' && (PLAN_IDS as readonly string[]).includes(v);
}

/**
 * Fails CLOSED on anything unrecognised. `plan` is a hand-edited text column;
 * a typo must cost a dealer a feature they paid for — which someone will
 * report — rather than hand a feature to someone who did not.
 */
export function planAllows(plan: unknown, capability: Capability): boolean {
  if (!isPlan(plan)) return false;
  return PLANS[plan][capability] === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/plans.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/plans.ts lib/__tests__/plans.test.ts
git commit -m "Say what each plan is allowed to do"
```

---

### Task 2: Dealer and signup tokens

**Files:**
- Modify: `lib/admin/auth.ts`
- Test: `lib/admin/__tests__/auth.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `DEALER_COOKIE` (string `'steelsync_dealer'`), `createDealerToken(dealerId: string, email: string, now?: number): string`, `verifyDealerToken(token: unknown, now?: number): { dealerId: string; email: string } | null`, `createSignupToken(payload: SignupPayload, now?: number): string`, `verifySignupToken(token: unknown, now?: number): SignupPayload | null`, `interface SignupPayload { businessName: string; email: string; phone: string }`, `dealerCookieOptions()`.

This task changes the file that stands between the internet and every dealer's data. Read `lib/admin/auth.ts` end to end before editing.

- [ ] **Step 1: Write the failing tests**

Append to `lib/admin/__tests__/auth.test.ts`. Add the new names to the existing import block at the top of that file:

```ts
import {
  DEALER_COOKIE,
  createDealerToken,
  verifyDealerToken,
  createSignupToken,
  verifySignupToken,
  dealerCookieOptions,
} from '../auth';
```

Then append these describe blocks:

```ts
describe('dealer tokens are a weaker identity than admin', () => {
  it('round-trips a dealer id and email', () => {
    const t = createDealerToken('dunrite', '  Owner@Dunrite.com ');
    expect(verifyDealerToken(t)).toEqual({ dealerId: 'dunrite', email: 'owner@dunrite.com' });
  });

  // The whole point. A dealer must never be able to present their token to the
  // admin guard and be let in.
  it('is rejected by the admin session verifier', () => {
    const t = createDealerToken('dunrite', 'owner@dunrite.com');
    expect(verifySessionToken(t)).toBeNull();
    expect(verifyMagicToken(t)).toBeNull();
  });

  it('does not accept an admin session token as a dealer', () => {
    const t = createSessionToken(DEFAULT_SUPER_ADMIN);
    expect(verifyDealerToken(t)).toBeNull();
  });

  it('does not accept a signup token as a dealer session', () => {
    const t = createSignupToken({ businessName: 'X', email: 'a@b.com', phone: '' });
    expect(verifyDealerToken(t)).toBeNull();
  });

  it('expires', () => {
    const now = Date.now();
    const t = createDealerToken('dunrite', 'owner@dunrite.com', now);
    expect(verifyDealerToken(t, now + TTL.SESSION_TTL_MS - 1000)).not.toBeNull();
    expect(verifyDealerToken(t, now + TTL.SESSION_TTL_MS + 1000)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const t = createDealerToken('dunrite', 'owner@dunrite.com');
    const [json, sig] = [t.slice(0, t.lastIndexOf('.')), t.slice(t.lastIndexOf('.') + 1)];
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(json, 'base64url').toString()), dealerId: 'other' }),
    ).toString('base64url');
    expect(verifyDealerToken(`${forged}.${sig}`)).toBeNull();
  });

  it('uses its own cookie so both sessions can coexist', () => {
    expect(DEALER_COOKIE).not.toBe(SESSION_COOKIE);
    expect(dealerCookieOptions().httpOnly).toBe(true);
  });
});

describe('the admin allowlist survives the dealer-token change', () => {
  // The regression guard. decode() must keep applying isAllowedAdmin to admin
  // kinds, and must NOT apply it to dealer kinds.
  it('still rejects an admin token for an address no longer allowed', () => {
    process.env.SUPER_ADMIN_EMAILS = 'someone@else.com';
    const t = createSessionToken('someone@else.com');
    expect(verifySessionToken(t)).toBe('someone@else.com');
    process.env.SUPER_ADMIN_EMAILS = 'nobody@nowhere.com';
    expect(verifySessionToken(t)).toBeNull();
  });

  it('still rejects a magic token for an address no longer allowed', () => {
    process.env.SUPER_ADMIN_EMAILS = 'someone@else.com';
    const t = createMagicToken('someone@else.com');
    process.env.SUPER_ADMIN_EMAILS = 'nobody@nowhere.com';
    expect(verifyMagicToken(t)).toBeNull();
  });

  it('does not apply the admin allowlist to dealer tokens', () => {
    process.env.SUPER_ADMIN_EMAILS = 'nobody@nowhere.com';
    const t = createDealerToken('dunrite', 'owner@dunrite.com');
    expect(verifyDealerToken(t)).toEqual({ dealerId: 'dunrite', email: 'owner@dunrite.com' });
  });
});

describe('signup tokens', () => {
  it('round-trips the signup payload', () => {
    const t = createSignupToken({ businessName: '  Bob Buildings ', email: 'BOB@x.com', phone: '5551234567' });
    expect(verifySignupToken(t)).toEqual({
      businessName: 'Bob Buildings',
      email: 'bob@x.com',
      phone: '5551234567',
    });
  });

  it('expires on the magic-link clock, not the session one', () => {
    const now = Date.now();
    const t = createSignupToken({ businessName: 'X', email: 'a@b.com', phone: '' }, now);
    expect(verifySignupToken(t, now + TTL.MAGIC_LINK_TTL_MS + 1000)).toBeNull();
  });

  it('is not usable as a magic link or an admin session', () => {
    const t = createSignupToken({ businessName: 'X', email: 'a@b.com', phone: '' });
    expect(verifyMagicToken(t)).toBeNull();
    expect(verifySessionToken(t)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/admin/__tests__/auth.test.ts`
Expected: FAIL — `createDealerToken` is not exported.

- [ ] **Step 3: Write the implementation**

In `lib/admin/auth.ts`, replace the `TokenBody` interface and `decode()` with the following, and add the new exports at the end of the file. Everything else in the file is unchanged.

```ts
export const DEALER_COOKIE = 'steelsync_dealer';

export interface SignupPayload {
  businessName: string;
  email: string;
  phone: string;
}

type TokenKind = 'magic' | 'session' | 'dealer' | 'signup';

/**
 * Kinds that identify a SUPER-ADMIN, and so must be re-checked against
 * SUPER_ADMIN_EMAILS on every use.
 *
 * This set is the security boundary of this file. A kind added here that is not
 * an admin kind locks a dealer out; a kind LEFT OUT that is an admin kind is an
 * admin bypass. It is written as an explicit set rather than an early return so
 * that adding a kind forces a decision about which side it falls on.
 */
const ADMIN_KINDS: ReadonlySet<TokenKind> = new Set(['magic', 'session']);

interface TokenBody {
  email: string;
  exp: number;
  kind: TokenKind;
  /** Random, so two tokens for the same email at the same ms are still distinct. */
  jti: string;
  /** Present on 'dealer' tokens only. */
  dealerId?: string;
  /** Present on 'signup' tokens only. */
  signup?: SignupPayload;
}

function decode(token: unknown, kind: TokenKind, now: number): TokenBody | null {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const json = token.slice(0, idx);
  const sig = token.slice(idx + 1);

  // Verify BEFORE parsing: never let unverified bytes reach JSON.parse and
  // become a decision.
  if (!safeEqual(sig, sign(json))) return null;

  let body: TokenBody;
  try {
    body = JSON.parse(Buffer.from(json, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (body.kind !== kind) return null;
  if (typeof body.exp !== 'number' || body.exp <= now) return null;

  // Re-check the allowlist on every use of an ADMIN token. A signed token
  // issued to someone since removed from SUPER_ADMIN_EMAILS must stop working
  // immediately rather than lasting until it expires. Dealer and signup tokens
  // are not admin identities and are not in that allowlist — they are checked
  // against the database by their own guard instead.
  if (ADMIN_KINDS.has(kind) && !isAllowedAdmin(body.email)) return null;

  return body;
}
```

Then update the two existing verifiers to unwrap the body, and add the new ones:

```ts
export function verifyMagicToken(token: unknown, now: number = Date.now()): string | null {
  return decode(token, 'magic', now)?.email?.trim().toLowerCase() ?? null;
}

export function verifySessionToken(token: unknown, now: number = Date.now()): string | null {
  return decode(token, 'session', now)?.email?.trim().toLowerCase() ?? null;
}

/**
 * A dealer's session.
 *
 * Carries the dealer id so no route ever has to take one from the request. This
 * token proves WHO is asking; whether that dealer is still active is a database
 * question, answered by requireDealer() on every request.
 */
export function createDealerToken(
  dealerId: string,
  email: string,
  now: number = Date.now(),
): string {
  return encode({
    email: email.trim().toLowerCase(),
    dealerId: dealerId.trim().toLowerCase(),
    exp: now + SESSION_TTL_MS,
    kind: 'dealer',
    jti: randomBytes(9).toString('base64url'),
  });
}

export function verifyDealerToken(
  token: unknown,
  now: number = Date.now(),
): { dealerId: string; email: string } | null {
  const body = decode(token, 'dealer', now);
  if (!body || typeof body.dealerId !== 'string' || !body.dealerId) return null;
  return { dealerId: body.dealerId, email: body.email.trim().toLowerCase() };
}

/**
 * Carries a pending signup through the email round-trip.
 *
 * The payload travels IN the token rather than in a row, so no dealer exists
 * until a real mailbox has proven itself — which is what stops anyone squatting
 * a slug or filling the table from addresses that do not exist.
 */
export function createSignupToken(payload: SignupPayload, now: number = Date.now()): string {
  const email = payload.email.trim().toLowerCase();
  return encode({
    email,
    signup: {
      businessName: payload.businessName.trim(),
      email,
      phone: payload.phone.trim(),
    },
    exp: now + MAGIC_LINK_TTL_MS,
    kind: 'signup',
    jti: randomBytes(9).toString('base64url'),
  });
}

export function verifySignupToken(token: unknown, now: number = Date.now()): SignupPayload | null {
  const body = decode(token, 'signup', now);
  const s = body?.signup;
  if (!s || typeof s.businessName !== 'string' || typeof s.email !== 'string') return null;
  return { businessName: s.businessName, email: s.email, phone: s.phone ?? '' };
}

/** Cookie attributes for a dealer session. Same hardening as the admin one. */
export function dealerCookieOptions() {
  return sessionCookieOptions();
}
```

Also widen `encode()`'s parameter to the updated `TokenBody` — it already takes `TokenBody`, so no change is needed beyond the interface above.

- [ ] **Step 4: Run the full admin auth suite**

Run: `npx vitest run lib/admin/__tests__/auth.test.ts`
Expected: PASS — every pre-existing test plus the new ones. If any pre-existing test fails, the `decode()` refactor broke the admin path; fix it before continuing.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add lib/admin/auth.ts lib/admin/__tests__/auth.test.ts
git commit -m "Give dealers a token that can never be an admin token"
```

---

### Task 3: Schema and migration

**Files:**
- Modify: `lib/db/schema.sql`
- Test: none (DDL; covered by the data-access tests that follow)

**Interfaces:**
- Consumes: nothing.
- Produces: table `dealer_users (email, dealer_id, created_at)`, column `dealers.plan`.

- [ ] **Step 1: Append to `lib/db/schema.sql`**

Append at the end of the file. Note the migration runner strips `--` comments before splitting on `;`, so comments are safe but must not contain a semicolon-bearing string literal.

```sql
-- Who may sign in to a dealer account.
--
-- Separate from dealers.email, which is a NOTIFICATION address: it is where
-- quote alerts go. Conflating the two means changing where alerts are sent
-- silently changes who can sign in.
--
-- PRIMARY KEY on email: one address belongs to one dealer, so signing in never
-- needs a "which dealer am I acting as" selector. Several rows may point at the
-- same dealer, so staff can be added later without a migration.
CREATE TABLE IF NOT EXISTS dealer_users (
  email      TEXT PRIMARY KEY,
  dealer_id  TEXT NOT NULL REFERENCES dealers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dealer_users_dealer_idx ON dealer_users (dealer_id);

-- What this dealer is paying for. The label lives here, what it MEANS lives in
-- lib/plans.ts next to the gate that enforces it.
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'none';

-- Preserve today's behaviour on deploy.
--
-- plan defaults to 'none', which denies AI. Any dealer already answering
-- customers would go silent the moment this ships, so they are moved to the
-- tier that matches what they are already doing. Runs once and is a no-op
-- afterwards because it only touches rows still on the default.
UPDATE dealers SET plan = 'pro' WHERE auto_reply = true AND plan = 'none';
```

- [ ] **Step 2: Verify the statement splitter handles it**

Run: `node -e "const s=require('fs').readFileSync('lib/db/schema.sql','utf8').replace(/--[^\r\n]*/g,''); const n=s.split(';').map(x=>x.trim()).filter(Boolean); console.log(n.length + ' statements'); console.log(n.slice(-4).join('\n---\n'))"`
Expected: the last four statements print cleanly as complete SQL — `CREATE TABLE dealer_users`, `CREATE INDEX`, `ALTER TABLE`, `UPDATE`. No fragment beginning mid-sentence.

- [ ] **Step 3: Run the migration**

Run: `npm run db:migrate`
Expected: `migration complete`.

- [ ] **Step 4: Confirm the column and table exist**

Run: `npm run db:migrate` a second time.
Expected: `migration complete` again, proving every statement is idempotent.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.sql
git commit -m "Give dealers a login table and a plan"
```

---

### Task 4: Dealer account data access

**Files:**
- Create: `lib/db/dealerUsers.ts`
- Test: `lib/db/__tests__/dealerUsers.test.ts`

**Interfaces:**
- Consumes: `getSql` from `lib/db/index.ts`, `isPlan`/`Plan` from `lib/plans.ts`.
- Produces:
  - `slugify(name: string): string`
  - `allocateDealerId(name: string): Promise<string>`
  - `createPendingDealer(p: { businessName: string; email: string; phone: string }): Promise<{ dealerId: string; created: boolean }>`
  - `dealerForLogin(email: string): Promise<string | null>`
  - `activeDealerForSession(dealerId: string, email: string): Promise<boolean>`
  - `setDealerPlan(dealerId: string, plan: Plan): Promise<void>`
  - `setDealerActive(dealerId: string, active: boolean): Promise<void>`

`slugify` is a pure function and is the only part unit-tested here; the query functions are exercised through the route tests in later tasks, which mock this module. That matches how this codebase already tests data access (see `lib/db/__tests__/dealers.test.ts`, which tests `mergePricingRules` and nothing that touches SQL).

- [ ] **Step 1: Write the failing test**

Create `lib/db/__tests__/dealerUsers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slugify } from '../dealerUsers';

describe('slugify', () => {
  it('makes a URL-safe id from a business name', () => {
    expect(slugify('Dunrite Metal Buildings')).toBe('dunrite-metal-buildings');
    expect(slugify("Bob's Carports & Barns")).toBe('bobs-carports-barns');
    expect(slugify('  Double   Spaces  ')).toBe('double-spaces');
    expect(slugify('Tejas-Mex')).toBe('tejas-mex');
  });

  it('never produces leading, trailing or doubled separators', () => {
    expect(slugify('--Weird--Name--')).toBe('weird-name');
    expect(slugify('!!!')).toBe('dealer');
  });

  it('caps the length so an id stays a usable URL', () => {
    expect(slugify('A'.repeat(200)).length).toBeLessThanOrEqual(40);
  });

  // The id is a public URL and a foreign key. It must never be empty.
  it('falls back to a usable id when nothing survives', () => {
    expect(slugify('')).toBe('dealer');
    expect(slugify('   ')).toBe('dealer');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/__tests__/dealerUsers.test.ts`
Expected: FAIL — cannot resolve `../dealerUsers`.

- [ ] **Step 3: Write the implementation**

Create `lib/db/dealerUsers.ts`:

```ts
import { getSql } from './index';
import type { Plan } from '../plans';

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

  await sql`
    INSERT INTO dealers (id, name, email, phone, pricing_rules, active, plan)
    VALUES (${dealerId}, ${p.businessName.trim()}, ${email}, ${p.phone.trim()},
            '{}'::jsonb, false, 'none')
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
```

Note: `activeDealerForSession` deliberately does **not** filter `d.active` — a pending dealer must be able to sign in and see their own empty dashboard. Deactivation is handled in Task 5's guard, which reads `active` and routes accordingly.

- [ ] **Step 4: Add the collision test**

Append to `lib/db/__tests__/dealerUsers.test.ts`. It stubs `getSql` so the first
candidate looks taken:

```ts
import { vi } from 'vitest';

describe('allocateDealerId', () => {
  it('suffixes an id that is already taken', async () => {
    const taken = new Set(['bob-buildings', 'bob-buildings-2']);
    vi.doMock('../index', () => ({
      getSql: () => (strings: TemplateStringsArray, ...params: unknown[]) =>
        Promise.resolve(taken.has(params[0] as string) ? [{ '?column?': 1 }] : []),
    }));
    const { allocateDealerId } = await import('../dealerUsers');
    expect(await allocateDealerId('Bob Buildings')).toBe('bob-buildings-3');
    vi.doUnmock('../index');
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/db/__tests__/dealerUsers.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/db/dealerUsers.ts lib/db/__tests__/dealerUsers.test.ts
git commit -m "Create a dealer and its first login from a signup"
```

---

### Task 5: The dealer guard

**Files:**
- Create: `lib/dealer/guard.ts`
- Test: `lib/dealer/__tests__/guard.test.ts`

**Interfaces:**
- Consumes: `DEALER_COOKIE`, `verifyDealerToken` from `lib/admin/auth.ts`; `activeDealerForSession` from `lib/db/dealerUsers.ts`.
- Produces: `requireDealer(): Promise<{ dealerId: string; email: string }>`.

- [ ] **Step 1: Write the failing test**

Create `lib/dealer/__tests__/guard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cookieStore = { get: vi.fn() };
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
const activeDealerForSession = vi.fn(async () => true);

vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/db/dealerUsers', () => ({ activeDealerForSession }));

process.env.ADMIN_SESSION_SECRET = 'x'.repeat(48);

const { requireDealer } = await import('../guard');
const { createDealerToken, createSessionToken, DEFAULT_SUPER_ADMIN } = await import(
  '@/lib/admin/auth'
);

beforeEach(() => {
  cookieStore.get.mockReset();
  redirect.mockClear();
  activeDealerForSession.mockClear();
  activeDealerForSession.mockResolvedValue(true);
});

const withCookie = (value: string | undefined) =>
  cookieStore.get.mockReturnValue(value === undefined ? undefined : { value });

describe('requireDealer', () => {
  it('returns the dealer from the session token', async () => {
    withCookie(createDealerToken('dunrite', 'owner@dunrite.com'));
    await expect(requireDealer()).resolves.toEqual({
      dealerId: 'dunrite',
      email: 'owner@dunrite.com',
    });
  });

  it('sends an unsigned visitor to the dealer login', async () => {
    withCookie(undefined);
    await expect(requireDealer()).rejects.toThrow('REDIRECT:/dealer/login');
  });

  // An admin cookie is not a dealer cookie. This is the privilege boundary in
  // the other direction.
  it('refuses an admin session token', async () => {
    withCookie(createSessionToken(DEFAULT_SUPER_ADMIN));
    await expect(requireDealer()).rejects.toThrow('REDIRECT:/dealer/login');
    expect(activeDealerForSession).not.toHaveBeenCalled();
  });

  // The reason this guard hits the database at all.
  it('locks out a dealer whose account has been removed', async () => {
    activeDealerForSession.mockResolvedValue(false);
    withCookie(createDealerToken('dunrite', 'owner@dunrite.com'));
    await expect(requireDealer()).rejects.toThrow('REDIRECT:/dealer/login');
  });

  it('treats a database failure as signed out, never as signed in', async () => {
    activeDealerForSession.mockRejectedValue(new Error('neon is down'));
    withCookie(createDealerToken('dunrite', 'owner@dunrite.com'));
    await expect(requireDealer()).rejects.toThrow('REDIRECT:/dealer/login');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dealer/__tests__/guard.test.ts`
Expected: FAIL — cannot resolve `../guard`.

- [ ] **Step 3: Write the implementation**

Create `lib/dealer/guard.ts`:

```ts
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DEALER_COOKIE, verifyDealerToken } from '../admin/auth';
import { activeDealerForSession } from '../db/dealerUsers';

/**
 * Gate for every page and route under /dealer.
 *
 * Server-side only, like requireAdmin(): a client check hides the UI but still
 * ships the data, and these pages carry a dealer's leads and customer contact
 * details.
 *
 * Unlike the admin guard this reads the DATABASE on every request. An admin
 * session can be stateless because SUPER_ADMIN_EMAILS is re-checked from the
 * environment each time; a dealer has no such allowlist, and without this query
 * removing a dealer would leave their cookie working for up to a week.
 *
 * Returns the dealer id so no route ever has to take one from the request.
 */
export async function requireDealer(): Promise<{ dealerId: string; email: string }> {
  let session: { dealerId: string; email: string } | null = null;
  try {
    session = verifyDealerToken((await cookies()).get(DEALER_COOKIE)?.value);
  } catch (err) {
    // A missing ADMIN_SESSION_SECRET throws here. That must lock everyone OUT.
    console.error('[dealer] session verification failed', err);
    session = null;
  }
  if (!session) redirect('/dealer/login');

  let stillGood = false;
  try {
    stillGood = await activeDealerForSession(session.dealerId, session.email);
  } catch (err) {
    // Fail closed. An outage must not become an open door.
    console.error('[dealer] account check failed', err);
    stillGood = false;
  }
  if (!stillGood) redirect('/dealer/login');

  return session;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dealer/__tests__/guard.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dealer/guard.ts lib/dealer/__tests__/guard.test.ts
git commit -m "Gate the dealer pages, and check the account on every request"
```

---

### Task 6: Signup and login email

**Files:**
- Create: `lib/dealer/sendDealerEmail.ts`
- Test: `lib/dealer/__tests__/sendDealerEmail.test.ts`

**Interfaces:**
- Consumes: `createSignupToken`, `TTL`, `type SignupPayload` from `lib/admin/auth.ts`.
- Produces: `sendDealerSignupLink(payload: SignupPayload, origin: string): Promise<void>`, `sendDealerLoginLink(dealerId: string, email: string, origin: string): Promise<void>`.

**Both emails carry a `'signup'` token, and that is deliberate.** A `'dealer'` token is a seven-day session and must never travel in a URL. A sign-in link therefore uses `createSignupToken({ businessName: '', email, phone: '' })` — the short-lived kind — and the callback reads the empty `businessName` as "sign in to the account this address already has" rather than "create one". One token kind and one callback cannot drift apart; two of each would.

- [ ] **Step 1: Write the failing test**

Create `lib/dealer/__tests__/sendDealerEmail.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn(async () => ({ error: null }));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));

process.env.ADMIN_SESSION_SECRET = 'x'.repeat(48);
process.env.RESEND_API_KEY = 'test-key';
process.env.LEAD_FROM_EMAIL = 'noreply@example.com';

const { sendDealerSignupLink, sendDealerLoginLink } = await import('../sendDealerEmail');
const { verifySignupToken } = await import('@/lib/admin/auth');

beforeEach(() => {
  send.mockClear();
  send.mockResolvedValue({ error: null });
});

const sentText = () => send.mock.calls[0][0].text as string;
const tokenFrom = (text: string) =>
  decodeURIComponent(text.match(/token=([^\s]+)/)![1]);

describe('sendDealerSignupLink', () => {
  it('emails a link whose token carries the signup details', async () => {
    await sendDealerSignupLink(
      { businessName: 'Bob Buildings', email: 'bob@x.com', phone: '5551234567' },
      'https://steel-sync.example',
    );
    const text = sentText();
    expect(text).toContain('https://steel-sync.example/api/dealer/callback?token=');
    expect(verifySignupToken(tokenFrom(text))).toEqual({
      businessName: 'Bob Buildings',
      email: 'bob@x.com',
      phone: '5551234567',
    });
  });

  it('throws when Resend rejects the send', async () => {
    send.mockResolvedValue({ error: { name: 'bad', message: 'nope' } });
    await expect(
      sendDealerSignupLink({ businessName: 'B', email: 'b@x.com', phone: '' }, 'https://x'),
    ).rejects.toThrow(/Resend/);
  });
});

describe('sendDealerLoginLink', () => {
  it('emails a link whose token names the account but creates nothing', async () => {
    await sendDealerLoginLink('dunrite', 'owner@dunrite.com', 'https://steel-sync.example');
    const payload = verifySignupToken(tokenFrom(sentText()));
    expect(payload).toEqual({ businessName: '', email: 'owner@dunrite.com', phone: '' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dealer/__tests__/sendDealerEmail.test.ts`
Expected: FAIL — cannot resolve `../sendDealerEmail`.

- [ ] **Step 3: Write the implementation**

Create `lib/dealer/sendDealerEmail.ts`:

```ts
import { Resend } from 'resend';
import { createSignupToken, TTL, type SignupPayload } from '../admin/auth';

/**
 * The two emails a dealer account needs: finish signing up, and sign in.
 *
 * Both carry the same token kind. A signup link's token holds the business
 * name; a login link's does not, and the callback reads that difference as
 * "create the account" versus "sign in to the one this address already has".
 * One kind and one callback beats two of each that can drift apart.
 *
 * Resend's SDK does NOT throw on a rejected send — it resolves to
 * { data, error }. Ignoring the result would report a link as sent that never
 * left. The link itself is never logged: a sign-in link in a log file is a
 * credential in a place nobody treats as one.
 */

async function send(to: string, subject: string, lines: string[]): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_FROM_EMAIL;
  if (!key || !from) {
    console.error('[dealer] cannot send: RESEND_API_KEY / LEAD_FROM_EMAIL are not set');
    throw new Error('email is not configured');
  }
  const { error } = await new Resend(key).emails.send({ from, to, subject, text: lines.join('\n') });
  if (error) throw new Error(`Resend send failed: ${error.name} ${error.message}`);
}

function linkFor(token: string, origin: string): string {
  return `${origin}/api/dealer/callback?token=${encodeURIComponent(token)}`;
}

const minutes = () => Math.round(TTL.MAGIC_LINK_TTL_MS / 60000);

export async function sendDealerSignupLink(
  payload: SignupPayload,
  origin: string,
): Promise<void> {
  const url = linkFor(createSignupToken(payload), origin);
  await send(payload.email, 'Finish setting up your Steel Sync account', [
    'Click to finish creating your Steel Sync dealer account:',
    '',
    url,
    '',
    `This link expires in ${minutes()} minutes.`,
    'Your account is created when you open it — nothing happens until then.',
    'If you did not request this, you can ignore this message.',
  ]);
}

export async function sendDealerLoginLink(
  dealerId: string,
  email: string,
  origin: string,
): Promise<void> {
  // No business name: the callback reads that as "sign in", not "create".
  const url = linkFor(createSignupToken({ businessName: '', email, phone: '' }), origin);
  await send(email, 'Your Steel Sync sign-in link', [
    'Click to sign in to your Steel Sync dealer account:',
    '',
    url,
    '',
    `This link expires in ${minutes()} minutes.`,
    'If you did not request it, you can ignore this message.',
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dealer/__tests__/sendDealerEmail.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dealer/sendDealerEmail.ts lib/dealer/__tests__/sendDealerEmail.test.ts
git commit -m "Email a dealer their signup and sign-in links"
```

---

### Task 7: Signup, login and callback routes

**Files:**
- Create: `app/api/dealer/signup/route.ts`
- Create: `app/api/dealer/login/route.ts`
- Create: `app/api/dealer/callback/route.ts`
- Create: `app/api/dealer/logout/route.ts`
- Test: `app/api/dealer/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: `createPendingDealer`, `dealerForLogin` from `lib/db/dealerUsers.ts`; `sendDealerSignupLink`, `sendDealerLoginLink` from `lib/dealer/sendDealerEmail.ts`; `verifySignupToken`, `createDealerToken`, `dealerCookieOptions`, `DEALER_COOKIE`, `adminOrigin`, `adminUrl` from `lib/admin/auth.ts`.
- Produces: HTTP endpoints only.

- [ ] **Step 1: Write the failing test**

Create `app/api/dealer/__tests__/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createPendingDealer = vi.fn(async () => ({ dealerId: 'bob-buildings', created: true }));
const dealerForLogin = vi.fn(async (email: string) =>
  email === 'owner@dunrite.com' ? 'dunrite' : null,
);
const sendDealerSignupLink = vi.fn(async () => {});
const sendDealerLoginLink = vi.fn(async () => {});

vi.mock('@/lib/db/dealerUsers', () => ({ createPendingDealer, dealerForLogin }));
vi.mock('@/lib/dealer/sendDealerEmail', () => ({ sendDealerSignupLink, sendDealerLoginLink }));

process.env.ADMIN_SESSION_SECRET = 'x'.repeat(48);
process.env.ADMIN_ORIGIN = 'https://steel-sync.example';

const { POST: signup } = await import('../signup/route');
const { POST: login } = await import('../login/route');
const { GET: callback } = await import('../callback/route');
const { createSignupToken, DEALER_COOKIE, verifyDealerToken } = await import(
  '@/lib/admin/auth'
);

let ip = 0;
const post = (url: string, body: any) =>
  new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.1.0.${++ip % 250}-${ip}` },
  });

beforeEach(() => {
  createPendingDealer.mockClear();
  dealerForLogin.mockClear();
  sendDealerSignupLink.mockClear();
  sendDealerLoginLink.mockClear();
});

describe('POST /api/dealer/signup', () => {
  it('emails a link and writes NOTHING', async () => {
    const res = await signup(
      post('http://x/api/dealer/signup', {
        businessName: 'Bob Buildings',
        email: 'bob@x.com',
        phone: '5551234567',
      }) as any,
    );
    expect(res.status).toBe(200);
    expect(sendDealerSignupLink).toHaveBeenCalledOnce();
    // The point of the whole flow: no dealer exists until the link is opened.
    expect(createPendingDealer).not.toHaveBeenCalled();
  });

  it('rejects a signup with no business name', async () => {
    const res = await signup(
      post('http://x/api/dealer/signup', { businessName: '  ', email: 'b@x.com' }) as any,
    );
    expect(res.status).toBe(400);
    expect(sendDealerSignupLink).not.toHaveBeenCalled();
  });

  it('rejects an address that is not an email', async () => {
    const res = await signup(
      post('http://x/api/dealer/signup', { businessName: 'B', email: 'not-an-email' }) as any,
    );
    expect(res.status).toBe(400);
    expect(sendDealerSignupLink).not.toHaveBeenCalled();
  });
});

describe('POST /api/dealer/login', () => {
  it('emails a link to a known address', async () => {
    const res = await login(post('http://x/api/dealer/login', { email: 'owner@dunrite.com' }) as any);
    expect(res.status).toBe(200);
    expect(sendDealerLoginLink).toHaveBeenCalledOnce();
  });

  // Never reveal who has an account.
  it('answers identically for an unknown address', async () => {
    const known = await login(post('http://x/api/dealer/login', { email: 'owner@dunrite.com' }) as any);
    const unknown = await login(post('http://x/api/dealer/login', { email: 'nobody@x.com' }) as any);
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it('answers identically when the send itself fails', async () => {
    sendDealerLoginLink.mockRejectedValueOnce(new Error('resend down'));
    const res = await login(post('http://x/api/dealer/login', { email: 'owner@dunrite.com' }) as any);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/dealer/callback', () => {
  const get = (token: string) =>
    new Request(`http://x/api/dealer/callback?token=${encodeURIComponent(token)}`);

  it('creates the dealer and signs them in', async () => {
    const token = createSignupToken({
      businessName: 'Bob Buildings',
      email: 'bob@x.com',
      phone: '5551234567',
    });
    const res = await callback(get(token) as any);
    expect(createPendingDealer).toHaveBeenCalledWith({
      businessName: 'Bob Buildings',
      email: 'bob@x.com',
      phone: '5551234567',
    });
    expect(res.headers.get('location')).toBe('https://steel-sync.example/dealer');
    const cookie = res.cookies.get(DEALER_COOKIE)!.value;
    expect(verifyDealerToken(cookie)).toEqual({ dealerId: 'bob-buildings', email: 'bob@x.com' });
  });

  it('signs in an existing account without creating anything', async () => {
    const token = createSignupToken({ businessName: '', email: 'owner@dunrite.com', phone: '' });
    const res = await callback(get(token) as any);
    expect(createPendingDealer).not.toHaveBeenCalled();
    expect(verifyDealerToken(res.cookies.get(DEALER_COOKIE)!.value)).toEqual({
      dealerId: 'dunrite',
      email: 'owner@dunrite.com',
    });
  });

  it('sends an expired or forged token back to the login page with no cookie', async () => {
    const res = await callback(get('not-a-token') as any);
    expect(res.headers.get('location')).toContain('/dealer/login?error=expired');
    expect(res.cookies.get(DEALER_COOKIE)?.value).toBeFalsy();
  });

  it('does not sign in a sign-in link for an account that no longer exists', async () => {
    const token = createSignupToken({ businessName: '', email: 'gone@x.com', phone: '' });
    const res = await callback(get(token) as any);
    expect(res.headers.get('location')).toContain('/dealer/login?error=expired');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/dealer/__tests__/auth.test.ts`
Expected: FAIL — cannot resolve `../signup/route`.

- [ ] **Step 3: Write the four routes**

Create `app/api/dealer/signup/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { adminOrigin } from '@/lib/admin/auth';
import { sendDealerSignupLink } from '@/lib/dealer/sendDealerEmail';
import { createRateLimiter, clientKey } from '@/lib/rateLimit';

/**
 * Start a dealer account.
 *
 * Writes NOTHING. The signup details ride in the emailed token and the rows are
 * created when the link is opened, because dealers.id is a public URL: a row
 * written before the mailbox is proven lets anyone squat a competitor's slug
 * and fill the table from addresses that do not exist.
 *
 * Rate limited for the same reason /api/quote is — an unauthenticated endpoint
 * that sends email is an open door.
 */
const limiter = createRateLimiter(5, 15 * 60_000);

const MAX_FIELD = 120;

/** Deliberately loose. Real validation is that the link has to arrive. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const gate = limiter.check(clientKey(req.headers));
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } },
    );
  }

  const businessName = typeof body?.businessName === 'string' ? body.businessName.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim().slice(0, MAX_FIELD) : '';

  if (!businessName) {
    return NextResponse.json({ error: 'Tell us your business name' }, { status: 400 });
  }
  if (!LOOKS_LIKE_EMAIL.test(email)) {
    return NextResponse.json({ error: 'That does not look like an email address' }, { status: 400 });
  }

  try {
    await sendDealerSignupLink(
      { businessName: businessName.slice(0, MAX_FIELD), email, phone },
      adminOrigin(req),
    );
  } catch (err) {
    console.error('[dealer/signup] failed to send link', err);
  }

  return NextResponse.json({
    ok: true,
    message: 'Check your email for a link to finish setting up your account.',
  });
}
```

Create `app/api/dealer/login/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { adminOrigin } from '@/lib/admin/auth';
import { dealerForLogin } from '@/lib/db/dealerUsers';
import { sendDealerLoginLink } from '@/lib/dealer/sendDealerEmail';
import { createRateLimiter, clientKey } from '@/lib/rateLimit';

/**
 * Request a dealer sign-in link.
 *
 * Answers IDENTICALLY whether or not the address has an account, and whether or
 * not the send succeeded. Anything else turns this into a way to find out who
 * our dealers are.
 */
const limiter = createRateLimiter(5, 15 * 60_000);

const SAME_ANSWER = {
  ok: true,
  message: 'If that address has an account, a sign-in link is on its way.',
};

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const gate = limiter.check(clientKey(req.headers));
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } },
    );
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (email) {
    try {
      const dealerId = await dealerForLogin(email);
      if (dealerId) await sendDealerLoginLink(dealerId, email, adminOrigin(req));
    } catch (err) {
      console.error('[dealer/login] failed to send sign-in link', err);
    }
  }

  return NextResponse.json(SAME_ANSWER);
}
```

Create `app/api/dealer/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import {
  verifySignupToken,
  createDealerToken,
  dealerCookieOptions,
  DEALER_COOKIE,
  adminUrl,
} from '@/lib/admin/auth';
import { createPendingDealer, dealerForLogin } from '@/lib/db/dealerUsers';

/**
 * Open a dealer link -> create the account if this is a signup, then sign in.
 *
 * A token carrying a business name is a SIGNUP and creates the rows. One
 * without is a SIGN-IN for an account that must already exist. That difference
 * is why there is one token kind and one callback rather than two of each.
 *
 * Redirects rather than rendering, so the token leaves the address bar instead
 * of sitting in history and in the next page's Referer.
 */
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token');
  const payload = verifySignupToken(token);

  const reject = () => NextResponse.redirect(adminUrl('/dealer/login?error=expired', req));

  if (!payload) return reject();

  let dealerId: string | null = null;
  try {
    if (payload.businessName) {
      dealerId = (await createPendingDealer(payload)).dealerId;
    } else {
      // A sign-in link for an account since deleted must not resurrect it.
      dealerId = await dealerForLogin(payload.email);
    }
  } catch (err) {
    console.error('[dealer/callback] could not resolve the account', err);
    return reject();
  }

  if (!dealerId) return reject();

  const res = NextResponse.redirect(adminUrl('/dealer', req));
  res.cookies.set(
    DEALER_COOKIE,
    createDealerToken(dealerId, payload.email),
    dealerCookieOptions(),
  );
  return res;
}
```

Create `app/api/dealer/logout/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { DEALER_COOKIE, dealerCookieOptions, adminUrl } from '@/lib/admin/auth';

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(adminUrl('/dealer/login', req), { status: 303 });
  // maxAge 0 expires it rather than merely clearing the value client-side.
  res.cookies.set(DEALER_COOKIE, '', { ...dealerCookieOptions(), maxAge: 0 });
  return res;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/dealer/__tests__/auth.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/dealer lib/dealer
git commit -m "Let a dealer sign themselves up, and create nothing until the link is opened"
```

---

### Task 8: Signup and login pages

**Files:**
- Create: `app/dealer/signup/page.tsx`
- Create: `app/dealer/login/page.tsx`
- Create: `components/dealer/AuthForm.tsx`
- Test: `components/dealer/__tests__/AuthForm.test.tsx`

**Interfaces:**
- Consumes: the routes from Task 7.
- Produces: `AuthForm` — a client component taking `{ mode: 'signup' | 'login' }`.

- [ ] **Step 1: Write the failing test**

Create `components/dealer/__tests__/AuthForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AuthForm from '../AuthForm';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, message: 'Check your email.' }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('AuthForm', () => {
  it('posts the signup fields and shows the result message', async () => {
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText(/business name/i), {
      target: { value: 'Bob Buildings' },
    });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'bob@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/dealer/signup');
    expect(JSON.parse(init.body)).toMatchObject({
      businessName: 'Bob Buildings',
      email: 'bob@x.com',
    });
    expect(await screen.findByText('Check your email.')).toBeTruthy();
  });

  it('asks only for an email in login mode', () => {
    render(<AuthForm mode="login" />);
    expect(screen.queryByLabelText(/business name/i)).toBeNull();
    expect(screen.getByRole('button', { name: /send.*link/i })).toBeTruthy();
  });

  it('shows the server error instead of a success message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Tell us your business name' }),
    });
    render(<AuthForm mode="signup" />);
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText('Tell us your business name')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/dealer/__tests__/AuthForm.test.tsx`
Expected: FAIL — cannot resolve `../AuthForm`.

- [ ] **Step 3: Write the component and pages**

Create `components/dealer/AuthForm.tsx`:

```tsx
'use client';

import { useState } from 'react';

/**
 * Signup and sign-in are the same form with one extra field, so they are one
 * component. Two would drift, and the half that drifted would be the half
 * handling the server's error.
 */
export default function AuthForm({ mode }: { mode: 'signup' | 'login' }) {
  const signup = mode === 'signup';
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(signup ? '/api/dealer/signup' : '/api/dealer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signup ? { businessName, email, phone } : { email }),
      });
      const data = await res.json();
      if (res.ok) setMessage(data.message ?? 'Check your email.');
      else setError(data.error ?? 'Something went wrong. Try again.');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {signup && (
        <Field id="businessName" label="Business name" value={businessName} onChange={setBusinessName} />
      )}
      <Field id="email" label="Email" type="email" value={email} onChange={setEmail} />
      {signup && <Field id="phone" label="Phone (optional)" value={phone} onChange={setPhone} />}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {signup ? 'Create account' : 'Send sign-in link'}
      </button>

      {message && <p className="text-sm text-green-700">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  );
}
```

Create `app/dealer/signup/page.tsx`:

```tsx
import Link from 'next/link';
import AuthForm from '@/components/dealer/AuthForm';

export const metadata = { title: 'Create your Steel Sync account' };

export default function DealerSignupPage() {
  return (
    <Shell title="Create your account" footer={<Link href="/dealer/login" className="text-blue-600 hover:underline">Already have one? Sign in</Link>}>
      <AuthForm mode="signup" />
    </Shell>
  );
}

function Shell({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-5">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6">
        <h1 className="mb-5 text-lg font-bold tracking-tight text-gray-900">{title}</h1>
        {children}
        <p className="mt-5 text-xs text-gray-500">{footer}</p>
      </div>
    </div>
  );
}
```

Create `app/dealer/login/page.tsx`, same shape:

```tsx
import Link from 'next/link';
import AuthForm from '@/components/dealer/AuthForm';

export const metadata = { title: 'Sign in to Steel Sync' };

export default async function DealerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-5">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6">
        <h1 className="mb-5 text-lg font-bold tracking-tight text-gray-900">Sign in</h1>
        {error === 'expired' && (
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            That link has expired or was already used. Request a new one below.
          </p>
        )}
        <AuthForm mode="login" />
        <p className="mt-5 text-xs text-gray-500">
          <Link href="/dealer/signup" className="text-blue-600 hover:underline">
            Need an account? Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/dealer/__tests__/AuthForm.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/dealer components/dealer
git commit -m "Put a signup and sign-in page in front of the dealer routes"
```

---

### Task 9: Dealer-scoped reads

**Files:**
- Create: `lib/dealer/data.ts`
- Test: `lib/dealer/__tests__/data.test.ts`

**Interfaces:**
- Consumes: `getSql` from `lib/db/index.ts`.
- Produces: `dealerQuotes(dealerId: string, limit?: number): Promise<QuoteRow[]>`, `dealerConversations(dealerId: string, limit?: number): Promise<ConversationRow[]>`, `dealerAccount(dealerId: string): Promise<DealerAccount | null>` where `interface DealerAccount { id: string; name: string; email: string | null; phone: string | null; website: string | null; serviceArea: string | null; policies: string | null; offersRto: boolean; plan: string; active: boolean }`, and `updateDealerProfile(dealerId: string, p: DealerProfileInput): Promise<void>` where `interface DealerProfileInput { name: string; email: string; phone: string; website: string; serviceArea: string; policies: string; offersRto: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `lib/dealer/__tests__/data.test.ts`. This asserts the SQL is parameterised on the dealer id — the tenancy property — by capturing what the driver is handed:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the tagged-template calls the module makes.
const calls: { strings: string[]; params: unknown[] }[] = [];
const sql = (strings: TemplateStringsArray, ...params: unknown[]) => {
  calls.push({ strings: [...strings], params });
  return Promise.resolve([]);
};
vi.mock('@/lib/db/index', () => ({ getSql: () => sql }));

const { dealerQuotes, dealerConversations, updateDealerProfile } = await import('../data');

beforeEach(() => {
  calls.length = 0;
});

const joined = (i = 0) => calls[i].strings.join('?');

describe('dealer reads are scoped to one dealer', () => {
  it('filters quotes by the dealer id it was given', async () => {
    await dealerQuotes('dunrite');
    expect(joined()).toMatch(/FROM quotes/i);
    expect(joined()).toMatch(/WHERE dealer_id =/i);
    expect(calls[0].params).toContain('dunrite');
  });

  it('filters conversations by the dealer id it was given', async () => {
    await dealerConversations('dunrite');
    expect(joined()).toMatch(/FROM conversations/i);
    expect(joined()).toMatch(/WHERE dealer_id =/i);
    expect(calls[0].params).toContain('dunrite');
  });

  // The dealer must not be able to edit what they are allowed to do.
  it('never writes plan, active or pricing when a dealer edits their profile', async () => {
    await updateDealerProfile('dunrite', {
      name: 'Bob', email: 'b@x.com', phone: '1', website: '',
      serviceArea: '', policies: '', offersRto: false,
    });
    const stmt = joined();
    expect(stmt).not.toMatch(/\bplan\b/i);
    expect(stmt).not.toMatch(/\bactive\b/i);
    expect(stmt).not.toMatch(/pricing_rules/i);
    expect(calls[0].params).toContain('dunrite');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dealer/__tests__/data.test.ts`
Expected: FAIL — cannot resolve `../data`.

- [ ] **Step 3: Write the implementation**

Create `lib/dealer/data.ts`:

```ts
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
    const transcript: string[] = Array.isArray(r.transcript) ? r.transcript : [];
    return {
      id: r.id,
      channel: r.channel,
      lastOutcome: r.last_outcome,
      turns: transcript.length,
      lastMessage: transcript.length ? transcript[transcript.length - 1] : null,
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
}

export async function dealerAccount(dealerId: string): Promise<DealerAccount | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, name, email, phone, website, service_area, policies, offers_rto, plan, active
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dealer/__tests__/data.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dealer/data.ts lib/dealer/__tests__/data.test.ts
git commit -m "Read and write only the signed-in dealer's own rows"
```

---

### Task 10: The dealer dashboard

**Files:**
- Create: `app/dealer/page.tsx`
- Create: `app/dealer/settings/page.tsx`
- Create: `components/dealer/ProfileForm.tsx`
- Create: `app/api/dealer/profile/route.ts`
- Test: `app/api/dealer/__tests__/profile.test.ts`

**Interfaces:**
- Consumes: `requireDealer` (Task 5); `dealerQuotes`, `dealerConversations`, `dealerAccount`, `updateDealerProfile` (Task 9).
- Produces: pages only, plus `POST /api/dealer/profile`.

- [ ] **Step 1: Write the failing test**

Create `app/api/dealer/__tests__/profile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireDealer = vi.fn(async () => ({ dealerId: 'dunrite', email: 'owner@dunrite.com' }));
const updateDealerProfile = vi.fn(async () => {});

vi.mock('@/lib/dealer/guard', () => ({ requireDealer }));
vi.mock('@/lib/dealer/data', () => ({ updateDealerProfile }));

const { POST } = await import('../profile/route');

const post = (body: any) =>
  new Request('http://x/api/dealer/profile', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

const valid = {
  name: 'Dunrite', email: 'o@d.com', phone: '5551234567',
  website: 'https://d.com', serviceArea: 'East Texas', policies: '', offersRto: true,
};

beforeEach(() => {
  requireDealer.mockClear();
  updateDealerProfile.mockClear();
  requireDealer.mockResolvedValue({ dealerId: 'dunrite', email: 'owner@dunrite.com' });
});

describe('POST /api/dealer/profile', () => {
  it('saves the fields against the session dealer', async () => {
    const res = await POST(post(valid) as any);
    expect(res.status).toBe(200);
    expect(updateDealerProfile).toHaveBeenCalledWith('dunrite', expect.objectContaining({
      name: 'Dunrite', serviceArea: 'East Texas', offersRto: true,
    }));
  });

  // The tenancy property, stated as a test: a dealer id in the body is ignored.
  it('ignores a dealerId supplied by the caller', async () => {
    await POST(post({ ...valid, dealerId: 'tejasmex', id: 'tejasmex' }) as any);
    expect(updateDealerProfile.mock.calls[0][0]).toBe('dunrite');
  });

  // Even if a caller sends them, they must not reach the update.
  it('ignores plan and active in the body', async () => {
    await POST(post({ ...valid, plan: 'pro', active: true }) as any);
    const written = updateDealerProfile.mock.calls[0][1];
    expect(written).not.toHaveProperty('plan');
    expect(written).not.toHaveProperty('active');
  });

  it('rejects an empty business name', async () => {
    const res = await POST(post({ ...valid, name: '  ' }) as any);
    expect(res.status).toBe(400);
    expect(updateDealerProfile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/dealer/__tests__/profile.test.ts`
Expected: FAIL — cannot resolve `../profile/route`.

- [ ] **Step 3: Write the route**

Create `app/api/dealer/profile/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireDealer } from '@/lib/dealer/guard';
import { updateDealerProfile } from '@/lib/dealer/data';

/**
 * A dealer edits their own details.
 *
 * The dealer id comes from requireDealer(), never from the body. Fields are
 * picked out one by one rather than spread, so a caller cannot smuggle `plan`
 * or `active` into the update and grant themselves a capability.
 */
const MAX_SHORT = 200;
const MAX_LONG = 4000;

const str = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

export async function POST(req: NextRequest) {
  const { dealerId } = await requireDealer();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const name = str(body?.name, MAX_SHORT);
  if (!name) {
    return NextResponse.json({ error: 'Your business name cannot be empty' }, { status: 400 });
  }

  try {
    await updateDealerProfile(dealerId, {
      name,
      email: str(body?.email, MAX_SHORT),
      phone: str(body?.phone, MAX_SHORT),
      website: str(body?.website, MAX_SHORT),
      serviceArea: str(body?.serviceArea, MAX_LONG),
      policies: str(body?.policies, MAX_LONG),
      offersRto: body?.offersRto === true,
    });
  } catch (err) {
    console.error('[dealer/profile] save failed', err);
    return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 503 });
  }

  return NextResponse.json({ ok: true, message: 'Saved.' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/dealer/__tests__/profile.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the dashboard page**

Create `app/dealer/page.tsx`:

```tsx
import Link from 'next/link';
import { requireDealer } from '@/lib/dealer/guard';
import { dealerQuotes, dealerConversations, dealerAccount } from '@/lib/dealer/data';
import { planAllows } from '@/lib/plans';

/**
 * A dealer's own dashboard.
 *
 * requireDealer() FIRST on every page under /dealer, and every query takes the
 * dealer id it returns. There is no route here that names a dealer, so there is
 * nothing to tamper with.
 */
export const dynamic = 'force-dynamic';

const money = (cents: number | null) =>
  cents == null ? '—' : `$${Math.round(cents / 100).toLocaleString()}`;

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default async function DealerDashboard() {
  const { dealerId, email } = await requireDealer();

  const [account, quotes, conversations] = await Promise.all([
    dealerAccount(dealerId).catch(() => null),
    dealerQuotes(dealerId).catch(() => []),
    dealerConversations(dealerId).catch(() => []),
  ]);

  const aiOn = planAllows(account?.plan, 'aiAutoReply');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
          <span className="text-base font-bold tracking-tight text-gray-900">
            {account?.name ?? 'Steel Sync'}
          </span>
          <div className="flex items-center gap-4 text-xs">
            <span className="hidden text-gray-500 sm:block">{email}</span>
            <Link href="/dealer/settings" className="text-blue-600 hover:underline">
              Settings
            </Link>
            <form action="/api/dealer/logout" method="post">
              <button className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:border-gray-400">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-5 py-8">
        {account && !account.active && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong className="font-semibold">Your account is awaiting approval.</strong> Your
            public site and automated replies stay switched off until it is approved.
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-3">
          <Stat label="Quotes" value={String(quotes.length)} />
          <Stat label="Conversations" value={String(conversations.length)} />
          <Stat label="AI replies" value={aiOn ? 'On your plan' : 'Not on your plan'} />
        </section>

        <Panel title="Your quotes">
          <Table head={['Customer', 'Contact', 'Total', 'Status', 'When']}>
            {quotes.map(q => (
              <tr key={q.id} className="border-t border-gray-100">
                <td className="py-2.5 pr-4 font-medium text-gray-900">{q.customerName || '—'}</td>
                <td className="py-2.5 pr-4 text-gray-600">{q.customerEmail || q.customerPhone || '—'}</td>
                <td className="py-2.5 pr-4 text-gray-900">{money(q.totalCents)}</td>
                <td className="py-2.5 pr-4 text-gray-600">{q.status}</td>
                <td className="py-2.5 text-gray-600">{when(q.createdAt)}</td>
              </tr>
            ))}
            {!quotes.length && <Empty colSpan={5}>No quotes yet.</Empty>}
          </Table>
        </Panel>

        <Panel title="Messages">
          <Table head={['Channel', 'Last message', 'Turns', 'Outcome', 'Updated']}>
            {conversations.map(c => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="py-2.5 pr-4 font-medium text-gray-900">{c.channel}</td>
                <td className="max-w-xs truncate py-2.5 pr-4 text-gray-600">{c.lastMessage ?? '—'}</td>
                <td className="py-2.5 pr-4 text-gray-600">{c.turns}</td>
                <td className="py-2.5 pr-4 text-gray-600">{c.lastOutcome ?? '—'}</td>
                <td className="py-2.5 text-gray-600">{when(c.updatedAt)}</td>
              </tr>
            ))}
            {!conversations.length && <Empty colSpan={5}>No messages yet.</Empty>}
          </Table>
        </Panel>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">{title}</h2>
      <div className="overflow-x-auto px-4 py-2">{children}</div>
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wider text-gray-500">
          {head.map(h => (
            <th key={h} className="py-2 pr-4 font-medium">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Empty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-6 text-center text-sm text-gray-500">{children}</td>
    </tr>
  );
}
```

- [ ] **Step 6: Write the settings page and form**

Create `components/dealer/ProfileForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { DealerAccount } from '@/lib/dealer/data';

export default function ProfileForm({ account }: { account: DealerAccount }) {
  const [f, setF] = useState({
    name: account.name ?? '',
    email: account.email ?? '',
    phone: account.phone ?? '',
    website: account.website ?? '',
    serviceArea: account.serviceArea ?? '',
    policies: account.policies ?? '',
    offersRto: account.offersRto,
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof f) => (v: string | boolean) => setF(p => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const res = await fetch('/api/dealer/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      });
      const data = await res.json();
      if (res.ok) setNote(data.message ?? 'Saved.');
      else setError(data.error ?? 'Could not save.');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Text id="name" label="Business name" value={f.name} onChange={set('name')} />
      <Text id="email" label="Email for new leads" value={f.email} onChange={set('email')} />
      <Text id="phone" label="Phone" value={f.phone} onChange={set('phone')} />
      <Text id="website" label="Website" value={f.website} onChange={set('website')} />
      <Area
        id="serviceArea"
        label="Where you deliver"
        hint="Plain words. The assistant reads this to answer “do you deliver to…”."
        value={f.serviceArea}
        onChange={set('serviceArea')}
      />
      <Area
        id="policies"
        label="Facts the assistant may state"
        hint="Warranty terms, site prep, anything it should be able to answer without you."
        value={f.policies}
        onChange={set('policies')}
      />
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={f.offersRto}
          onChange={e => set('offersRto')(e.target.checked)}
        />
        We offer rent-to-own
      </label>

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        Save
      </button>
      {note && <p className="text-sm text-green-700">{note}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function Text({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">{label}</label>
      <input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  );
}

function Area({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">{label}</label>
      <p className="text-xs text-gray-500">{hint}</p>
      <textarea
        id={id}
        rows={3}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  );
}
```

Create `app/dealer/settings/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireDealer } from '@/lib/dealer/guard';
import { dealerAccount } from '@/lib/dealer/data';
import ProfileForm from '@/components/dealer/ProfileForm';

export const dynamic = 'force-dynamic';

export default async function DealerSettingsPage() {
  const { dealerId } = await requireDealer();
  const account = await dealerAccount(dealerId);
  if (!account) notFound();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5">
          <span className="text-base font-bold tracking-tight text-gray-900">Settings</span>
          <Link href="/dealer" className="text-xs text-blue-600 hover:underline">
            Back to dashboard
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-8">
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <ProfileForm account={account} />
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Your plan is <strong>{account.plan}</strong>. Pricing and plan changes are handled by
          Steel Sync — get in touch to change them.
        </p>
      </main>
    </div>
  );
}
```

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add app/dealer app/api/dealer components/dealer
git commit -m "Show a dealer their own leads and let them edit their own details"
```

---

### Task 11: Carry the plan on the dealer, and gate the model call

**Files:**
- Modify: `lib/building/types.ts` (add `plan` to `DealerSettings`)
- Modify: `lib/db/dealers.ts` (select `plan` in `getDealer`)
- Modify: `lib/inbound/handleInbound.ts` (the gate)
- Test: `lib/inbound/__tests__/planGate.test.ts`

**Interfaces:**
- Consumes: `planAllows` from `lib/plans.ts`.
- Produces: `handleInboundMessage(dealer, msg, opts?: { ai?: boolean })`; `DealerSettings.plan?: string`.

This is the task the whole feature exists for. Read the spec's "The plan gate" section before starting.

- [ ] **Step 1: Write the failing test**

Create `lib/inbound/__tests__/planGate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findOrCreateConversation = vi.fn(async () => ({
  id: 'conv_1', transcript: [], wantsFinancing: false, pendingProposal: null,
}));
const recordTurn = vi.fn(async () => {});
const parseBuildingRequest = vi.fn(async () => {
  throw new Error('the model must not be called when the plan denies AI');
});

vi.mock('../conversation', async (orig) => ({
  ...(await orig<any>()),
  findOrCreateConversation,
  recordTurn,
}));
vi.mock('@/lib/ai/parseRequest', async (orig) => ({
  ...(await orig<any>()),
  parseBuildingRequest,
}));

const { handleInboundMessage } = await import('../handleInbound');
const { createDefaultConfig, DEFAULT_PRICING_RULES } = await import(
  '@/lib/building/defaultConfig'
);

const dealer = (plan: string) => ({
  id: 'dunrite', name: 'Dunrite', phone: '', email: '', website: '',
  theme: {}, showPricing: true, colorPalette: [], availableBuildingTypes: [],
  pricing: DEFAULT_PRICING_RULES, plan,
}) as any;

const msg = { channel: 'web' as const, externalId: 'web:dunrite:x', text: '24x30 garage' };

beforeEach(() => {
  findOrCreateConversation.mockClear();
  recordTurn.mockClear();
  parseBuildingRequest.mockClear();
});

describe('the plan gate', () => {
  it('does not call the model when ai is false', async () => {
    const result = await handleInboundMessage(dealer('none'), msg, { ai: false });
    expect(parseBuildingRequest).not.toHaveBeenCalled();
    expect(result.kind).toBe('handoff');
    expect(result.quoted).toBe(false);
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it('still records the conversation and the customer turn', async () => {
    await handleInboundMessage(dealer('none'), msg, { ai: false });
    expect(findOrCreateConversation).toHaveBeenCalledOnce();
    expect(recordTurn).toHaveBeenCalledOnce();
    // The customer's words are kept, so the dealer can read the lead.
    expect(recordTurn.mock.calls[0][1]).toContain('24x30 garage');
  });

  it('never mentions a price or the plan to the customer', async () => {
    const { reply } = await handleInboundMessage(dealer('none'), msg, { ai: false });
    expect(reply).not.toMatch(/\$|plan|subscription|upgrade/i);
  });

  it('defaults to running the model when no options are given', async () => {
    parseBuildingRequest.mockResolvedValueOnce({ building: {}, stated: [] } as any);
    await handleInboundMessage(dealer('pro'), msg).catch(() => {});
    expect(parseBuildingRequest).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/inbound/__tests__/planGate.test.ts`
Expected: FAIL — `handleInboundMessage` takes two arguments and calls the model regardless.

- [ ] **Step 3: Add `plan` to the dealer type and query**

In `lib/building/types.ts`, add to `interface DealerSettings`, after `policies`:

```ts
  /**
   * What this dealer is paying for. The label only; lib/plans.ts says what it
   * means. Optional because fixtures and tests build dealers without one, and
   * planAllows() denies an absent plan the same as an unknown one.
   */
  plan?: string;
```

In `lib/db/dealers.ts`, add `plan` to the `SELECT` in `getDealer` and to the returned object:

```ts
  const rows = await sql`
    SELECT id, name, phone, email, website, theme, pricing_rules, show_pricing,
           site, offers_rto, service_area, policies, plan
    FROM dealers WHERE id = ${id} AND active = true LIMIT 1
  ` as any[];
```

and in the returned object literal, alongside `policies`:

```ts
    plan: (r.plan as string) ?? 'none',
```

- [ ] **Step 4: Add the gate to `handleInboundMessage`**

In `lib/inbound/handleInbound.ts`, add the options type and the early branch. Place the branch immediately after the `findOrCreateConversation` call and the existing empty-text check, and **before** anything that reaches the model:

```ts
export interface InboundOptions {
  /**
   * Whether this dealer's plan pays for an AI answer. Default true.
   *
   * Enforced HERE, not at the send, because the Facebook webhook runs this
   * pipeline for every message and only decides afterwards whether to speak.
   * A gate on sending would keep an unpaid dealer silent while still spending
   * platform tokens on every message they receive.
   */
  ai?: boolean;
}

/**
 * What a customer hears when the dealer's plan does not include AI answers.
 *
 * Says nothing about plans, prices or why. The customer is not the one who
 * chose the plan, and "your dealer has not paid for this" is not their problem.
 * Their message IS kept and shows on the dealer's dashboard.
 */
const NO_AI_REPLY =
  "Thanks — we've got your message and someone will get back to you shortly.";
```

Then inside `handleInboundMessage`, change the signature and add the branch:

```ts
export async function handleInboundMessage(
  dealer: DealerSettings,
  msg: InboundMessage,
  opts: InboundOptions = {},
): Promise<InboundResult> {
  const text = (msg.text ?? '').trim();
  const conv = await findOrCreateConversation(
    dealer.id,
    msg.channel,
    msg.externalId,
    msg.contact ?? {},
  );

  if (!text) {
    return {
      kind: 'error',
      reply: 'Tell me roughly what you need — size, and whether you want it open or enclosed.',
      conversationId: conv.id,
      quoted: false,
    };
  }

  // The plan gate. Before the parser, before anything that costs money.
  if (opts.ai === false) {
    await recordTurn(conv.id, [...conv.transcript, text], 'no-ai-plan');
    return {
      kind: 'handoff',
      reply: NO_AI_REPLY,
      conversationId: conv.id,
      quoted: false,
    };
  }
```

The rest of the function is unchanged.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/inbound/__tests__/planGate.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the whole inbound suite**

Run: `npx vitest run lib/inbound`
Expected: PASS — the existing `handleInbound.test.ts` must be untouched by this change, since `opts` defaults to running the model.

- [ ] **Step 7: Commit**

```bash
git add lib/plans.ts lib/building/types.ts lib/db/dealers.ts lib/inbound/handleInbound.ts lib/inbound/__tests__/planGate.test.ts
git commit -m "Do not spend model tokens for a dealer whose plan does not include them"
```

---

### Task 12: Both channels pass the plan

**Files:**
- Modify: `app/api/inbound/web/route.ts`
- Modify: `app/api/webhooks/facebook/route.ts`
- Test: `app/api/inbound/web/__tests__/planGate.test.ts`

**Interfaces:**
- Consumes: `planAllows` from `lib/plans.ts`; `handleInboundMessage(dealer, msg, opts)` from Task 11.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Create `app/api/inbound/web/__tests__/planGate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const handleInboundMessage = vi.fn(async () => ({
  kind: 'handoff', reply: 'ok', conversationId: 'c1', quoted: false,
}));
const getDealer = vi.fn(async (id: string) => ({
  id, name: 'D', phone: '', email: '', website: '', theme: {},
  showPricing: true, colorPalette: [], availableBuildingTypes: [],
  pricing: {}, plan: 'none',
}));

vi.mock('@/lib/inbound/handleInbound', () => ({ handleInboundMessage }));
vi.mock('@/lib/db/dealers', () => ({ getDealer, DEFAULT_DEALER_ID: 'dunrite' }));

const { POST } = await import('../route');

let ip = 0;
const post = (body: any) =>
  new Request('http://x/api/inbound/web', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.2.0.${++ip % 250}-${ip}` },
  });

beforeEach(() => {
  handleInboundMessage.mockClear();
  getDealer.mockClear();
});

const optsFromLastCall = () => handleInboundMessage.mock.calls[0][2];

describe('the website form respects the dealer plan', () => {
  it('asks for no AI when the plan does not include it', async () => {
    await POST(post({ message: '24x30 garage' }) as any);
    expect(optsFromLastCall()).toEqual({ ai: false });
  });

  it('asks for AI on a pro plan', async () => {
    getDealer.mockResolvedValueOnce({
      id: 'dunrite', name: 'D', phone: '', email: '', website: '', theme: {},
      showPricing: true, colorPalette: [], availableBuildingTypes: [],
      pricing: {}, plan: 'pro',
    } as any);
    await POST(post({ message: '24x30 garage' }) as any);
    expect(optsFromLastCall()).toEqual({ ai: true });
  });

  // A dealer row predating the column, or one hand-edited to nonsense.
  it('denies AI when the dealer has no plan at all', async () => {
    getDealer.mockResolvedValueOnce({
      id: 'dunrite', name: 'D', phone: '', email: '', website: '', theme: {},
      showPricing: true, colorPalette: [], availableBuildingTypes: [], pricing: {},
    } as any);
    await POST(post({ message: '24x30 garage' }) as any);
    expect(optsFromLastCall()).toEqual({ ai: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/inbound/web/__tests__/planGate.test.ts`
Expected: FAIL — `handleInboundMessage` is called with two arguments, so `optsFromLastCall()` is `undefined`.

- [ ] **Step 3: Pass the plan from the web route**

In `app/api/inbound/web/route.ts`, add the import:

```ts
import { planAllows } from '@/lib/plans';
```

and change the `handleInboundMessage` call to:

```ts
    const result = await handleInboundMessage(
      dealer,
      { channel: 'web', externalId, text: message, contact },
      // The dealer's plan decides whether we think about this message at all.
      { ai: planAllows(dealer.plan, 'aiAutoReply') },
    );
```

- [ ] **Step 4: Pass the plan from the Facebook webhook**

In `app/api/webhooks/facebook/route.ts`, add the import:

```ts
import { planAllows } from '@/lib/plans';
```

and change the `handleInboundMessage` call to:

```ts
      const result = await handleInboundMessage(
        target.dealer,
        {
          channel: 'facebook',
          // Page-scoped and stable per user per page, so it keys the
          // conversation without storing anything identifying.
          externalId: msg.senderId,
          text: msg.text,
        },
        // Separate from target.autoReply, which is the dealer's own listen-only
        // switch and gates SENDING. This gates THINKING: a plan without AI must
        // not reach the model at all.
        { ai: planAllows(target.dealer.plan, 'aiAutoReply') },
      );
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/api/inbound/web/__tests__/planGate.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 7: Commit**

```bash
git add app/api/inbound/web/route.ts app/api/webhooks/facebook/route.ts app/api/inbound/web/__tests__/planGate.test.ts
git commit -m "Let each channel ask the plan before it spends a model call"
```

---

### Task 13: Super-admin approval and plan controls

**Files:**
- Create: `app/api/admin/dealers/route.ts`
- Modify: `lib/admin/data.ts` (add `plan` and `active` to `DealerRow`, and a pending list)
- Modify: `app/admin/page.tsx` (pending panel and plan control)
- Test: `app/api/admin/__tests__/dealers.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `lib/admin/guard.ts`; `setDealerPlan`, `setDealerActive` from `lib/db/dealerUsers.ts`; `isPlan` from `lib/plans.ts`.
- Produces: `POST /api/admin/dealers` taking `{ dealerId, plan?, active? }`.

- [ ] **Step 1: Write the failing test**

Create `app/api/admin/__tests__/dealers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAdmin = vi.fn(async () => 'info@dunritemetalbuildings.com');
const setDealerPlan = vi.fn(async () => {});
const setDealerActive = vi.fn(async () => {});

vi.mock('@/lib/admin/guard', () => ({ requireAdmin }));
vi.mock('@/lib/db/dealerUsers', () => ({ setDealerPlan, setDealerActive }));

const { POST } = await import('../dealers/route');

const post = (body: any) =>
  new Request('http://x/api/admin/dealers', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  requireAdmin.mockClear();
  setDealerPlan.mockClear();
  setDealerActive.mockClear();
  requireAdmin.mockResolvedValue('info@dunritemetalbuildings.com');
});

describe('POST /api/admin/dealers', () => {
  it('requires an admin before doing anything', async () => {
    requireAdmin.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    await expect(POST(post({ dealerId: 'd', plan: 'pro' }) as any)).rejects.toThrow();
    expect(setDealerPlan).not.toHaveBeenCalled();
  });

  it('sets a plan', async () => {
    const res = await POST(post({ dealerId: 'bob-buildings', plan: 'pro' }) as any);
    expect(res.status).toBe(200);
    expect(setDealerPlan).toHaveBeenCalledWith('bob-buildings', 'pro');
  });

  it('approves a dealer by activating them', async () => {
    await POST(post({ dealerId: 'bob-buildings', active: true, plan: 'starter' }) as any);
    expect(setDealerActive).toHaveBeenCalledWith('bob-buildings', true);
    expect(setDealerPlan).toHaveBeenCalledWith('bob-buildings', 'starter');
  });

  it('deactivates a dealer', async () => {
    await POST(post({ dealerId: 'bob-buildings', active: false }) as any);
    expect(setDealerActive).toHaveBeenCalledWith('bob-buildings', false);
  });

  // A plan the code does not know would deny every capability silently.
  it('rejects an unknown plan rather than writing it', async () => {
    const res = await POST(post({ dealerId: 'bob-buildings', plan: 'enterprise' }) as any);
    expect(res.status).toBe(400);
    expect(setDealerPlan).not.toHaveBeenCalled();
  });

  it('rejects a missing dealer id', async () => {
    const res = await POST(post({ plan: 'pro' }) as any);
    expect(res.status).toBe(400);
    expect(setDealerPlan).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/admin/__tests__/dealers.test.ts`
Expected: FAIL — cannot resolve `../dealers/route`.

- [ ] **Step 3: Write the route**

Create `app/api/admin/dealers/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/guard';
import { setDealerPlan, setDealerActive } from '@/lib/db/dealerUsers';
import { isPlan } from '@/lib/plans';

/**
 * Approve a dealer, change their plan, or switch them off.
 *
 * requireAdmin() FIRST, before the body is even read. An unknown plan is
 * REFUSED rather than written: planAllows() would deny every capability for it,
 * so a typo here would silently strip a paying dealer of what they bought.
 */
export async function POST(req: NextRequest) {
  await requireAdmin();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const dealerId = typeof body?.dealerId === 'string' ? body.dealerId.trim() : '';
  if (!dealerId) return NextResponse.json({ error: 'Missing dealerId' }, { status: 400 });

  if (body?.plan !== undefined && !isPlan(body.plan)) {
    return NextResponse.json({ error: `Unknown plan: ${body.plan}` }, { status: 400 });
  }

  try {
    if (typeof body?.active === 'boolean') await setDealerActive(dealerId, body.active);
    if (body?.plan !== undefined) await setDealerPlan(dealerId, body.plan);
  } catch (err) {
    console.error('[admin/dealers] update failed', err);
    return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/admin/__tests__/dealers.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Surface plan and pending status in the admin data layer**

In `lib/admin/data.ts`, add two fields to `DealerRow`:

```ts
export interface DealerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  plan: string;
  createdAt: string;
  quoteCount: number;
  lastQuoteAt: string | null;
}
```

and update `listDealers` to select and map them:

```ts
export async function listDealers(): Promise<DealerRow[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT d.id, d.name, d.email, d.phone, d.active, d.plan, d.created_at,
           COUNT(q.id)::int AS quote_count,
           MAX(q.created_at) AS last_quote_at
      FROM dealers d
      LEFT JOIN quotes q ON q.dealer_id = d.id
     GROUP BY d.id, d.name, d.email, d.phone, d.active, d.plan, d.created_at
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
    quoteCount: r.quote_count ?? 0,
    lastQuoteAt: r.last_quote_at ? new Date(r.last_quote_at).toISOString() : null,
  }));
}
```

- [ ] **Step 6: Add the admin controls to the page**

In `app/admin/page.tsx`, add a client component for the control and a pending panel.

Create `components/admin/DealerControls.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PLAN_IDS } from '@/lib/plans';

/**
 * Approve, re-plan or switch off one dealer.
 *
 * Client-side only because it posts and refreshes; the authority is the route,
 * which calls requireAdmin() before reading the body.
 */
export default function DealerControls({
  dealerId,
  plan,
  active,
}: {
  dealerId: string;
  plan: string;
  active: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function save(patch: { plan?: string; active?: boolean }) {
    setBusy(true);
    try {
      await fetch('/api/admin/dealers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealerId, ...patch }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label={`Plan for ${dealerId}`}
        value={PLAN_IDS.includes(plan as any) ? plan : 'none'}
        disabled={busy}
        onChange={e => save({ plan: e.target.value })}
        className="rounded border border-gray-300 px-1.5 py-1 text-xs"
      >
        {PLAN_IDS.map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <button
        disabled={busy}
        onClick={() => save({ active: !active })}
        className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
      >
        {active ? 'Deactivate' : 'Approve'}
      </button>
    </div>
  );
}
```

In `app/admin/page.tsx`, import it and add a pending panel above the Dealers panel, then add a control column to the existing Dealers table:

```tsx
import DealerControls from '@/components/admin/DealerControls';
```

```tsx
        {dealers.some(d => !d.active) && (
          <Panel title="Awaiting approval">
            <Table head={['Dealer', 'Contact', 'Signed up', 'Plan']}>
              {dealers.filter(d => !d.active).map(d => (
                <tr key={d.id} className="border-t border-gray-100">
                  <td className="py-2.5 pr-4">
                    <div className="font-medium text-gray-900">{d.name}</div>
                    <div className="text-xs text-gray-500">{d.id}</div>
                  </td>
                  <td className="py-2.5 pr-4 text-gray-600">{d.email || d.phone || '—'}</td>
                  <td className="py-2.5 pr-4 text-gray-600">{when(d.createdAt)}</td>
                  <td className="py-2.5">
                    <DealerControls dealerId={d.id} plan={d.plan} active={d.active} />
                  </td>
                </tr>
              ))}
            </Table>
          </Panel>
        )}
```

Change the Dealers table head to `['Dealer', 'Contact', 'Quotes', 'Last quote', 'Plan', 'Site']` and add a cell before the Site cell:

```tsx
                <td className="py-2.5 pr-4">
                  <DealerControls dealerId={d.id} plan={d.plan} active={d.active} />
                </td>
```

and update the two `Empty` `colSpan` values in that table from `5` to `6`.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add app/api/admin lib/admin/data.ts app/admin/page.tsx components/admin
git commit -m "Approve a dealer and set their plan from the admin dashboard"
```

---

### Task 14: End-to-end check and documentation

**Files:**
- Modify: `STEEL_SYNC_BUILD_PLAN.md` is NOT touched (it is a teardown report, not a status doc)
- Modify: `.env.local` is NOT committed; only note any new variable here
- Test: full suite

No new environment variables are introduced. Dealer auth reuses `ADMIN_SESSION_SECRET`, `ADMIN_ORIGIN`, `RESEND_API_KEY` and `LEAD_FROM_EMAIL`.

- [ ] **Step 1: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS, every file.

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds. `/dealer`, `/dealer/settings`, `/dealer/login` and `/dealer/signup` appear in the route list.

- [ ] **Step 3: Walk the flow by hand**

Start the dev server (`npm run dev`, port 3001) and confirm each of these:

1. `/dealer/signup` accepts a business name and email and says to check the inbox.
2. No new row exists yet: `SELECT count(*) FROM dealers WHERE id LIKE 'test%'` returns 0.
3. Opening the emailed link lands on `/dealer` and shows the awaiting-approval banner.
4. The new dealer's public site `/site/<id>` returns 404 while pending.
5. `/admin` lists the dealer under "Awaiting approval".
6. Approving with plan `pro` makes `/site/<id>` render.
7. `/dealer/settings` saves a service area, and it appears on `/site/<id>`.
8. Signing out and requesting a sign-in link at `/dealer/login` works.
9. Setting the plan to `none` in `/admin`, then submitting the site's quote form, returns the plain acknowledgement — and the message still appears on `/dealer`.

- [ ] **Step 4: Commit anything the walkthrough fixed**

```bash
git add -A
git commit -m "Fix what the first walkthrough of dealer signup turned up"
```

If the walkthrough found nothing, skip this step.

- [ ] **Step 5: Push**

```bash
git push
```

---

## Notes for the implementer

**Read before Task 2.** `lib/admin/auth.ts` is the only thing between the public internet and every dealer's pricing, leads and customer contact details. Its header comment explains why the super-admin allowlist lives in the environment. Do not move it into the database, and do not let a dealer token satisfy an admin check.

**The tenancy rule has no exceptions.** If you find yourself writing a route under `/dealer` or `/api/dealer` that reads a dealer id from a URL segment, a query string or a request body, stop — that is the bug this design exists to prevent.

**`auto_reply` and the plan are different things.** `auto_reply` is the dealer's own listen-only switch and gates *sending*. The plan gates *thinking* — whether the model runs at all. Do not merge them.
