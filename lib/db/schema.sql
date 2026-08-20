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
