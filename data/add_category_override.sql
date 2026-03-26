-- Add category_override column to exec_transactions
-- Run in Supabase SQL Editor
ALTER TABLE exec_transactions ADD COLUMN IF NOT EXISTS category_override TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_exec_transactions_category ON exec_transactions(category_override);
