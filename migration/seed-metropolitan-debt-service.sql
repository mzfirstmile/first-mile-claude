-- ============================================
-- 132-40 Metropolitan Ave — Add 2026 Debt Service to Budget
-- ============================================
-- Source budget xlsx ("Metropolitan 2026 Projection for lender") only contains
-- operating income + opex. Debt service was missing from the seeded budget.
--
-- Mortgage: $15,085,000
-- Rate: 6.5% (placeholder assumption per Morris 2026-05-18 — refine when lender
--             doc surfaces actual rate / IO term / amortization schedule)
-- Structure: Interest-Only (no principal paydown line)
-- Monthly interest = 15,085,000 × 0.065 / 12 = $81,710.4167
--
-- GL 7152 = 1st Mortgage Interest (matches Red Bank schema in CLAUDE.md)
-- ============================================

-- Wipe any prior 132-40 debt service rows so this seed is idempotent
DELETE FROM budget_line_items
WHERE property_id = 'prop_132_40_metropolitan'
  AND year = 2026
  AND gl_code IN ('7152', '7064', '7101', '7153');

-- Insert 12 months of interest expense
INSERT INTO budget_line_items (property_id, gl_code, account_name, year, month, amount)
VALUES
  ('prop_132_40_metropolitan', '7152', '1st Mortgage Interest', 2026, 1, 81710.42),
  ('prop_132_40_metropolitan', '7152', '1st Mortgage Interest', 2026, 2, 81710.42),
  ('prop_132_40_metropolitan', '7152', '1st Mortgage Interest', 2026, 3, 81710.42),
  ('prop_132_40_metropolitan', '7152', '1st Mortgage Interest', 2026, 4, 81710.42),
  ('prop_132_40_metropolitan', '7152', '1st Mortgage Interest', 2026, 5, 81710.42),
  ('prop_132_40_metropolitan', '7152', '1st Mortgage Interest', 2026, 6, 81710.42),
  ('prop_132_40_metropolitan', '7152', '1st Mortgage Interest', 2026, 7, 81710.42),
  ('prop_132_40_metropolitan', '7152', '1st Mortgage Interest', 2026, 8, 81710.42),
  ('prop_132_40_metropolitan', '7152', '1st Mortgage Interest', 2026, 9, 81710.42),
  ('prop_132_40_metropolitan', '7152', '1st Mortgage Interest', 2026, 10, 81710.42),
  ('prop_132_40_metropolitan', '7152', '1st Mortgage Interest', 2026, 11, 81710.42),
  ('prop_132_40_metropolitan', '7152', '1st Mortgage Interest', 2026, 12, 81710.42);

-- Sanity check: should return 12 rows totaling $980,525.04 annual
SELECT month, gl_code, account_name, amount
FROM budget_line_items
WHERE property_id = 'prop_132_40_metropolitan'
  AND year = 2026
  AND gl_code = '7152'
ORDER BY month;
