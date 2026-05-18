-- ============================================
-- exec_create_monthly_snapshot()
-- ============================================
-- Snapshots the slow-moving asset / liability side of the balance sheet
-- for a given month. Cash is intentionally NOT stored — the dashboard
-- overlays month-end cash live from exec_transactions.ledger_balance.
--
-- Called by:
--   1. pg_cron job `exec-monthly-snapshot` on the 1st of each month at
--      ~1am ET (snapshots the month that just ended).
--   2. The frontend on-demand via the "Snapshot Now" button (rarely needed).
--
-- Default behavior: snapshot the previous calendar month. Override with
-- explicit (year, month) for backfill.
--
-- Run with NULL args to snapshot last month:
--   SELECT exec_create_monthly_snapshot();
--
-- Backfill a specific month:
--   SELECT exec_create_monthly_snapshot(2026, 4);
-- ============================================

CREATE OR REPLACE FUNCTION exec_create_monthly_snapshot(
  p_year INT DEFAULT NULL,
  p_month INT DEFAULT NULL
) RETURNS exec_monthly_snapshots
LANGUAGE plpgsql
AS $$
DECLARE
  target_year INT;
  target_month INT;
  target_date DATE;
  inv_total NUMERIC;
  liab_total NUMERIC;
  loans_net NUMERIC;
  deps_net NUMERIC;
  result exec_monthly_snapshots;
BEGIN
  -- Default to PREVIOUS month if no override
  IF p_year IS NULL OR p_month IS NULL THEN
    target_year := EXTRACT(YEAR FROM (CURRENT_DATE - INTERVAL '1 month'))::INT;
    target_month := EXTRACT(MONTH FROM (CURRENT_DATE - INTERVAL '1 month'))::INT;
  ELSE
    target_year := p_year;
    target_month := p_month;
  END IF;
  target_date := (make_date(target_year, target_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- Investments: sum stored valuation column. Cap-rate-derived valuations
  -- (e.g. 132-40 Metro) are computed live in the dashboard from NOI and
  -- aren't in this column. The frontend will PATCH this row with its own
  -- richer computation when the user opens the dashboard.
  SELECT COALESCE(SUM(valuation), 0) INTO inv_total
  FROM exec_investments
  WHERE COALESCE(status, 'Active') = 'Active';

  -- Liabilities: sum usd_equivalent (NULL treated as 0)
  SELECT COALESCE(SUM(usd_equivalent), 0) INTO liab_total
  FROM exec_liabilities;

  -- Loans Out: net of Loan Out (debit/negative) and Loan Payback (credit/positive).
  -- Negative net = money still owed TO First Mile = asset. Take ABS for the snapshot.
  SELECT COALESCE(SUM(amount), 0) INTO loans_net
  FROM exec_transactions
  WHERE category_override IN ('Loan Out', 'Loan Payback')
    AND date <= target_date;

  -- Deposits: same pattern — outflows are deposits placed (asset), inflows are returns.
  SELECT COALESCE(SUM(amount), 0) INTO deps_net
  FROM exec_transactions
  WHERE category_override = 'Deposit'
    AND date <= target_date;

  INSERT INTO exec_monthly_snapshots (
    year, month, snapshot_date,
    investments_total, liabilities_total,
    loans_out_total, deposits_total,
    notes
  )
  VALUES (
    target_year, target_month, target_date,
    inv_total, liab_total,
    ABS(LEAST(loans_net, 0)),   -- positive balance still owed to FM
    ABS(LEAST(deps_net, 0)),    -- positive balance of deposits held by counterparties
    'auto: exec_create_monthly_snapshot()'
  )
  ON CONFLICT (year, month) DO UPDATE
    SET investments_total = EXCLUDED.investments_total,
        liabilities_total = EXCLUDED.liabilities_total,
        loans_out_total = EXCLUDED.loans_out_total,
        deposits_total = EXCLUDED.deposits_total,
        snapshot_date = EXCLUDED.snapshot_date,
        updated_at = now()
  RETURNING * INTO result;

  RETURN result;
END;
$$;
