-- Seed 2025 actual debt service for 61 South Paramus
-- Source: Morris confirmed 2025 actual debt service = $2,412,260.71 (UBS/Midland CMBS loan)
-- Distributed evenly across 12 months: 11 months @ $201,021.73 + Dec @ $201,021.68
-- Property: 61 South Paramus (recqfxJfdqCXCLOuD)
-- GL: 7199 (Total Debt Service)

-- Idempotent: clear any existing 7199 rows for this property/year first
DELETE FROM actuals_line_items
WHERE property_id = 'recqfxJfdqCXCLOuD'
  AND year = 2025
  AND gl_code = '7199';

INSERT INTO actuals_line_items (property_id, year, gl_code, account_name, month, amount) VALUES
  ('recqfxJfdqCXCLOuD', 2025, '7199', 'Total Debt Service',  1, 201021.73),
  ('recqfxJfdqCXCLOuD', 2025, '7199', 'Total Debt Service',  2, 201021.73),
  ('recqfxJfdqCXCLOuD', 2025, '7199', 'Total Debt Service',  3, 201021.73),
  ('recqfxJfdqCXCLOuD', 2025, '7199', 'Total Debt Service',  4, 201021.73),
  ('recqfxJfdqCXCLOuD', 2025, '7199', 'Total Debt Service',  5, 201021.73),
  ('recqfxJfdqCXCLOuD', 2025, '7199', 'Total Debt Service',  6, 201021.73),
  ('recqfxJfdqCXCLOuD', 2025, '7199', 'Total Debt Service',  7, 201021.73),
  ('recqfxJfdqCXCLOuD', 2025, '7199', 'Total Debt Service',  8, 201021.73),
  ('recqfxJfdqCXCLOuD', 2025, '7199', 'Total Debt Service',  9, 201021.73),
  ('recqfxJfdqCXCLOuD', 2025, '7199', 'Total Debt Service', 10, 201021.73),
  ('recqfxJfdqCXCLOuD', 2025, '7199', 'Total Debt Service', 11, 201021.73),
  ('recqfxJfdqCXCLOuD', 2025, '7199', 'Total Debt Service', 12, 201021.68);

-- Verify
SELECT month, amount FROM actuals_line_items
WHERE property_id = 'recqfxJfdqCXCLOuD'
  AND year = 2025
  AND gl_code = '7199'
ORDER BY month;

SELECT SUM(amount) AS total_2025_debt_service FROM actuals_line_items
WHERE property_id = 'recqfxJfdqCXCLOuD'
  AND year = 2025
  AND gl_code = '7199';
