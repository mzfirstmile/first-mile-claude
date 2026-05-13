-- Add bs_code column to cash_forecast_events so reserve draws + deposits
-- can be associated with a specific balance_sheet_items reserve account.
-- Enables the per-account Reserve Draw rows in the Capital Plan grid.

ALTER TABLE cash_forecast_events
  ADD COLUMN IF NOT EXISTS bs_code TEXT;

CREATE INDEX IF NOT EXISTS idx_cfe_bs_code ON cash_forecast_events(bs_code);
