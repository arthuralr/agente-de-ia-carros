-- Migration 002: Central da Revenda (RBAC, Atendimentos, Agenda, Trocas, Divulgação, Documentos, Auditoria)
-- Additive-only migration (safe for existing production Neon PostgreSQL databases).
-- Does NOT modify, truncate, or delete any existing vehicle, lead, chat, contract, user, or settings rows.

-- 1. Staff Roles & Individual Team Invites
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS role_code VARCHAR(32) NOT NULL DEFAULT 'administrador';

CREATE TABLE IF NOT EXISTS staff_invites (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(200) NOT NULL,
  role_code VARCHAR(32) NOT NULL DEFAULT 'vendedor',
  token_hash TEXT NOT NULL UNIQUE,
  invited_by_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  invited_by_name VARCHAR(150),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Chat Sessions Workflow, Concurrency Lock & Automation Control
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_user_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_human_reply_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS automation_mode VARCHAR(24) NOT NULL DEFAULT 'ai_active',
  ADD COLUMN IF NOT EXISTS stage VARCHAR(40) NOT NULL DEFAULT 'Novo Lead',
  ADD COLUMN IF NOT EXISTS loss_reason VARCHAR(160),
  ADD COLUMN IF NOT EXISTS focused_vehicle_id INTEGER,
  ADD COLUMN IF NOT EXISTS context_json TEXT,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- 3. Chat Messages Authorship & Channel Distinction
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS author_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_channel VARCHAR(32) DEFAULT 'chat';

-- 4. Staff Tasks & Follow-up Reminders
CREATE TABLE IF NOT EXISTS staff_tasks (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(120),
  lead_id INTEGER,
  vehicle_id INTEGER,
  assigned_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  assigned_user_name VARCHAR(150),
  title VARCHAR(200) NOT NULL,
  notes TEXT,
  due_at TIMESTAMPTZ,
  status VARCHAR(24) NOT NULL DEFAULT 'pendente',
  created_by_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(150),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_tasks_status_due ON staff_tasks (status, due_at);

-- 5. Visits & Test-Drives (Separating consultada / solicitada / confirmada)
CREATE TABLE IF NOT EXISTS visits (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(120),
  lead_id INTEGER,
  vehicle_id INTEGER,
  vehicle_label VARCHAR(200),
  customer_name VARCHAR(150),
  customer_phone VARCHAR(60),
  status VARCHAR(24) NOT NULL DEFAULT 'solicitada',
  scheduled_date VARCHAR(20),
  scheduled_time VARCHAR(20),
  assigned_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  assigned_user_name VARCHAR(150),
  notes TEXT,
  created_by_name VARCHAR(150),
  updated_by_name VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visits_status_date ON visits (status, scheduled_date);

-- 6. Trade-Ins (Trocas vinculadas ao atendimento)
CREATE TABLE IF NOT EXISTS trade_ins (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(120),
  lead_id INTEGER,
  target_vehicle_id INTEGER,
  customer_name VARCHAR(150),
  customer_phone VARCHAR(60),
  brand_model VARCHAR(160) NOT NULL,
  year_text VARCHAR(20),
  version_text VARCHAR(120),
  transmission VARCHAR(40),
  km INTEGER,
  color VARCHAR(40),
  plate VARCHAR(20),
  condition_notes TEXT,
  photos_json TEXT NOT NULL DEFAULT '[]',
  pending_items_json TEXT NOT NULL DEFAULT '[]',
  status VARCHAR(32) NOT NULL DEFAULT 'aguardando_fotos',
  approved_value NUMERIC(12, 2),
  evaluated_by_name VARCHAR(150),
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trade_ins_status ON trade_ins (status, updated_at DESC);

-- 7. Marketing Drafts (Divulgação sem consumo obrigatório de tokens)
CREATE TABLE IF NOT EXISTS marketing_drafts (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL,
  format VARCHAR(24) NOT NULL,
  title VARCHAR(200) NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  selected_photo_url TEXT,
  selected_photos_json TEXT NOT NULL DEFAULT '[]',
  template_config_json TEXT NOT NULL DEFAULT '{}',
  snapshot_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  snapshot_status VARCHAR(32) NOT NULL DEFAULT 'Disponível',
  public_sheet_url TEXT,
  tracking_source VARCHAR(80),
  created_by_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(150),
  updated_by_name VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_drafts_vehicle ON marketing_drafts (vehicle_id, updated_at DESC);

-- 8. Versioned Document Templates Library
CREATE TABLE IF NOT EXISTS document_templates (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(80) NOT NULL,
  name VARCHAR(180) NOT NULL,
  doc_type VARCHAR(48) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(24) NOT NULL DEFAULT 'ativo',
  is_example_template BOOLEAN NOT NULL DEFAULT false,
  allowed_roles_json TEXT NOT NULL DEFAULT '["vendedor","assistente","gestor","administrador"]',
  fields_schema_json TEXT NOT NULL DEFAULT '[]',
  conditional_rules_json TEXT NOT NULL DEFAULT '[]',
  body_template TEXT NOT NULL,
  created_by_name VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slug, version)
);

-- 9. Immutable Issued Documents (Idempotent + Historical Snapshot)
CREATE TABLE IF NOT EXISTS issued_documents (
  id SERIAL PRIMARY KEY,
  idempotency_key VARCHAR(120) UNIQUE,
  template_id INTEGER REFERENCES document_templates(id) ON DELETE SET NULL,
  template_slug VARCHAR(80) NOT NULL,
  template_name VARCHAR(180) NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  doc_type VARCHAR(48) NOT NULL,
  session_id VARCHAR(120),
  lead_id INTEGER,
  vehicle_id INTEGER,
  supersedes_document_id INTEGER REFERENCES issued_documents(id) ON DELETE SET NULL,
  issued_by_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  issued_by_name VARCHAR(150) NOT NULL,
  dealership_snapshot_json TEXT NOT NULL,
  vehicle_snapshot_json TEXT,
  values_json TEXT NOT NULL,
  calculated_totals_json TEXT NOT NULL DEFAULT '{}',
  rendered_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issued_documents_session ON issued_documents (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issued_documents_vehicle ON issued_documents (vehicle_id, created_at DESC);

-- 10. Staff Audit Logs
CREATE TABLE IF NOT EXISTS staff_audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  user_name VARCHAR(150),
  user_role VARCHAR(40),
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id VARCHAR(120),
  details_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_audit_created ON staff_audit_logs (created_at DESC);
