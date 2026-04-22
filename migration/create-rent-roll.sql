-- Rent Roll — live snapshot of tenant leases per property.
-- One row per lease (tenant × suite). Reloaded periodically from Yardi
-- rent roll exports via scripts/sync_rent_rolls.py.
--
-- Strategy: script does DELETE WHERE property_id = X, then INSERT, so each
-- sync replaces that property's full roll with the most recent export.

CREATE TABLE IF NOT EXISTS rent_roll (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id              TEXT NOT NULL,                -- recXXX or prop_XX (same keys as FB_PROP_META)

  -- Identity
  tenant_name              TEXT NOT NULL,
  suite                    TEXT,                         -- e.g. "101", "200A"
  status                   TEXT,                         -- 'Current' | 'Vacant' | 'Pending' | 'Past' | 'Future'

  -- Physical
  sf                       NUMERIC(10,0),                -- leased square feet

  -- Lease dates
  lease_start              DATE,
  lease_end                DATE,
  move_in_date             DATE,                         -- rent commencement if ≠ lease_start
  move_out_date            DATE,

  -- Rent (as of most-recent file)
  monthly_rent             NUMERIC(14,2),                -- current contractual monthly base rent
  annual_rent              NUMERIC(14,2),                -- current annualized base rent
  rent_per_sf              NUMERIC(10,4),                -- $/SF/yr

  -- Escalation structure
  escalation_type          TEXT,                         -- 'fixed_pct' | 'step' | 'cpi' | 'none'
  escalation_pct           NUMERIC(6,3),                 -- e.g. 2.5 for 2.5% fixed annual bump
  escalation_months        INTEGER DEFAULT 12,           -- months between escalations (usually 12)
  next_escalation_date     DATE,                         -- when the next bump kicks in

  -- Recovery (expense pass-through) structure
  cam_reimbursement        TEXT,                         -- 'full' | 'pro_rata' | 'partial' | 'none'
  re_tax_reimbursement     TEXT,
  insurance_reimbursement  TEXT,
  cam_rate_psf             NUMERIC(10,4),                -- $/SF/yr baseline for recoveries
  re_tax_rate_psf          NUMERIC(10,4),
  insurance_rate_psf       NUMERIC(10,4),

  -- Free rent / concessions
  free_rent_months         INTEGER,
  concession_notes         TEXT,

  -- Renewal
  option_to_renew          BOOLEAN DEFAULT FALSE,
  option_notes             TEXT,

  -- Provenance / meta
  notes                    TEXT,
  source_file              TEXT,                         -- path of the Dropbox file this row came from
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rent_roll_property    ON rent_roll(property_id);
CREATE INDEX IF NOT EXISTS idx_rent_roll_status      ON rent_roll(property_id, status);
CREATE INDEX IF NOT EXISTS idx_rent_roll_lease_end   ON rent_roll(property_id, lease_end);

-- Simple view: active leases only (status Current or Pending)
CREATE OR REPLACE VIEW rent_roll_active AS
SELECT *
FROM rent_roll
WHERE status IN ('Current', 'Pending')
   OR (status IS NULL AND lease_end IS NOT NULL AND lease_end > CURRENT_DATE);

COMMENT ON TABLE rent_roll IS 'Live snapshot of tenant leases. Reloaded weekly/monthly from Yardi rent roll exports.';
