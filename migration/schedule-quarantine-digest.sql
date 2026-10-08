-- ── Schedule quarantine-digest edge function via pg_cron ──────────────────
-- Weekly Check Point quarantine digest for Richard (rc@), cc Morris.
-- Mondays 8 AM ET. pg_cron runs in UTC, same convention as task-reminders
-- ('0 12 * * *' = 8 AM EDT / 7 AM EST — swap 12 for 13 in winter if that matters).
--
-- Same `app.settings.service_role_key` GUC pattern as the other cron jobs.
-- Visible on Manage > Scheduled Jobs.

SELECT cron.schedule(
  'quarantine-digest',
  '0 12 * * 1',   -- Mondays 12:00 UTC = 8 AM EDT
  $$
  SELECT net.http_post(
    url := 'https://qrtleqasnhbnruodlgpt.supabase.co/functions/v1/quarantine-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Dry run (returns the digest JSON/HTML, sends nothing):
--   curl -X POST $SUPABASE_URL/functions/v1/quarantine-digest \
--     -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
--     -d '{"dry_run":true,"days":14}'
--
-- To unschedule:   SELECT cron.unschedule('quarantine-digest');
