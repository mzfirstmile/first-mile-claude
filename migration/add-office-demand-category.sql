-- Office Demand category (office view only). Scored programmatically by the
-- market-research-office-demand edge function from Census ACS workplace-geography
-- tables (S0804 = workers by INDUSTRY for the place they WORK in, B08301 = resident workers).
INSERT INTO market_research_categories (slug, name, description, sort_order, weight, weight_office, is_active) VALUES
  ('office_demand', 'Office Demand',
   'Jobs located IN the town (workplace geography), not where residents work. Office-using sectors = Information (51), Finance/Insurance/Real Estate (52-53), Professional/Scientific/Management/Administrative (54-56). Source: Census ACS 5-yr S0804 (workplace) + B08301 (residence). Office view only.',
   160, 0, 3.0, TRUE)
ON CONFLICT (slug) DO NOTHING;

WITH cat AS (SELECT id FROM market_research_categories WHERE slug = 'office_demand')
INSERT INTO market_research_criteria
  (name, description, category, category_id, sort_order, weight, value_type,
   target_min, target_max, target_unit, target_label, target_min_office, target_label_office,
   is_active, is_active_residential, is_active_office)
SELECT * FROM (VALUES
  ('Office-Using Jobs in Town',
   'Workers whose workplace is inside the town, in Information / Finance-Insurance-Real Estate / Professional-Management-Administrative sectors. ACS S0804 total workers × office-sector share.',
   'office_demand', (SELECT id FROM cat), 10, 1.00, 'number',
   NULL::numeric, NULL::numeric, 'jobs', NULL::text, 5000::numeric, '≥ 5,000 office jobs', TRUE, FALSE, TRUE),
  ('Office Share of Local Jobs',
   'Office-using sectors as % of all jobs located in the town (workplace geography). National office-using share ≈ 22%.',
   'office_demand', (SELECT id FROM cat), 20, 1.00, 'percent',
   NULL::numeric, NULL::numeric, '%', NULL::text, 35::numeric, '≥ 35%', TRUE, FALSE, TRUE),
  ('Jobs-to-Resident-Workers Ratio',
   'Workers employed IN the town ÷ employed residents. >1.0 = net employment center (daytime inflow); <0.5 = bedroom community.',
   'office_demand', (SELECT id FROM cat), 30, 1.00, 'number',
   NULL::numeric, NULL::numeric, 'ratio', NULL::text, 1.0::numeric, '≥ 1.0 (net importer of workers)', TRUE, FALSE, TRUE),
  ('Office Job Growth (5-yr)',
   '% change in office-using jobs located in town, ACS 2013-17 → 2018-22. Score: ≤ −15% → 0, linear to +10% → 10.',
   'office_demand', (SELECT id FROM cat), 40, 1.00, 'percent',
   NULL::numeric, NULL::numeric, '%', NULL::text, NULL::numeric, '≥ +10% over 5 yrs', TRUE, FALSE, TRUE),
  ('Resident Remote-Work Share',
   '% of employed residents who work from home (ACS B08301). High-WFH affluent towns are the demand base for local spec suites / work-near-home office.',
   'office_demand', (SELECT id FROM cat), 50, 1.00, 'percent',
   NULL::numeric, NULL::numeric, '%', NULL::text, 25::numeric, '≥ 25% WFH', TRUE, FALSE, TRUE)
) AS v(name, description, category, category_id, sort_order, weight, value_type, target_min, target_max, target_unit, target_label, target_min_office, target_label_office, is_active, is_active_residential, is_active_office)
WHERE NOT EXISTS (SELECT 1 FROM market_research_criteria x WHERE x.name = v.name);

-- Relation to Other Asset Classes: the two office-relevant criteria now count in office view
UPDATE market_research_criteria SET is_active_office = TRUE
 WHERE name IN ('% of market that is Office', 'Number of Tier 1 Office markets within 15 minute drive');
UPDATE market_research_categories SET is_active = TRUE WHERE slug = 'asset_relation';
