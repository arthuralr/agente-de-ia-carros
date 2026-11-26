-- 003_external_storefront_widget_security.sql
-- Additive-only migration for:
-- 1. Immediate session revocation (`token_version`) on `admin_users`
-- 2. Server-only external inventory source configuration (`external_inventory_sources`)
-- 3. Normalized external dealership vehicles (`external_vehicles`)

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS external_inventory_sources (
  store_slug VARCHAR(120) PRIMARY KEY,
  source_type VARCHAR(40) NOT NULL DEFAULT 'json_feed',
  feed_url TEXT,
  auth_header_name VARCHAR(120),
  auth_header_value TEXT,
  sync_interval_minutes INTEGER NOT NULL DEFAULT 30,
  public_link_status VARCHAR(40) NOT NULL DEFAULT 'unverified',
  public_link_checked_at TIMESTAMPTZ,
  public_link_detail TEXT,
  connection_status VARCHAR(40) NOT NULL DEFAULT 'not_configured',
  last_sync_attempt_at TIMESTAMPTZ,
  last_sync_success_at TIMESTAMPTZ,
  last_sync_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS external_vehicles (
  id SERIAL PRIMARY KEY,
  store_slug VARCHAR(120) NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  brand VARCHAR(120) NOT NULL DEFAULT '',
  model VARCHAR(180) NOT NULL DEFAULT '',
  version VARCHAR(200) NOT NULL DEFAULT '',
  year VARCHAR(30) NOT NULL DEFAULT '',
  km INTEGER NOT NULL DEFAULT 0,
  price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  price_confirmed BOOLEAN NOT NULL DEFAULT true,
  transmission VARCHAR(80) NOT NULL DEFAULT '',
  fuel VARCHAR(80) NOT NULL DEFAULT '',
  color VARCHAR(80) NOT NULL DEFAULT '',
  status VARCHAR(40) NOT NULL DEFAULT 'Disponível',
  availability_confirmed BOOLEAN NOT NULL DEFAULT true,
  image_url TEXT NOT NULL DEFAULT '',
  gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
  official_url TEXT,
  optionals JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_fingerprint VARCHAR(128),
  source_updated_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_slug, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_vehicles_store_status
  ON external_vehicles (store_slug, status);

CREATE INDEX IF NOT EXISTS idx_external_vehicles_store_url
  ON external_vehicles (store_slug, official_url);
