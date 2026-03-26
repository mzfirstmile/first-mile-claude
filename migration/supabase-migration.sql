-- ============================================
-- First Mile Capital — Supabase Migration
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Banking Transactions
CREATE TABLE IF NOT EXISTS banking_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id TEXT UNIQUE,
  description TEXT,
  date DATE,
  amount NUMERIC(14,2),
  ledger_balance NUMERIC(14,2),
  transaction_type TEXT,
  credit_debit TEXT,
  account_name TEXT,
  account_number TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast queries
CREATE INDEX idx_txn_date ON banking_transactions(date);
CREATE INDEX idx_txn_account ON banking_transactions(account_number);
CREATE INDEX idx_txn_amount ON banking_transactions(amount);

-- 2. Investments
CREATE TABLE IF NOT EXISTS investments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id TEXT UNIQUE,
  name TEXT NOT NULL,
  membership_class TEXT,
  ownership_pct NUMERIC(10,4),
  committed NUMERIC(14,2) DEFAULT 0,
  contributed NUMERIC(14,2) DEFAULT 0,
  distributed NUMERIC(14,2) DEFAULT 0,
  unreturned NUMERIC(14,2) DEFAULT 0,
  net_equity NUMERIC(14,2) DEFAULT 0,
  valuation NUMERIC(14,2),
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Liabilities
CREATE TABLE IF NOT EXISTS liabilities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id TEXT UNIQUE,
  lender TEXT NOT NULL,
  related_deal TEXT,
  principal NUMERIC(14,2) DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  usd_equivalent NUMERIC(14,2),
  maturity_date DATE,
  status TEXT DEFAULT 'Active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Enable Row Level Security (RLS) but allow anon read/write for now
-- (You can tighten this later with proper auth)
ALTER TABLE banking_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE liabilities ENABLE ROW LEVEL SECURITY;

-- Allow anon key full access (for your static dashboard)
CREATE POLICY "Allow anon full access" ON banking_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON investments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON liabilities FOR ALL USING (true) WITH CHECK (true);
