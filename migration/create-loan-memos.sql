-- AI lending memos for Loan Opportunities leads (edge function `loan-memo`).
-- One row per property key (same key the Loan Opportunities tab aggregates on).
-- status: queued → running → done | error.  The tab queues its top-50 lending targets on load;
-- pg_cron job `loan-memo-worker` writes one memo every 2 minutes.

CREATE TABLE IF NOT EXISTS loan_memos (
  key            TEXT PRIMARY KEY,
  market_id      UUID,
  property_name  TEXT,
  status         TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','error')),
  priority       INTEGER NOT NULL DEFAULT 100,
  memo_html      TEXT,
  summary        TEXT,
  recommendation TEXT,
  sources        JSONB,
  model          TEXT,
  usage          JSONB,
  cost_usd       NUMERIC,
  data_as_of     DATE,
  error          TEXT,
  requested_by   TEXT,
  generated_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loan_memos_queue ON loan_memos (status, priority, updated_at);
ALTER TABLE loan_memos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loan_memos_all ON loan_memos;
CREATE POLICY loan_memos_all ON loan_memos FOR ALL USING (true) WITH CHECK (true);

-- The worker authenticates with the public anon key stored in Supabase Vault as 'supabase_anon_key'
-- (pg_cron here has no app.settings.service_role_key GUC). One-time setup, run where the key is at hand:
--   SELECT vault.create_secret('<anon key>', 'supabase_anon_key', 'Public anon key - used by pg_cron to call edge functions');
SELECT cron.schedule(
  'loan-memo-worker',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qrtleqasnhbnruodlgpt.supabase.co/functions/v1/loan-memo',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_anon_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"action":"work","limit":1}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
-- To pause:   SELECT cron.unschedule('loan-memo-worker');
