-- Seed Properties data from Airtable
-- Run this in Supabase SQL Editor after creating the table

INSERT INTO properties (id, property_name, property_type, address, city, state, square_footage, entity_name, status)
VALUES
  ('rec22i7CoBdrs6knK', 'Pref Fund I - Solow', NULL, NULL, NULL, NULL, NULL, 'Pref Fund I', 'Active'),
  ('rec5piW2SopCp4Z1b', '41 Flatbush Ave', NULL, '41 Flatbush Avenue', 'Brooklyn', 'NY', NULL, NULL, 'Active'),
  ('recF3zFKbY4wJ4P40', '1700 East Putnam', NULL, '1700 East Putnam Avenue', NULL, NULL, 183190, NULL, 'Active'),
  ('recQX1kpeJKqIzvkU', 'Paramus Plaza', NULL, NULL, 'Paramus', 'NJ', 153494, NULL, 'Active'),
  ('recTvhSRpqgmSoz3j', 'One River Centre', NULL, NULL, NULL, NULL, NULL, NULL, 'Active'),
  ('recUUsUChvL3yQ96g', '340 Mount Kemble', NULL, '340 Mount Kemble Avenue', 'Morristown', 'NJ', 423261, NULL, 'Active'),
  ('recqfxJfdqCXCLOuD', '61 S Paramus', NULL, '61 South Paramus Road', 'Paramus', 'NJ', 281504, NULL, 'Active'),
  ('recxF4R64gbb5Sowj', '575 Broadway', 'Office', '575 Broadway', 'New York', 'NY', 178898, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  property_name = EXCLUDED.property_name,
  property_type = EXCLUDED.property_type,
  address = EXCLUDED.address,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  square_footage = EXCLUDED.square_footage,
  entity_name = EXCLUDED.entity_name,
  status = EXCLUDED.status,
  updated_at = now();
