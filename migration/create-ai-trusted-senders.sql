-- ai_trusted_senders: external addresses whose emails to aiassistant@ get auto-replies / deal intake (in addition to @firstmilecap.com). Applied 2026-09-16.
CREATE TABLE IF NOT EXISTS ai_trusted_senders (email TEXT PRIMARY KEY, note TEXT, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE ai_trusted_senders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_trusted_senders_all ON ai_trusted_senders;
CREATE POLICY ai_trusted_senders_all ON ai_trusted_senders FOR ALL USING (true) WITH CHECK (true);
INSERT INTO ai_trusted_senders (email, note) VALUES ('rchera@cacq.com','Ricky Chera — Crown Acquisitions alias'), ('src@cacq.com','Stanley Chera') ON CONFLICT DO NOTHING;
NOTIFY pgrst, 'reload schema'
