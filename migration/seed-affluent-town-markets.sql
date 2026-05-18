-- Wipe existing metro markets, seed affluent towns
DELETE FROM market_research_scores;
DELETE FROM market_research_markets;

INSERT INTO market_research_markets (name, state, msa, population, status, thesis) VALUES
  ('Greenwich, CT', 'CT', 'New York', 63000, 'active', 'Quintessential Gold Coast. Hedge-fund capital, deep liquidity, top schools, exec jet access at Westchester County and Greenwich Heliport.'),
  ('Westport, CT', 'CT', 'New York', 27000, 'active', 'Coastal Fairfield County wealth corridor with arts scene and tightening supply.'),
  ('Darien, CT', 'CT', 'New York', 22000, 'active', 'Highest median HH income in CT, sub-1hr Metro-North to Grand Central.'),
  ('New Canaan, CT', 'CT', 'New York', 20000, 'active', 'Top-school zip code, restrictive zoning, residential bedroom community.'),
  ('Wilton, CT', 'CT', 'New York', 18000, 'active', 'Sub-Greenwich price point with similar school quality and demographics.'),
  ('Bronxville, NY', 'NY', 'New York', 6500, 'active', 'Tiny village (1 sq mi), among the highest income densities in the US, top schools.'),
  ('Scarsdale, NY', 'NY', 'New York', 18000, 'active', 'Iconic affluent suburb, top public schools, 35-min express to Grand Central.'),
  ('Rye, NY', 'NY', 'New York', 16000, 'active', 'Long Island Sound waterfront, country clubs, top schools.'),
  ('Larchmont, NY', 'NY', 'New York', 6500, 'active', 'Waterfront village, walkable downtown, strong schools.'),
  ('Chappaqua, NY', 'NY', 'New York', 10000, 'active', 'Northern Westchester, family-oriented, Clinton-era cachet.'),
  ('Bedford, NY', 'NY', 'New York', 17000, 'active', 'Equestrian/estate region, low density, very high net-worth residents.'),
  ('Pelham, NY', 'NY', 'New York', 12000, 'active', 'Closest-in Westchester, 30-min to Grand Central, walkable downtown.'),
  ('Manhasset, NY', 'NY', 'New York', 8000, 'active', 'North Shore / Gold Coast LI, Americana Manhasset retail corridor, top schools.'),
  ('Garden City, NY', 'NY', 'New York', 22000, 'active', 'Planned community, strong civic identity, large lot sizes.'),
  ('Short Hills (Millburn), NJ', 'NJ', 'New York', 21000, 'active', 'Top-tier NJ school district, Direct Midtown Direct train, The Mall at Short Hills.'),
  ('Summit, NJ', 'NJ', 'New York', 22000, 'active', 'Walkable downtown, Midtown Direct, Pharma/Finance executive base.'),
  ('Ridgewood, NJ', 'NJ', 'New York', 25000, 'active', 'Walkable downtown, exceptional schools, large NYC commuter base.'),
  ('Tenafly, NJ', 'NJ', 'New York', 15000, 'active', 'Bergen County, north of GWB, large estates, top schools.'),
  ('Rumson, NJ', 'NJ', 'New York', 7000, 'active', 'Jersey Shore wealth corridor, waterfront, country clubs.'),
  ('Wellesley, MA', 'MA', 'Boston', 28000, 'active', 'Top public schools in MA, Wellesley College, deep Boston tech/finance commuters.'),
  ('Winnetka, IL', 'IL', 'Chicago', 12000, 'active', 'North Shore Chicago, Lake Michigan frontage, New Trier schools.'),
  ('Lake Forest, IL', 'IL', 'Chicago', 19000, 'active', 'Estate-scale lots, historic district, Lake Forest Academy.'),
  ('Palo Alto, CA', 'CA', 'San Francisco Bay Area', 68000, 'active', 'Stanford, VC capital, tech HQ density. Larger than typical but fits criteria.'),
  ('Atherton, CA', 'CA', 'San Francisco Bay Area', 7500, 'active', 'Highest median HH income in US, founder/VC base, large-lot zoning.');
