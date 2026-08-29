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
