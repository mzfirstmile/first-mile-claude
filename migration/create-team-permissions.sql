-- Team permission sets (2026-11-11). One row per team; access_* columns mirror app_users.
-- Manage Users → Teams table edits these; the UI then pushes the change onto each non-admin
-- member's own app_users.access_* columns (union across the member's teams), which is what the
-- app enforces. "Users" (manage users) is deliberately not a team permission — grant it per user.
CREATE TABLE IF NOT EXISTS app_team_permissions (
  team TEXT PRIMARY KEY,
  sort INT DEFAULT 0,
  access_calendar BOOLEAN DEFAULT false,
  access_financials BOOLEAN DEFAULT false,
  access_exec BOOLEAN DEFAULT false,
  access_forecasting BOOLEAN DEFAULT false,
  access_properties BOOLEAN DEFAULT false,
  access_market_research BOOLEAN DEFAULT false,
  access_initiatives BOOLEAN DEFAULT false,
  access_deal_tracking BOOLEAN DEFAULT false,
  access_violation_tracker BOOLEAN DEFAULT false,
  access_rasheq BOOLEAN DEFAULT false,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE app_team_permissions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_team_permissions' AND policyname='Allow all access via anon key') THEN
    CREATE POLICY "Allow all access via anon key" ON app_team_permissions FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;
GRANT ALL ON app_team_permissions TO anon, authenticated, service_role;

-- Seed: each team gets the modules ALL of its current non-admin members already have
-- (so creating the table changes nobody's access).
INSERT INTO app_team_permissions (team, sort, access_calendar, access_financials, access_exec, access_forecasting, access_properties,
  access_market_research, access_initiatives, access_deal_tracking, access_violation_tracker, access_rasheq, updated_by)
SELECT t.team, t.sort,
  COALESCE(bool_and(u.access_calendar), false), COALESCE(bool_and(u.access_financials), false), COALESCE(bool_and(u.access_exec), false),
  COALESCE(bool_and(u.access_forecasting), false), COALESCE(bool_and(u.access_properties), false), COALESCE(bool_and(u.access_market_research), false),
  COALESCE(bool_and(u.access_initiatives), false), COALESCE(bool_and(u.access_deal_tracking), false), COALESCE(bool_and(u.access_violation_tracker), false),
  COALESCE(bool_and(u.access_rasheq), false), 'seed'
FROM (VALUES ('Executive',1),('Accounting',2),('Operations',3),('Administrative',4)) t(team, sort)
LEFT JOIN app_users u ON (',' || replace(COALESCE(u.team,''), ' ', '') || ',') LIKE ('%,' || t.team || ',%') AND NOT COALESCE(u.is_admin, false)
GROUP BY t.team, t.sort
ON CONFLICT (team) DO NOTHING;
