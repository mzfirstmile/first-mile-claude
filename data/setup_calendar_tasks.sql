-- ══════════════════════════════════════════════════════════════
-- Calendar Tasks — migrated from Airtable to Supabase
-- Run in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- Create calendar_tasks table
CREATE TABLE IF NOT EXISTS calendar_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  day_of_month INTEGER NOT NULL CHECK (day_of_month >= 1 AND day_of_month <= 31),
  cadence TEXT NOT NULL DEFAULT 'Monthly' CHECK (cadence IN ('Monthly', 'Quarterly', 'Annually')),
  property TEXT NOT NULL,
  payment_type TEXT DEFAULT '',
  description TEXT DEFAULT '',
  owner TEXT DEFAULT '',
  status TEXT DEFAULT '' CHECK (status IN ('', 'Done')),
  completed_by TEXT DEFAULT '',
  completed_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE calendar_tasks ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated + anon access (same pattern as other tables)
CREATE POLICY "Allow all access to calendar_tasks" ON calendar_tasks
  FOR ALL USING (true) WITH CHECK (true);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_calendar_tasks_property ON calendar_tasks(property);
CREATE INDEX IF NOT EXISTS idx_calendar_tasks_cadence ON calendar_tasks(cadence);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_calendar_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS set_calendar_tasks_updated_at ON calendar_tasks;
CREATE TRIGGER set_calendar_tasks_updated_at
  BEFORE UPDATE ON calendar_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_calendar_tasks_updated_at();
