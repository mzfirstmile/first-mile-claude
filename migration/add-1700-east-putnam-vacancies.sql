-- ─────────────────────────────────────────────────────────────────────────────
-- 1700 East Putnam — add 8 vacant suites from Q1 2026 AMR (Greenwich AMR Q1 26.pdf)
-- ─────────────────────────────────────────────────────────────────────────────
-- Source: Crown's Q1 2026 Asset Management Report (period ending 3/31/2026),
-- specifically Section IV "Leasing & Occupancy / A. Occupancy Summary"
-- (the stacking plan), cross-referenced against original acquisition pro-forma.
--
-- This preserves the existing Yardi-sourced rent roll (the source of truth for
-- occupied suites' financial columns) and ONLY inserts vacant suites that
-- aren't already in the table. NOT EXISTS guard means re-running is safe.
--
-- Per AMR: 21 suites total, 12 occupied (129,689 SF) + 1 pending Withers
-- relocation to Suite 210 (6,980 SF) + 8 vacant (46,521 SF) = 183,190 SF
-- building total. Building occupancy: 75% leased / 25% vacant.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO rent_roll (
  property_id, tenant_name, suite, status, sf, notes, source_file, as_of_date
)
SELECT
  'recF3zFKbY4wJ4P40' AS property_id,
  NULL                AS tenant_name,
  v.suite,
  'Vacant'            AS status,
  v.sf,
  v.notes,
  'Greenwich AMR Q1 26.pdf' AS source_file,
  '2026-03-31'::date  AS as_of_date
FROM (VALUES
  -- Floor 4 vacancies (28,235 SF)
  ('409', 4923,  'Available — originally Spencer Trask space ($46.42 PSF acq)'),
  ('400', 17589, 'Available — Withers Bergman vacating in Q2 2026 to relocate to Suite 210'),
  ('406', 1856,  'Available — originally Fogarty, Cohen, Selby & Nemiro space'),
  ('410', 3867,  'Available — originally Prostar Investments space'),
  -- Floor 2 vacancies (6,071 SF)
  ('211', 3364,  'Available — originally Cutler Andrews Capital space'),
  ('207', 1053,  'Available — originally Czech Asset Management (2,790 SF acq; likely subdivided)'),
  ('204', 1654,  'Available — originally Management Office'),
  -- Floor 1 vacancy (12,215 SF)
  ('101', 12215, 'Available — originally Wells Fargo space (10,098 SF acq; re-measured)')
) AS v(suite, sf, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM rent_roll r
  WHERE r.property_id = 'recF3zFKbY4wJ4P40'
    AND r.suite = v.suite
);

-- Verification queries (commented — run separately if you want to inspect):
-- SELECT suite, tenant_name, status, sf FROM rent_roll
--   WHERE property_id = 'recF3zFKbY4wJ4P40' AND status = 'Vacant'
--   ORDER BY suite;
-- SELECT COUNT(*) AS total_rows,
--        SUM(sf) FILTER (WHERE status = 'Vacant') AS vacant_sf,
--        SUM(sf) FILTER (WHERE status != 'Vacant' OR status IS NULL) AS leased_sf
--   FROM rent_roll WHERE property_id = 'recF3zFKbY4wJ4P40';
