-- Per-tenant Re-Leasing override values on rent_roll
-- ───────────────────────────────────────────────────
-- The releasing_profiles table captures property-level (or tenancy-type
-- level) underwriting defaults — "if a suite in this category rolls,
-- here's what we assume for downtime / free rent / TI / LC / etc."
--
-- But every now and then a specific tenant needs an exception:
--   • The market is hot and we'd give a renewal anchor 0 mo of free rent
--     even though the profile says 4 mo
--   • A storage suite has $0 TI but the profile (carried over from
--     office space) shows $25 TI
--   • A specific antenna deal carries a 3% bump even though the
--     "Straight Renewal" profile is flat
--
-- This migration adds 11 NULL-able columns to rent_roll so any of the
-- profile inputs can be overridden per tenant. Display/projection logic:
--   • If the column is NULL → use the profile value
--   • If the column is non-NULL → use the tenant's override
--
-- Render in the Rent Roll table immediately to the right of the
-- "Re-Leasing Profile" dropdown so all the rollover assumptions for a
-- given tenant live in one row.

ALTER TABLE rent_roll
  ADD COLUMN IF NOT EXISTS rl_base_rent_psf          NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS rl_new_downtime_months    NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS rl_renew_downtime_months  NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS rl_new_free_rent_months   NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS rl_renew_free_rent_months NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS rl_new_escalation_pct     NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS rl_renew_escalation_pct   NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS rl_new_ti_psf             NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS rl_renew_ti_psf           NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS rl_new_lc_pct             NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS rl_renew_lc_pct           NUMERIC(6,3);

COMMENT ON COLUMN rent_roll.rl_base_rent_psf IS
  'Per-tenant override of base_rent_psf from the assigned releasing_profile. NULL = use profile value.';
COMMENT ON COLUMN rent_roll.rl_new_downtime_months IS
  'Per-tenant override of new_downtime_months from the assigned releasing_profile. NULL = use profile value.';
COMMENT ON COLUMN rent_roll.rl_renew_downtime_months IS
  'Per-tenant override of renew_downtime_months from the assigned releasing_profile. NULL = use profile value.';
COMMENT ON COLUMN rent_roll.rl_new_free_rent_months IS
  'Per-tenant override of new_free_rent_months from the assigned releasing_profile. NULL = use profile value.';
COMMENT ON COLUMN rent_roll.rl_renew_free_rent_months IS
  'Per-tenant override of renew_free_rent_months from the assigned releasing_profile. NULL = use profile value.';
COMMENT ON COLUMN rent_roll.rl_new_escalation_pct IS
  'Per-tenant override of new_escalation_pct from the assigned releasing_profile. NULL = use profile value.';
COMMENT ON COLUMN rent_roll.rl_renew_escalation_pct IS
  'Per-tenant override of renew_escalation_pct from the assigned releasing_profile. NULL = use profile value.';
COMMENT ON COLUMN rent_roll.rl_new_ti_psf IS
  'Per-tenant override of new_ti_psf from the assigned releasing_profile. NULL = use profile value.';
COMMENT ON COLUMN rent_roll.rl_renew_ti_psf IS
  'Per-tenant override of renew_ti_psf from the assigned releasing_profile. NULL = use profile value.';
COMMENT ON COLUMN rent_roll.rl_new_lc_pct IS
  'Per-tenant override of new_lc_pct from the assigned releasing_profile. NULL = use profile value.';
COMMENT ON COLUMN rent_roll.rl_renew_lc_pct IS
  'Per-tenant override of renew_lc_pct from the assigned releasing_profile. NULL = use profile value.';
