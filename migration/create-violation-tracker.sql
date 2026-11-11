-- Violation Tracker (2026-11-11)
-- Daily check of NYC agency open data (DOB BIS, DOB ECB, DOB NOW, OATH, FDNY-via-OATH)
-- for open violations on our properties. Written by edge function `violation-check`,
-- read by violation-tracker.js. Applied to prod via exec_sql.

CREATE TABLE IF NOT EXISTS violation_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  borough TEXT,                       -- Manhattan | Bronx | Brooklyn | Queens | Staten Island (NULL outside NYC)
  block TEXT,
  lot TEXT,
  bbl TEXT,                           -- 10-digit borough+block+lot (tax/billing lot)
  bin TEXT,                           -- DOB building identification number
  alt_bbls TEXT[] DEFAULT '{}',       -- extra lots (condo base lot, multi-lot sites) matched in OATH
  alt_bins TEXT[] DEFAULT '{}',       -- extra buildings on the site
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  nyc_covered BOOLEAN NOT NULL DEFAULT true,   -- false = outside NYC, these sources don't apply
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  -- summary written by violation-check after each run
  health TEXT,                        -- green | amber | red | na
  open_count INT DEFAULT 0,
  open_by_source JSONB DEFAULT '{}'::jsonb,
  balance_due NUMERIC DEFAULT 0,
  next_hearing DATE,
  hazardous_open INT DEFAULT 0,
  last_checked_at TIMESTAMPTZ,
  last_check_error TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_violation_properties_active ON violation_properties(active);

CREATE TABLE IF NOT EXISTS violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_property_id UUID NOT NULL REFERENCES violation_properties(id) ON DELETE CASCADE,
  source TEXT NOT NULL,               -- dob_bis | dob_ecb | dob_now | oath | fdny
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  source_status TEXT,                 -- agency's own status text
  issue_date DATE,
  violation_type TEXT,
  description TEXT,
  class_severity TEXT,
  is_hazardous BOOLEAN DEFAULT false,
  penalty NUMERIC,
  balance_due NUMERIC,
  hearing_date DATE,
  hearing_status TEXT,
  issuing_agency TEXT,
  bin TEXT,
  bbl TEXT,
  agency_url TEXT,
  raw JSONB,
  first_seen TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_violations_source UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_violations_prop_status ON violations(violation_property_id, status);

CREATE TABLE IF NOT EXISTS violation_check_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  trigger TEXT,                       -- cron | manual | api
  property_ids UUID[],
  properties_checked INT DEFAULT 0,
  records_seen INT DEFAULT 0,
  new_open INT DEFAULT 0,
  newly_closed INT DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb,
  summary JSONB,
  ok BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_violation_check_runs_started ON violation_check_runs(started_at DESC);

ALTER TABLE violation_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE violation_check_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='violation_properties' AND policyname='violation_properties_all') THEN
    CREATE POLICY violation_properties_all ON violation_properties FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='violations' AND policyname='violations_all') THEN
    CREATE POLICY violations_all ON violations FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='violation_check_runs' AND policyname='violation_check_runs_all') THEN
    CREATE POLICY violation_check_runs_all ON violation_check_runs FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;
GRANT ALL ON violation_properties, violations, violation_check_runs TO anon, authenticated, service_role;
