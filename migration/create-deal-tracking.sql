-- Deal Tracking: prospective deals submitted by email to aiassistant@ (or logged manually),
-- geocoded, matched to the nearest Market Research town, scored, and reported back.
CREATE TABLE IF NOT EXISTS deal_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  -- provenance
  source TEXT DEFAULT 'email',                 -- email | manual | chat
  source_email_id UUID,                         -- emails.id when from inbox
  submitted_by TEXT,                            -- sender email
  submitted_by_name TEXT,
  email_subject TEXT,
  raw_text TEXT,                                -- original body used for extraction
  -- deal facts (Claude-extracted)
  deal_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  asset_type TEXT,                              -- office | retail | multifamily | industrial | mixed_use | land | other
  deal_type TEXT,                               -- acquisition | note | recap | development | jv | other
  sf NUMERIC,
  units INTEGER,
  asking_price NUMERIC,
  price_psf NUMERIC,
  noi NUMERIC,
  cap_rate NUMERIC,                             -- percent, e.g. 6.5
  occupancy_pct NUMERIC,
  year_built INTEGER,
  broker TEXT,
  seller TEXT,
  key_tenants TEXT,
  extracted JSONB,                              -- full extraction payload
  -- market match (Market Research module)
  market_id UUID REFERENCES market_research_markets(id),
  market_name TEXT,
  market_distance_mi NUMERIC,
  market_score_res NUMERIC,
  market_tier_res INTEGER,
  market_rank_res INTEGER,
  market_score_office NUMERIC,
  market_tier_office INTEGER,
  market_rank_office INTEGER,
  scoring_view TEXT,                            -- 'office' | 'residential' — which view drove opportunity_score
  nearby_markets JSONB,                         -- [{id,name,state,miles,score,tier,office_score,office_tier}]
  category_scores JSONB,                        -- [{category,slug,weight,mean,criteria:[...]}]
  -- assessment
  opportunity_score NUMERIC,                    -- 0-10 (market composite in scoring_view)
  opportunity_tier INTEGER,
  recommendation TEXT,                          -- Pursue | Review | Pass
  assessment JSONB,                             -- {summary, strengths[], risks[], questions[]}
  report_html TEXT,
  replied_at TIMESTAMPTZ,
  -- workflow
  status TEXT DEFAULT 'new',                    -- new | reviewing | pursuing | passed | stale
  initiative_id UUID,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_deal_tracking_created ON deal_tracking(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_tracking_status ON deal_tracking(status);
CREATE INDEX IF NOT EXISTS idx_deal_tracking_market ON deal_tracking(market_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_tracking_source_email ON deal_tracking(source_email_id); -- plain (not partial): PostgREST upsert ON CONFLICT cannot target a partial index; NULLs are distinct
ALTER TABLE deal_tracking ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_tracking_all ON deal_tracking;
CREATE POLICY deal_tracking_all ON deal_tracking FOR ALL USING (true) WITH CHECK (true);
