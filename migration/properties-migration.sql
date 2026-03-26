-- Properties table for Supabase
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,              -- Airtable record ID (e.g., rec22i7CoBdrs6knK)
  property_name TEXT NOT NULL,
  property_type TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  units INTEGER,
  square_footage INTEGER,
  entity_name TEXT,
  acquisition_date DATE,
  acquisition_price NUMERIC(14,2),
  current_valuation NUMERIC(14,2),
  status TEXT DEFAULT 'Active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_name ON properties(property_name);

-- Enable RLS
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

-- Allow anon full access (same as your other tables)
CREATE POLICY "Allow anon full access to properties"
  ON properties FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
