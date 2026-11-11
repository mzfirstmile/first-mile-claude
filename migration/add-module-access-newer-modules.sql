-- Per-user access toggles for the modules added after the original access_* set (2026-11-11).
-- Default TRUE so every existing user keeps the access they have today (these modules were
-- visible to everyone); admins turn them off per user in Manage Users.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS access_initiatives BOOLEAN DEFAULT true;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS access_deal_tracking BOOLEAN DEFAULT true;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS access_violation_tracker BOOLEAN DEFAULT true;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS access_rasheq BOOLEAN DEFAULT true;
-- (ADD COLUMN ... DEFAULT true backfills existing rows; no UPDATE needed)
