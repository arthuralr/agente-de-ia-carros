-- Migration 001: FIPE Reference Month & Centralized Dealership Configuration
-- Additive-only migration (safe for existing production Neon PostgreSQL databases).
-- Does NOT modify or delete any existing vehicle, lead, chat, or settings rows.

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS fipe_reference_month VARCHAR(64);

CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Note:
-- Centralized dealership configuration is stored in app_settings under key = 'dealership_config' (JSON).
-- The legacy key 'store_whatsapp_number' is preserved and kept synchronized with the primary sales WhatsApp.
-- Existing vehicle records with conflicting transmission fields or missing FIPE values are NOT auto-mutated;
-- they are flagged for human review in the Admin Inventory panel.
