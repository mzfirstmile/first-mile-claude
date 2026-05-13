-- Capex projects: each Base Bldg line item is a project. Allows the
-- Cash Forecast's Base Bldg row to expand into a per-project breakdown.

CREATE TABLE IF NOT EXISTS capex_projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 100,
  notes       TEXT,
  status      TEXT DEFAULT 'active',  -- 'active' | 'deferred' | 'completed'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capex_projects_property ON capex_projects(property_id);

-- Allow cash_forecast_events to reference a capex_project so monthly
-- amounts roll up to project totals.
ALTER TABLE cash_forecast_events
  ADD COLUMN IF NOT EXISTS project_id UUID;
CREATE INDEX IF NOT EXISTS idx_cfe_project ON cash_forecast_events(project_id);
