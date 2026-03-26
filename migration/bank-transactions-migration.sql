-- Bank Transactions table for Supabase
-- Run this in Supabase SQL Editor BEFORE the seed file

CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,                -- Airtable record ID
  description TEXT,
  date DATE,
  amount NUMERIC(14,2),
  ledger_balance NUMERIC(14,2),
  transaction_type TEXT,
  credit_debit TEXT,
  account_name TEXT,
  account_number TEXT,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_bank_txn_date ON bank_transactions(date);
CREATE INDEX IF NOT EXISTS idx_bank_txn_account ON bank_transactions(account_name);
CREATE INDEX IF NOT EXISTS idx_bank_txn_account_num ON bank_transactions(account_number);
CREATE INDEX IF NOT EXISTS idx_bank_txn_credit_debit ON bank_transactions(credit_debit);

-- Enable RLS
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

-- Allow anon full access
CREATE POLICY "Allow anon full access to bank_transactions"
  ON bank_transactions FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- Auto-update trigger (reuse function if already created)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bank_transactions_updated_at
  BEFORE UPDATE ON bank_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
