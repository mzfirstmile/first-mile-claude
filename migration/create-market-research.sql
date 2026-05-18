-- ============================================
-- Market Research Module — Schema
-- ============================================
-- Three tables:
--   1. market_research_criteria — defines the columns of the scorecard
--      (population growth, employment, supply, etc.). Editable via UI.
--   2. market_research_markets — one row per target market/city. Carries
--      a top-level Score (1-10) and Tier (1-4) alongside narrative fields.
--   3. market_research_scores — many-to-many: market × criterion → value
--      (numeric or text). Lets you add criteria without schema changes.
--
-- Visibility: gated by app_users.access_market_research.
-- ============================================

-- ── 1. Criteria definition ──
CREATE TABLE IF NOT EXISTS market_research_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  weight NUMERIC(5,2) NOT NULL DEFAULT 1,   -- relative weight for any future composite scoring
  value_type TEXT NOT NULL DEFAULT 'number' -- 'number' | 'percent' | 'rating_1_10' | 'rating_1_5' | 'text' | 'boolean' | 'currency'
    CHECK (value_type IN ('number','percent','rating_1_10','rating_1_5','text','boolean','currency')),
  source_note TEXT,        -- where this metric typically comes from (BLS, Census, CoStar, etc.)
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Markets ──
CREATE TABLE IF NOT EXISTS market_research_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                       -- e.g. "Phoenix, AZ" or "Tampa MSA"
  state TEXT,                               -- 2-letter state code
  msa TEXT,                                 -- MSA / CBSA designation (free text)
  population INT,                           -- optional headline metric (kept on markets for card display)
  status TEXT NOT NULL DEFAULT 'researching'
    CHECK (status IN ('researching','shortlisted','active_sourcing','on_hold','passed')),
  score NUMERIC(3,1)                        -- 1.0-10.0 (NULL = unscored)
    CHECK (score IS NULL OR (score >= 1 AND score <= 10)),
  tier INT                                  -- 1 (top) to 4 (bottom). NULL = un-tiered
    CHECK (tier IS NULL OR (tier >= 1 AND tier <= 4)),
  thesis TEXT,                              -- why we want to be here
  summary TEXT,                             -- exec one-pager
  notes TEXT,                               -- internal scratchpad
  external_links JSONB DEFAULT '[]'::jsonb, -- [{label, url}, ...]
  cover_image_url TEXT,
  created_by TEXT,                          -- email
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_research_markets_status ON market_research_markets (status);
CREATE INDEX IF NOT EXISTS idx_market_research_markets_tier ON market_research_markets (tier);
CREATE INDEX IF NOT EXISTS idx_market_research_markets_score ON market_research_markets (score DESC NULLS LAST);

-- ── 3. Per-market criterion values ──
CREATE TABLE IF NOT EXISTS market_research_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES market_research_markets(id) ON DELETE CASCADE,
  criterion_id UUID NOT NULL REFERENCES market_research_criteria(id) ON DELETE CASCADE,
  value_numeric NUMERIC,
  value_text TEXT,
  source TEXT,                              -- where this specific number came from
  notes TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market_id, criterion_id)
);

CREATE INDEX IF NOT EXISTS idx_market_research_scores_market ON market_research_scores (market_id);
CREATE INDEX IF NOT EXISTS idx_market_research_scores_criterion ON market_research_scores (criterion_id);

-- ── 4. updated_at triggers ──
CREATE OR REPLACE FUNCTION market_research_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mr_criteria_touch ON market_research_criteria;
CREATE TRIGGER trg_mr_criteria_touch BEFORE UPDATE ON market_research_criteria
  FOR EACH ROW EXECUTE FUNCTION market_research_touch();

DROP TRIGGER IF EXISTS trg_mr_markets_touch ON market_research_markets;
CREATE TRIGGER trg_mr_markets_touch BEFORE UPDATE ON market_research_markets
  FOR EACH ROW EXECUTE FUNCTION market_research_touch();

DROP TRIGGER IF EXISTS trg_mr_scores_touch ON market_research_scores;
CREATE TRIGGER trg_mr_scores_touch BEFORE UPDATE ON market_research_scores
  FOR EACH ROW EXECUTE FUNCTION market_research_touch();

-- ── 5. Per-user visibility column ──
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS access_market_research BOOLEAN NOT NULL DEFAULT false;

-- Grant access to the explicit list (Morris, Ricky, Toby, Rasheq, Ehud)
UPDATE app_users
SET access_market_research = true
WHERE email IN (
  'mz@firstmilecap.com',
  'rc@firstmilecap.com',
  'ty@firstmilecap.com',
  'rz@firstmilecap.com',
  'ek@firstmilecap.com'
);
