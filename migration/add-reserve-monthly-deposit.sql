-- Per-reserve-account monthly deposit amounts (drives Cash Forecast).
-- Each escrow account on a property's balance sheet can carry a fixed
-- monthly amount that gets transferred FROM operating cash INTO that
-- reserve account per the loan/PMA terms.

ALTER TABLE balance_sheet_items
  ADD COLUMN IF NOT EXISTS monthly_deposit NUMERIC DEFAULT 0;

-- Seed 61 South Paramus (per Morris's PMA terms)
UPDATE balance_sheet_items
  SET monthly_deposit = 29323
  WHERE property_id = 'recqfxJfdqCXCLOuD' AND bs_code = '1121';  -- TI & Leasing reserve

UPDATE balance_sheet_items
  SET monthly_deposit = 5865
  WHERE property_id = 'recqfxJfdqCXCLOuD' AND bs_code = '1122';  -- Capex / Repairs reserve
