-- Add investment_id column to exec_transactions
-- Links individual transactions (e.g. wire payments) to a specific investment
-- Run this in Supabase SQL Editor

ALTER TABLE exec_transactions ADD COLUMN IF NOT EXISTS investment_id UUID REFERENCES exec_investments(id);
CREATE INDEX IF NOT EXISTS idx_exec_txn_investment ON exec_transactions(investment_id);
