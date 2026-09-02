# Dealer accounts and plan gating — design

Date: 2026-09-02

## Problem

Dealers exist only as rows created by `npm run dealer:add` from a laptop. There
is no signup, no dealer login, and no notion of what a dealer is paying for. The
only account in the system is the super-admin, whose allowlist lives in
`SUPER_ADMIN_EMAILS`.

Two things are wanted:

1. A dealer can create their own account.
2. The super-admin can gate what a dealer's account may do, based on their
   subscription.

## Scope

In scope:

- Dealer self-signup, email-verified, producing a dealer that is inert until
  approved.
- Dealer login and a dealer dashboard: their own quotes and conversations, and
  their own settings.
- A `plan` on each dealer, set by the super-admin, gating exactly one
  capability today: AI auto-reply, on both the Facebook channel and the
  website form.
- Super-admin surfaces to approve a signup, set a plan, and deactivate.

Out of scope, deliberately:

- **Payment processing.** No card is taken and no provider is wired. The
  super-admin sets `plan` by hand. The model is shaped so that a billing
  integration can later write to `plan` without any downstream change.
- **Customer accounts.** Building buyers stay anonymous; they request quotes.
- **Dealer-editable pricing.** `pricing_rules` is the platform's margin and is
  complex JSONB needing a real editor. Dealers do not touch it in this work.
- **Inviting teammates.** The schema permits several logins per dealer; the UI
  exposes one. Adding invites later is a form and an insert, not a migration.
- **Per-plan quote caps, channel gating, or branding tiers.** Only AI auto-reply
  differs by plan. More capabilities are a line each when there is something to
  sell.

## Trust model

The super-admin is unchanged. `SUPER_ADMIN_EMAILS` remains the sole source of
super-admin, in the environment, for the reason `lib/admin/auth.ts` already
states: an allowlist in the database means anyone who reaches the admin surface
once can add themselves permanently and quietly.

Dealer identity is a second, weaker identity that can never become the first:

- Dealer sessions reuse the existing HMAC token machinery with new `kind`
  values, `'dealer'` and `'signup'`, and carry `{ dealerId, email }`.
- `decode()` already rejects any token whose `kind` differs from the one the
  caller asked for, so a dealer token handed to `requireAdmin()` fails without
  any new code deciding that.
- A separate cookie name (`steelsync_dealer`) so the two sessions can coexist:
  the super-admin can be signed in as themselves while viewing a dealer's page.

### The one departure from the existing design

Admin tokens are fully stateless because the environment allowlist is re-checked
on every use. A dealer has no environment allowlist, so `requireDealer()` reads
the database on each request to confirm the dealer still exists, is still
`active`, and that the email is still attached to it.

That is a query per request. It buys immediate revocation: deactivating a dealer
locks them out now rather than up to seven days from now, when their session
would otherwise expire. Dealer pages query the database anyway.

### The dangerous edit

`decode()` currently re-checks `isAllowedAdmin(body.email)` for every token kind.
That check must remain **unconditional** for `'magic'` and `'session'`, and must
not apply to `'dealer'` or `'signup'`. Getting this wrong in the permissive
direction is an admin bypass.

It is therefore expressed as an explicit per-kind rule rather than an early
return, and carries a regression test asserting that an admin token issued to an
address since removed from `SUPER_ADMIN_EMAILS` still fails.

## Data model

```sql
-- Login identities, kept separate from dealers.email.
--
-- dealers.email is a NOTIFICATION address: it is where quote alerts go.
-- Conflating it with a login identity means that changing where alerts are sent
-- silently changes who can sign in.
CREATE TABLE IF NOT EXISTS dealer_users (
  email      TEXT PRIMARY KEY,
  dealer_id  TEXT NOT NULL REFERENCES dealers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dealer_users_dealer_idx ON dealer_users (dealer_id);

-- What this dealer is paying for. One text column, not a table: the plan is a
-- label, and the capabilities it implies live in code where they can be read
-- next to the gate that enforces them.
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'none';
```

Emails are stored lowercased. `PRIMARY KEY` on email means one address belongs to
one dealer; the same person cannot hold accounts at two dealers, which is the
right default and avoids a "which dealer am I acting as" selector.

### A pending signup is inert by construction

A verified signup — one where the emailed link has been clicked — creates a
`dealers` row with `active = false`.

`active` is *already* the kill switch on every dealer-facing path:
`getDealer()` filters `active = true`, so the public site 404s, and
`dealerForPage()` filters it too, so Facebook will not route to them. A pending
dealer is therefore dark everywhere without a single new "is this dealer
approved" check that some future path could forget.

They can sign in and see their own empty dashboard. That is all, until the
super-admin approves them.

## Signup and login flow

Signup does **not** create the dealer row.

1. `POST /api/dealer/signup` — business name, email, phone. Rate-limited via
   `lib/rateLimit.ts`, for the same reason `/api/quote` is: an unauthenticated
   endpoint that writes and sends email is an open door.
2. The endpoint validates, then emails a magic link whose signed token carries
   the signup payload (`kind: 'signup'`).
3. Clicking the link creates the `dealers` row (`active = false`,
   `plan = 'none'`), the `dealer_users` row, and a dealer session.

The rows are created only when a real mailbox has proven itself.

**Why not write the row immediately.** `dealers.id` is the public URL
(`/site/dunrite`). Immediate writes let anyone squat a competitor's slug and
fill the table with junk from addresses that do not exist. Proving the mailbox
first costs one extra token kind and no new table.

**Slug allocation.** The dealer id is slugified from the business name at
creation time, and a collision appends a short suffix. It is resolved on the
callback, not at form time, so two people signing up simultaneously cannot both
be told they have the same id.

**Login** is the existing magic-link flow pointed at `dealer_users` instead of
the environment allowlist: `POST /api/dealer/login` with an email, and a link
that exchanges for a dealer session. An address with no `dealer_users` row gets
the same response as one that does — never reveal whether an account exists.

## Dealer dashboard (`/dealer`)

Their own quotes and conversations, and settings they may edit: contact details,
website, service area, policies, rent-to-own, branding and site copy.

**The cross-tenant rule.** `dealerId` comes from the session token, never from a
URL or request body. Every dealer-scoped query takes it as an argument, and no
`/dealer/[id]` route exists to tamper with.

Not dealer-editable: `pricing_rules`, `plan`, `active`, and the Facebook page
credential.

## The plan gate

`lib/plans.ts`:

```ts
const PLANS = {
  none:    { aiAutoReply: false },
  starter: { aiAutoReply: false },
  pro:     { aiAutoReply: true  },
};

export function planAllows(plan: string, capability: Capability): boolean;
```

An unknown plan string denies everything. A typo in the database must not grant
a capability.

`starter` and `none` grant the same capabilities today, which is intentional
rather than an oversight: they are different *billing* states — `none` is
unapproved or lapsed, `starter` is a paying dealer without AI — and only `pro`
differs in what it can do. Keeping the distinction now means a future paid
capability has a tier to land on without a data migration.

The gate is enforced in **one** place: `handleInboundMessage()` in
`lib/inbound/handleInbound.ts`, before any model call.

That file already owns the rule about when a price may go out, and every channel
passes through it. `handleInboundMessage` takes a third argument,
`opts?: { ai?: boolean }`, defaulting to `true`. When `ai` is `false` it finds or
creates the conversation, records the customer's turn, and returns a
`kind: 'handoff'` acknowledgement — without calling the model.

Both channels pass `planAllows(dealer.plan, 'aiAutoReply')`, which means `plan`
must be selected by `getDealer()` and carried on `DealerSettings`.

**Why not `dealerForPage()`, as an earlier draft of this spec said.** The
Facebook webhook calls `handleInboundMessage` unconditionally and `auto_reply`
gates only *sending*, inside `sendFacebookReply`. Gating the flag there would
keep an unpaid dealer silent while still spending platform tokens on every
message they receive — which is the entire cost this is meant to stop. The gate
must sit before the model call, not before the send.

**`auto_reply` and the plan gate stay separate concerns.** `auto_reply` is the
dealer's own switch and keeps its listen-only meaning: process the message, log
what the bot would have said, do not speak. The plan gate is stronger — it
declines to think at all. A paying dealer can still run listen-only; a
free-plan dealer costs nothing.

The customer's message is never dropped. It is recorded on the conversation and
appears on the dealer's dashboard and in `/admin`; only the *generated answer*
is withheld. No new per-message notification is sent — inbound has never
notified per message, and adding one here would be noise nobody asked for.

## Super-admin controls

`/admin` gains:

- A **Pending signups** panel listing dealers with `active = false`, with
  Approve, which sets `active = true` and a chosen plan.
- A plan dropdown on each dealer row.
- Deactivate.

All behind `requireAdmin`, all POST routes under `/api/admin/dealers/`. Because
`requireDealer()` re-reads the database, a deactivation takes effect on the
dealer's next request.

## Testing

Test-driven throughout. The tests that carry real weight:

**Privilege separation**
- A dealer session token is rejected by `requireAdmin()`.
- An admin session token is rejected by `requireDealer()`.
- A `signup` token cannot be used as a session, and a `dealer` token cannot be
  used as a magic link.
- After the `decode()` edit, an admin token for an address removed from
  `SUPER_ADMIN_EMAILS` still fails.

**Tenancy**
- A dealer's quote and conversation queries never return another dealer's rows.
- No dealer route accepts a dealer id from the request.

**The gate**
- `auto_reply = true` with `plan = 'none'` sends the plain acknowledgement, not
  a generated answer. The two switches compose rather than override: the plan
  decides what is said, `auto_reply` decides whether anything is said at all.
- The website form returns a plain acknowledgement, not a quote, on a plan
  without AI — and still records the conversation and the customer's turn.
- No model call is made at all when the plan denies AI, on either channel.
- An unknown plan string denies the capability.

**Signup**
- No rows exist until the emailed link is clicked.
- A colliding business name produces a distinct dealer id.
- Login for an unknown email is indistinguishable from login for a known one.

**Pending state**
- A pending dealer's public site 404s.
- Facebook will not route to a pending dealer.

## Migration and rollout

`plan` defaults to `'none'`, which denies AI auto-reply. Existing dealers running
with `auto_reply = true` would go silent on deploy. The migration therefore sets
`plan = 'pro'` for any dealer that currently has `auto_reply = true`, preserving
today's behaviour exactly. New signups default to `'none'`.
