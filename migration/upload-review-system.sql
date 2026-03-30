-- Migration: Upload Review System
-- Adds property linking for income transactions and learned patterns table for AI categorization

-- Add property_id to exec_transactions (links income items to properties)
ALTER TABLE exec_transactions ADD COLUMN IF NOT EXISTS property_id TEXT;
CREATE INDEX IF NOT EXISTS idx_exec_txn_property ON exec_transactions(property_id);

-- Add liability_id to exec_transactions (links Interest Expense to liabilities)
ALTER TABLE exec_transactions ADD COLUMN IF NOT EXISTS liability_id UUID REFERENCES exec_liabilities(id);
CREATE INDEX IF NOT EXISTS idx_exec_txn_liability ON exec_transactions(liability_id);

-- Learned patterns table for improving categorization confidence over time
CREATE TABLE IF NOT EXISTS exec_learned_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description_pattern TEXT NOT NULL,
  account_number TEXT,
  category TEXT NOT NULL,
  amount_min NUMERIC(14,2),
  amount_max NUMERIC(14,2),
  property_id TEXT,
  investment_id UUID REFERENCES exec_investments(id),
  liability_id UUID REFERENCES exec_liabilities(id),
  confidence NUMERIC(3,2) DEFAULT 0.5,
  occurrences INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learned_patterns_desc ON exec_learned_patterns(description_pattern);
CREATE INDEX IF NOT EXISTS idx_learned_patterns_cat ON exec_learned_patterns(category);

-- Add unique constraint to prevent duplicate patterns
CREATE UNIQUE INDEX IF NOT EXISTS idx_learned_patterns_unique
  ON exec_learned_patterns(description_pattern, category, account_number)
  WHERE account_number IS NOT NULL;
