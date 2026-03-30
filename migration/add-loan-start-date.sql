-- Add loan_start_date column to exec_transactions
-- Used for Loan Out transactions to track when the loan originated
-- Affects cash flow calculation: loans with start_date before period are excluded from that period's cash flow
ALTER TABLE exec_transactions ADD COLUMN IF NOT EXISTS loan_start_date DATE;
ALTER TABLE exec_transactions ADD COLUMN IF NOT EXISTS loan_maturity_date DATE;
