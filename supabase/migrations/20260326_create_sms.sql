-- ============================================================
-- SMS MESSAGES TABLE  –  stores sent and received SMS via Twilio
-- ============================================================

CREATE TABLE IF NOT EXISTS sms_messages (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  twilio_sid    TEXT UNIQUE,                     -- Twilio message SID
  direction     TEXT NOT NULL DEFAULT 'outbound', -- inbound / outbound
  from_number   TEXT NOT NULL,
  to_number     TEXT NOT NULL,
  body          TEXT,
  status        TEXT DEFAULT 'sent',             -- sent / delivered / failed / received
  num_segments  INTEGER DEFAULT 1,
  ai_category   TEXT,                            -- AI-assigned category
  ai_summary    TEXT,                            -- AI-generated summary
  sent_by       TEXT,                            -- app user who triggered (for outbound)
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  received_at   TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_sms_direction  ON sms_messages (direction);
CREATE INDEX idx_sms_from       ON sms_messages (from_number);
CREATE INDEX idx_sms_to         ON sms_messages (to_number);
CREATE INDEX idx_sms_created    ON sms_messages (created_at DESC);
CREATE INDEX idx_sms_twilio_sid ON sms_messages (twilio_sid);

-- Full-text search on body
ALTER TABLE sms_messages ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(body, ''))
  ) STORED;
CREATE INDEX idx_sms_fts ON sms_messages USING GIN (fts);

-- RLS
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON sms_messages FOR ALL USING (true) WITH CHECK (true);
