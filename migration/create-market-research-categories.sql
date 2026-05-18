-- Create market_research_categories — the 6 high-level groups carrying weights
CREATE TABLE IF NOT EXISTS market_research_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  weight NUMERIC NOT NULL DEFAULT 1.00 CHECK (weight >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the 6 categories (idempotent via slug)
INSERT INTO market_research_categories (slug, name, description, sort_order, weight) VALUES
  ('demographics',        'Demographics',                       'Income, home prices, population profile.', 100, 1.00),
  ('governance',          'Governance & Barriers to Entry',     'Zoning, building limits, civic engagement.', 200, 1.00),
  ('economic_activity',   'Economic Activity',                  'Company HQs, executive concentration, jet access.', 300, 1.00),
  ('education',           'Education',                          'School rankings, graduation rates, degree attainment.', 400, 1.00),
  ('quality_of_life',     'Quality of Life',                    'Safety, parks, culture, recreation.', 500, 1.00),
  ('transit',             'Transit & Access',                   'Commute times, rail access.', 600, 1.00)
ON CONFLICT (slug) DO NOTHING;

-- Add FK to criteria + backfill from text column
ALTER TABLE market_research_criteria
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES market_research_categories(id);

UPDATE market_research_criteria c
SET category_id = cat.id
FROM market_research_categories cat
WHERE c.category = cat.slug AND c.category_id IS NULL;

-- Index for quick lookups by category
CREATE INDEX IF NOT EXISTS idx_mr_criteria_category_id ON market_research_criteria(category_id);
