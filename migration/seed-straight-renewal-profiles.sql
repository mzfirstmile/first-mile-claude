-- Straight Renewal — default Re-Leasing Profile for every property
-- ────────────────────────────────────────────────────────────────
-- The "Straight Renewal" profile models the simplest possible lease
-- rollover: the tenant just keeps going at LXD at the same rent, with
-- no downtime, no free rent, no TI, no LC, no escalation bump.
--
-- This is the right model for things like rooftop antenna leases, ATM
-- alcoves, storage closets, parking licenses, and other "set it and
-- forget it" tenancies where there's no real re-let market and the
-- tenant has nowhere else to go.
--
-- Mechanics in the projection (fbAutoBuildRevenueBudget):
--   • base_rent_psf = NULL  → carry forward tenant's current rent
--                              (rent_per_sf × sf, or monthly_rent for
--                              flat-rate antenna-style leases)
--   • new/renew_escalation_pct = 0 → no annual bump after rollover
--   • renewal_probability_pct = 100 → blend uses 100% renewal path
--   • All downtime / free rent / TI / LC = 0 → seamless continuation
--
-- This script seeds one "Straight Renewal" profile per property that
-- has at least one rent_roll row. It is idempotent: it only inserts
-- where a profile with that name doesn't already exist for the
-- property, so re-running won't create duplicates or clobber any
-- manual edits.
--
-- Run via the admin SQL Console (admin.firstmilecap.com → SQL Console).

INSERT INTO releasing_profiles (
  property_id,
  name,
  is_default,
  renewal_probability_pct,
  base_rent_psf,
  new_downtime_months,   renew_downtime_months,
  new_free_rent_months,  renew_free_rent_months,
  new_escalation_pct,    renew_escalation_pct,
  new_ti_psf,            renew_ti_psf,
  new_lc_pct,            renew_lc_pct,
  notes
)
SELECT
  p.property_id,
  'Straight Renewal',
  FALSE,                 -- not the default profile; user opts tenants in
  100,                   -- 100% renewal probability
  NULL,                  -- carry tenant's existing rent forward
  0, 0,                  -- no downtime
  0, 0,                  -- no free rent
  0, 0,                  -- no escalation — same rent
  0, 0,                  -- no TI
  0, 0,                  -- no LC
  'Auto-seeded. Use for antenna / rooftop / storage / parking leases where the tenant straight-renews at LXD at the same rent with no downtime, no free rent, and no transaction costs. Base rent left NULL so the projection carries the tenant''s current rate forward.'
FROM (SELECT DISTINCT property_id FROM rent_roll) p
WHERE NOT EXISTS (
  SELECT 1
    FROM releasing_profiles rp
   WHERE rp.property_id = p.property_id
     AND rp.name = 'Straight Renewal'
);

-- Verify
SELECT property_id,
       name,
       renewal_probability_pct AS renew_pct,
       base_rent_psf,
       new_escalation_pct      AS esc,
       new_ti_psf              AS ti,
       new_lc_pct              AS lc,
       is_default
  FROM releasing_profiles
 WHERE name = 'Straight Renewal'
 ORDER BY property_id;
