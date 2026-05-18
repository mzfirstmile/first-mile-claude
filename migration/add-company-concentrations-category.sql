-- 7th category: Company Concentrations (tenant base proximity)
INSERT INTO market_research_categories (slug, name, description, sort_order, weight) VALUES
  ('company_concentrations',
   'Company Concentrations',
   'Density of First Mile tenant-base companies (Big Four accounting + wealth management) within 60 miles. Powered by Big_Four_and_Wealth_Mgmt_Within_60mi.xlsx (1,160 offices across Deloitte, PwC, EY, KPMG, Morgan Stanley, Merrill, UBS, Goldman PW, JPMorgan Wealth).',
   700,
   1.00)
ON CONFLICT (slug) DO NOTHING;

-- Sub-criteria
WITH cat AS (SELECT id FROM market_research_categories WHERE slug = 'company_concentrations')
INSERT INTO market_research_criteria
  (name, description, category, category_id, sort_order, weight, value_type,
   target_min, target_max, target_unit, target_label, is_active)
SELECT * FROM (VALUES
  ('Big Four Offices within 60 mi',
   'Count of Deloitte/PwC/EY/KPMG offices within 60 miles of the town.',
   'company_concentrations', (SELECT id FROM cat), 710, 1.00, 'number',
   5::numeric, NULL::numeric, 'count', NULL::text, TRUE),
  ('Big Four Flagship / Major Office within 60 mi',
   'At least one Big Four Flagship or Major (not Satellite) office within 60 miles.',
   'company_concentrations', (SELECT id FROM cat), 720, 1.00, 'number',
   1::numeric, NULL::numeric, 'count', NULL::text, TRUE),
  ('Wealth Management Offices within 60 mi',
   'Count of Morgan Stanley / Merrill / UBS / Goldman PW / JPMorgan Wealth offices within 60 miles.',
   'company_concentrations', (SELECT id FROM cat), 730, 1.00, 'number',
   10::numeric, NULL::numeric, 'count', NULL::text, TRUE),
  ('Wealth Mgmt Flagship / Major Office within 60 mi',
   'At least one Wealth Management Flagship or Major office within 60 miles.',
   'company_concentrations', (SELECT id FROM cat), 740, 1.00, 'number',
   1::numeric, NULL::numeric, 'count', NULL::text, TRUE),
  ('Total Tenant-Base Offices within 60 mi',
   'Combined count of Big Four + Wealth Management offices within 60 miles.',
   'company_concentrations', (SELECT id FROM cat), 750, 1.00, 'number',
   20::numeric, NULL::numeric, 'count', NULL::text, TRUE),
  ('Tenant Sector Diversity',
   'Both Big Four and Wealth Management sectors represented within 60 miles.',
   'company_concentrations', (SELECT id FROM cat), 760, 1.00, 'text',
   NULL::numeric, NULL::numeric, NULL::text, 'Both sectors', TRUE)
) AS v(name, description, category, category_id, sort_order, weight, value_type, target_min, target_max, target_unit, target_label, is_active);
