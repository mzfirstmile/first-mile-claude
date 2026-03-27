-- ============================================================
-- EMAIL INBOX TABLE  –  stores synced Graph API messages
-- ============================================================

CREATE TABLE IF NOT EXISTS emails (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  graph_id      TEXT UNIQUE NOT NULL,            -- Microsoft Graph message ID
  conversation_id TEXT,                          -- Graph conversation thread ID
  folder        TEXT DEFAULT 'inbox',            -- inbox / sentItems / drafts / archive
  from_address  TEXT NOT NULL,
  from_name     TEXT,
  to_addresses  JSONB DEFAULT '[]',              -- [{email, name}]
  cc_addresses  JSONB DEFAULT '[]',
  subject       TEXT,
  body_preview  TEXT,                            -- first ~255 chars
  body_html     TEXT,                            -- full HTML body
  body_text     TEXT,                            -- plain-text version
  has_attachments BOOLEAN DEFAULT FALSE,
  is_read       BOOLEAN DEFAULT FALSE,
  importance    TEXT DEFAULT 'normal',           -- low / normal / high
  categories    TEXT[] DEFAULT '{}',             -- Graph categories / custom tags
  ai_category   TEXT,                            -- AI-assigned triage category
  ai_summary    TEXT,                            -- AI-generated one-liner
  ai_priority   TEXT DEFAULT 'normal',           -- AI-assigned: low / normal / high / urgent
  received_at   TIMESTAMPTZ NOT NULL,
  sent_at       TIMESTAMPTZ,
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_emails_received   ON emails (received_at DESC);
CREATE INDEX idx_emails_folder     ON emails (folder);
CREATE INDEX idx_emails_from       ON emails (from_address);
CREATE INDEX idx_emails_unread     ON emails (is_read) WHERE is_read = FALSE;
CREATE INDEX idx_emails_ai_cat     ON emails (ai_category);
CREATE INDEX idx_emails_graph_id   ON emails (graph_id);
CREATE INDEX idx_emails_conv       ON emails (conversation_id);

-- Full-text search on subject + body
ALTER TABLE emails ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body_text, '')), 'B')
  ) STORED;
CREATE INDEX idx_emails_fts ON emails USING GIN (fts);

-- Enable RLS (anon key access scoped to authenticated app)
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON emails FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- SENT LOG  –  tracks outbound emails sent via the assistant
-- ============================================================

CREATE TABLE IF NOT EXISTS email_sent_log (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  graph_id    TEXT,                              -- Graph message ID after send
  to_addresses JSONB NOT NULL,
  cc_addresses JSONB DEFAULT '[]',
  subject     TEXT NOT NULL,
  body_html   TEXT,
  sent_by     TEXT,                              -- app user who triggered the send
  sent_at     TIMESTAMPTZ DEFAULT NOW()
);
