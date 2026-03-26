-- Create app_users table
CREATE TABLE IF NOT EXISTS app_users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  first_login TIMESTAMPTZ,
  last_login TIMESTAMPTZ,
  is_blocked BOOLEAN DEFAULT FALSE,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- Allow read/write via anon key
CREATE POLICY "Allow all access via anon key" ON app_users
  FOR ALL USING (true) WITH CHECK (true);

-- Index on email
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email);

-- Add module access columns
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS access_calendar BOOLEAN DEFAULT TRUE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS access_financials BOOLEAN DEFAULT TRUE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS access_forecasting BOOLEAN DEFAULT TRUE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS access_exec BOOLEAN DEFAULT FALSE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS access_properties BOOLEAN DEFAULT TRUE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS access_users BOOLEAN DEFAULT FALSE;

-- Seed admin with full access
INSERT INTO app_users (email, display_name, is_admin, is_blocked, access_calendar, access_financials, access_forecasting, access_exec, access_properties, access_users)
VALUES ('mz@firstmilecap.com', 'Morris Zeitouni', TRUE, FALSE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE)
ON CONFLICT (email) DO UPDATE SET
  is_admin = TRUE,
  access_calendar = TRUE, access_financials = TRUE, access_forecasting = TRUE,
  access_exec = TRUE, access_properties = TRUE, access_users = TRUE;
