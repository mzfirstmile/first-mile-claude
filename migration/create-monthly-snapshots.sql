-- Monthly net-position snapshots for the Executive Financials line chart.
-- Cron job `exec-monthly-snapshot` runs the `monthly-snapshot` edge function on
-- the 1st of each month at ~1am ET, snapshotting the month that just ended.
-- Cash is NOT stored here — it's reconstructed live in the dashboard from
-- exec_transactions.ledger_balance (latest balance per account <= month-end).
-- This table holds only the slower-moving asset/liability values.

CREATE TABLE IF NOT EXISTS exec_monthly_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  snapshot_date DATE NOT NULL,
  investments_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  liabilities_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  loans_out_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  deposits_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  -- Net position EXCLUDING cash. The chart adds month-end cash on top.
  net_assets_ex_cash NUMERIC(15,2) GENERATED ALWAYS AS (
    investments_total + loans_out_total + deposits_total - liabilities_total
  ) STORED,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, month)
);

CREATE INDEX IF NOT EXISTS idx_exec_monthly_snapshots_period
  ON exec_monthly_snapshots (year DESC, month DESC);

-- Update trigger
CREATE OR REPLACE FUNCTION exec_monthly_snapshots_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exec_monthly_snapshots_touch ON exec_monthly_snapshots;
CREATE TRIGGER trg_exec_monthly_snapshots_touch
BEFORE UPDATE ON exec_monthly_snapshots
FOR EACH ROW EXECUTE FUNCTION exec_monthly_snapshots_touch();
