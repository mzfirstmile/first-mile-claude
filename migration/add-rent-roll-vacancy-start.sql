-- Per-tenant Re-Lease start date override on rent_roll
-- ─────────────────────────────────────────────────────
-- The auto-generated revenue budget projects each rolling tenant's
-- "new lease" start date as:  lease_end + ceil(blended downtime)
-- This works for tenants on a forecasted normal market rollover, but
-- doesn't cover two cases the user wants to model directly:
--
--   1. Vacancies. There's no prior `lease_end` to anchor the projection
--      to, so the user needs to say "I expect to lease this suite
--      starting Jan 1, 2027." This date drives where the rent line
--      kicks in during the budget projection.
--
--   2. Occupied tenants with non-standard rollover timing — e.g. a
--      tenant who's already given notice they'll leave 3 months early,
--      or where a renewal LOI extends the lease by 6 months. The user
--      types in the exact date and the projection respects it.
--
-- NULL semantics: the projection falls back to the computed default
-- (lease_end + blended downtime) only when this column is NULL. Any
-- non-null value wins.
--
-- Run via the admin SQL Console (admin.firstmilecap.com → SQL Console).

ALTER TABLE rent_roll
  ADD COLUMN IF NOT EXISTS rl_lease_start_date DATE;

COMMENT ON COLUMN rent_roll.rl_lease_start_date IS
  'Per-tenant override of the projected re-lease start date. For vacancies, this is the target lease commencement. For occupied tenants, this overrides the default (lease_end + blended downtime). NULL = use computed default.';
