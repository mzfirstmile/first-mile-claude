-- ── Cash Forecast — planned capital events per property/month ─────────────
-- Feeds the Cash Forecast tab in Property Financials.
-- Outflows (TI/LC, capex, partner distributions) stored as NEGATIVE amounts.
-- Reserve draws are read from the existing `reserve_draws` table (not here).
-- Contractual rent/recoveries come from rent_roll; opex from budget_line_items;
-- debt service from exec_liabilities. This table only holds the manual-entry
-- capital events that don't live anywhere else.

CREATE TABLE IF NOT EXISTS cash_forecast_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   TEXT NOT NULL,
  year          INTEGER NOT NULL,
  month         INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  event_type    TEXT NOT NULL
                CHECK (event_type IN ('ti_lc', 'capex', 'distribution', 'contribution', 'reserve_draw', 'reserve_deposit', 'other')),
  amount        NUMERIC(14,2) NOT NULL,   -- negative = outflow, positive = inflow
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cfe_prop_year ON cash_forecast_events(property_id, year, month);

-- Track editable property-level cash position + minimum-reserve threshold.
-- Starting cash seeds the forecast. Morris can tweak these per property.
CREATE TABLE IF NOT EXISTS property_cash (
  property_id             TEXT PRIMARY KEY,
  operating_cash          NUMERIC(14,2) DEFAULT 0,
  reserve_cash            NUMERIC(14,2) DEFAULT 0,
  min_reserve_threshold   NUMERIC(14,2) DEFAULT 0,
  notes                   TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cash_forecast_events IS 'Planned capital events (TI/LC, capex, distributions) per property/month that feed the Cash Forecast tab.';
COMMENT ON TABLE property_cash IS 'Current property-level cash balances + min reserve threshold. Seeds the Cash Forecast.';
