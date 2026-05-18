-- Extend market_research_markets to hold Census-derived data needed by the
-- Phase 1 seed pipeline (scripts/phase1_seed_us_towns.py).

ALTER TABLE market_research_markets
  ADD COLUMN IF NOT EXISTS latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS longitude NUMERIC,
  ADD COLUMN IF NOT EXISTS median_household_income INTEGER,
  ADD COLUMN IF NOT EXISTS median_home_value INTEGER,
  ADD COLUMN IF NOT EXISTS nearest_top50_city TEXT,
  ADD COLUMN IF NOT EXISTS miles_to_top50 NUMERIC,
  ADD COLUMN IF NOT EXISTS phase TEXT DEFAULT 'phase1',
  ADD COLUMN IF NOT EXISTS census_place_geoid TEXT;

CREATE INDEX IF NOT EXISTS idx_mr_markets_phase ON market_research_markets(phase);
CREATE INDEX IF NOT EXISTS idx_mr_markets_geoid ON market_research_markets(census_place_geoid);
