CREATE TABLE IF NOT EXISTS dealers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  website       TEXT,
  theme         JSONB NOT NULL DEFAULT '{}'::jsonb,
  pricing_rules JSONB NOT NULL,
  show_pricing  BOOLEAN NOT NULL DEFAULT true,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id          TEXT PRIMARY KEY,
  dealer_id   TEXT NOT NULL REFERENCES dealers(id),
  config      JSONB NOT NULL,
  pricing     JSONB,
  customer    JSONB NOT NULL,
  total_cents BIGINT,
  status      TEXT NOT NULL DEFAULT 'new',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotes_dealer_created_idx
  ON quotes (dealer_id, created_at DESC);

-- Inbound quote conversations.
--
-- Multi-turn is the whole point: a customer asks "price on 20x30", we ask
-- whether it is open or enclosed, and their one-word answer only means anything
-- next to the original request. `transcript` accumulates their side of the
-- conversation so a follow-up can be re-parsed as one complete message.
--
-- Keyed on (channel, external_id): a Facebook page-scoped sender id, or a
-- browser-supplied id for the website form. UNIQUE so a burst of webhook
-- retries for the same sender cannot fork into parallel threads.
CREATE TABLE IF NOT EXISTS conversations (
  id           TEXT PRIMARY KEY,
  dealer_id    TEXT NOT NULL REFERENCES dealers(id),
  channel      TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  transcript   JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_outcome TEXT,
  quote_id     TEXT REFERENCES quotes(id),
  contact      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS conversations_channel_external_idx
  ON conversations (channel, external_id);

CREATE INDEX IF NOT EXISTS conversations_dealer_updated_idx
  ON conversations (dealer_id, updated_at DESC);

-- Generated dealer website content.
--
-- Separate from `theme` (colours, logo) because this is COPY: headline,
-- tagline, about text, the service list. Kept as JSONB so the super-admin can
-- edit any field without a migration, and so a dealer with nothing set still
-- renders — lib/site/siteContent.ts fills every gap from the dealer's own name.
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS site JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Per-dealer messaging setup.
--
-- The webhook used a single FACEBOOK_DEALER_ID env var, which hard-wires the
-- whole platform to one dealer. Meta delivers the PAGE id on every event, so
-- the dealer can be resolved from the payload instead — which is what lets a
-- new dealer be messaging-ready the moment they are created.
--
-- facebook_page_token is a CREDENTIAL. It is stored encrypted (see
-- lib/admin/secretBox.ts. The column holds ciphertext, never a usable token.
-- UNIQUE on page id so two dealers cannot claim the same page and race for
-- whose pricing answers a customer.
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS facebook_page_id TEXT;
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS facebook_page_token TEXT;
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS auto_reply BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS dealers_facebook_page_idx
  ON dealers (facebook_page_id) WHERE facebook_page_id IS NOT NULL;

-- Whether this dealer offers rent-to-own.
-- We do NOT hold RTO pricing, so a quote only ever MENTIONS the option and
-- hands the customer to a human. Per dealer because not every dealer offers it,
-- and promising terms a dealer does not have is worse than staying quiet.
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS offers_rto BOOLEAN NOT NULL DEFAULT false;

-- Someone asked about rent-to-own before describing a building.
--
-- Remembered across turns so the answer can be "yes, what are you looking to
-- build?" rather than a dead handoff: the dealer is then notified once we have
-- an actual quote, so they call back knowing the size AND the price instead of
-- only that somebody, somewhere, asked about financing (owner, 2026-08-29).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS wants_financing BOOLEAN NOT NULL DEFAULT false;

-- What we last PROPOSED to this customer, so "that's fine" means something.
--
-- Only the customer's own turns are re-parsed, deliberately: feeding our
-- questions back lets the model read our suggestion as something they stated.
-- But when they ACCEPT a suggestion, it becomes exactly that -- and without
-- this the bot asked "what doors do you need?", was told "thats fine", and
-- asked again (owner, 2026-08-29).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_proposal JSONB;

-- Where this dealer delivers, in plain words.
--
-- Given to the model as a FACT so "do yall deliver to shreveport" gets an
-- answer instead of five questions about roof style. Free text rather than a
-- state list: dealers describe their area in their own terms, and the model is
-- reading it, not matching on it (owner, 2026-08-29).
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS service_area TEXT;

-- Free-text facts the model may answer FROM: warranty terms, site prep, and
-- whatever else a dealer wants it to be able to state without a person.
--
-- Deliberately prose rather than fields. These are things the model reads and
-- repeats, not values anything computes with, and a dealer adding a new policy
-- should not need a migration (owner, 2026-08-29).
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS policies TEXT;

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

-- NOT a statement, on purpose. On 2026-09-02 a one-off
-- `UPDATE dealers SET plan = 'pro' WHERE auto_reply = true AND plan = 'none'`
-- ran here to stop dealers who were already auto-replying going silent when
-- the plan gate shipped. It moved 1 dealer and is deliberately not kept.
--
-- This file is re-executed in full on every migration, and that statement is
-- not idempotent in the way it looks. 'none' is both the fresh default AND the
-- deliberate downgrade target, so a dealer the super-admin downgrades while
-- their auto_reply switch is still on would be silently restored to 'pro' on
-- the next migration and resume spending model tokens. Any future plan
-- backfill needs a marker that says "this already ran", not a WHERE clause on
-- a value an admin can legitimately set by hand.

-- When this dealer was approved.
--
-- `active` alone cannot say whether a switched-off dealer was ever approved.
-- It is false for a fresh signup nobody has looked at yet AND false for a
-- dealer the super-admin suspended, and those two must be treated differently:
-- a pending dealer may still sign in and see their own empty dashboard, a
-- suspended one must be locked out at once. Stamping the approval gives three
-- readable states -- pending is approved_at IS NULL, active is active = true,
-- suspended is active = false with approved_at set.
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Backfill the dealers who predate the column.
--
-- Every dealer already active was approved at some point and the nearest
-- honest timestamp on hand is when their row was created. Self-excluding, so
-- re-running the migration touches nothing.
UPDATE dealers SET approved_at = created_at WHERE active = true AND approved_at IS NULL;
