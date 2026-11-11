-- 2026-11-11 (Morris): new Construction team — Violation Tracker + General First Mile only.
-- General First Mile (the module formerly called "Rasheq", access_rasheq) is on for everyone.
INSERT INTO app_team_permissions (team, sort, access_calendar, access_financials, access_exec, access_forecasting,
  access_properties, access_market_research, access_initiatives, access_deal_tracking, access_violation_tracker,
  access_rasheq, updated_by)
VALUES ('Construction', 5, false, false, false, false, false, false, false, false, true, true, 'mz@firstmilecap.com')
ON CONFLICT (team) DO NOTHING;
UPDATE app_team_permissions SET access_rasheq = true WHERE access_rasheq IS DISTINCT FROM true;
UPDATE app_users SET access_rasheq = true WHERE access_rasheq IS DISTINCT FROM true;
-- Peter Lombado: Construction only
UPDATE app_users SET team = 'Construction', access_calendar = false, access_financials = false, access_exec = false,
  access_forecasting = false, access_properties = false, access_market_research = false, access_initiatives = false,
  access_deal_tracking = false, access_violation_tracker = true, access_rasheq = true
WHERE email = 'plompado@crtl.com';
