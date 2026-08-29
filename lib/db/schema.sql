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
