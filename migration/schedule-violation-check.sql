-- Violation Tracker daily sweep: 8 AM ET (12:00 UTC, same DST convention as task-reminders).
-- Auth: public anon key from Vault (`supabase_anon_key`), same as loan-memo-worker.
SELECT cron.schedule(
  'violation-check-daily',
  '0 12 * * *',
  $cron$
  select net.http_post(
    url := 'https://qrtleqasnhbnruodlgpt.supabase.co/functions/v1/violation-check',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_anon_key'),
      'Content-Type', 'application/json'),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 150000)
  $cron$
)
