-- Violation Tracker: NJ / CT + federal sources (2026-11-11)
-- Adds location + matching fields so violation-check can query EPA ECHO (all properties),
-- NJDEP + NJ DCA construction permits (NJ) and CT DEEP (CT) in addition to the NYC sources.
ALTER TABLE violation_properties ADD COLUMN IF NOT EXISTS state TEXT;            -- NY | NJ | CT
ALTER TABLE violation_properties ADD COLUMN IF NOT EXISTS municipality TEXT;     -- tax municipality (NJ MOD-IV name, e.g. 'MORRIS TWP', 'MIDDLETOWN TWP'; CT town)
ALTER TABLE violation_properties ADD COLUMN IF NOT EXISTS county TEXT;
ALTER TABLE violation_properties ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE violation_properties ADD COLUMN IF NOT EXISTS longitude NUMERIC;
ALTER TABLE violation_properties ADD COLUMN IF NOT EXISTS lots TEXT[] DEFAULT '{}';            -- NJ 'block/lot' list in `municipality`
ALTER TABLE violation_properties ADD COLUMN IF NOT EXISTS match_addresses TEXT[] DEFAULT '{}'; -- street addresses used to match agency records (aliases incl.)
ALTER TABLE violations ADD COLUMN IF NOT EXISTS info_only BOOLEAN DEFAULT false;              -- shown, never counted in health (e.g. open construction permits)

ALTER TABLE violation_properties ADD COLUMN IF NOT EXISTS muni_code TEXT;   -- NJ treasury/MOD-IV municipal code (PAMS_PIN prefix), e.g. 1422 Morris Twp
ALTER TABLE violation_properties ADD COLUMN IF NOT EXISTS info_open INT DEFAULT 0;              -- open info_only rows (open permits)
ALTER TABLE violation_properties ADD COLUMN IF NOT EXISTS sources_checked TEXT[] DEFAULT '{}';  -- sources that answered on the last run
