-- ============================================
-- Market Research — Seed Data
-- ============================================
-- 8 standard institutional CRE evaluation criteria + 15 US markets
-- with starter scores (1-10) and tiers (1-4). Placeholder rankings
-- — replace once Morris's Dropbox criteria/sources are pulled in.
-- ============================================

-- Wipe prior seed (idempotent — explicit WHERE required by Supabase)
DELETE FROM market_research_scores WHERE id IS NOT NULL;
DELETE FROM market_research_markets WHERE id IS NOT NULL;
DELETE FROM market_research_criteria WHERE id IS NOT NULL;

-- ── 1. CRITERIA ──
INSERT INTO market_research_criteria (name, description, value_type, source_note, sort_order) VALUES
  ('Population Growth 5-yr',     '5-year CAGR of MSA population.',                                              'percent',     'Census ACS / Moody''s', 10),
  ('Job Growth 3-yr',            '3-year non-farm payroll growth.',                                             'percent',     'BLS QCEW',              20),
  ('Median HH Income Growth',    '5-year growth in median household income.',                                   'percent',     'Census ACS',            30),
  ('Net Domestic Migration',     'Annual net in-migration as % of population. Rated 1-10.',                     'rating_1_10', 'IRS SOI / Census',      40),
  ('Business / Tax Climate',     'State+local tax burden, regulatory environment, ROBR (Right-to-Work).',       'rating_1_10', 'Tax Foundation',        50),
  ('Supply Pipeline Discipline', 'Construction starts vs. absorption. 10 = most disciplined (low new supply).', 'rating_1_10', 'CoStar / RealPage',     60),
  ('CRE Liquidity Depth',        'Transaction volume + buyer pool depth. 10 = most liquid.',                    'rating_1_10', 'MSCI Real Capital',     70),
  ('Industry Diversity',         'Employment HHI inverted. 10 = most diverse, less cyclical.',                  'rating_1_10', 'BLS QCEW',              80);

-- ── 2. MARKETS ──
-- Score 8-10 = Tier 1 (highest conviction), 6-8 = Tier 2,
-- 4-6 = Tier 3 (researching), <4 = Tier 4 (long-tail/early-stage).
INSERT INTO market_research_markets (name, state, msa, population, status, score, tier, thesis, summary, created_by) VALUES

-- ─── TIER 1 ───
('Nashville, TN', 'TN', 'Nashville-Davidson-Murfreesboro-Franklin', 2118000, 'shortlisted', 9.2, 1,
  'Top-tier conviction. Diversified job growth (healthcare, music, finance, auto), no state income tax, sustained net in-migration, and strong demographic momentum without the supply overhang of peer Sun Belt markets.',
  'Population growth 5-yr ~9.5%. Job growth led by healthcare HQs (HCA), tech relocations, and Oracle''s campus build. Tax climate top-decile. Some submarket softness in CBD office but suburban/MOB and retail fundamentals remain best-in-class.',
  'mz@firstmilecap.com'),

('Raleigh-Durham, NC', 'NC', 'Raleigh-Cary + Durham-Chapel Hill', 2079000, 'shortlisted', 9.0, 1,
  'Top-tier conviction. Research Triangle anchors (Duke, UNC, NC State, RTP) drive sticky high-wage employment, low cyclicality, and consistent net in-migration. Limited overbuilding relative to demand growth.',
  'Job growth 3-yr ~8% led by biotech, IT, fintech. Apple''s $1B campus build under construction. Strong public-school metric supports family migration. Industrial supply elevated; office/MOB/retail well-positioned.',
  'mz@firstmilecap.com'),

('Phoenix, AZ', 'AZ', 'Phoenix-Mesa-Chandler', 5071000, 'shortlisted', 8.8, 1,
  'Top-tier conviction with supply caveat. Among the strongest population/job growth nationally, top destination for California migration, TSMC + Intel semiconductor cluster reshaping the economy. Watch supply pipeline in multifamily and industrial.',
  'Population 5-yr growth ~9%. $40B TSMC fab + $20B Intel fab. Existing First Mile exposure (Lifetime Paradise Valley) provides on-the-ground knowledge. Risk: housing affordability deteriorating; water/heat risk overhang.',
  'mz@firstmilecap.com'),

('Charlotte, NC', 'NC', 'Charlotte-Concord-Gastonia', 2806000, 'shortlisted', 8.6, 1,
  'Top-tier conviction. #2 US banking center, strong fintech/back-office talent, business-friendly state policy, balanced supply pipeline. Compelling combination of growth + institutional liquidity depth.',
  'Job growth 3-yr ~6.5%. Bank of America HQ, Truist, Wells Fargo east-coast hub. South End office submarket showing softness; uptown stable. Industrial/logistics fundamentals best-in-Sun-Belt.',
  'mz@firstmilecap.com'),

('Tampa-St. Petersburg, FL', 'FL', 'Tampa-St. Petersburg-Clearwater', 3220000, 'shortlisted', 8.4, 1,
  'Top-tier conviction. No state income tax driving sustained net in-migration, financial services growth (Citi, JPM expansion), port + tourism diversification. Insurance cost trajectory is the watchout.',
  'Population growth 5-yr ~7.5%. Westshore office submarket showing best returns in market. Industrial fundamentals excellent due to port. Home insurance premiums up ~50% 2022-25 — pressuring affordability.',
  'mz@firstmilecap.com'),

-- ─── TIER 2 ───
('Dallas-Fort Worth, TX', 'TX', 'Dallas-Fort Worth-Arlington', 8100000, 'shortlisted', 7.9, 2,
  'High conviction tempered by scale. Deepest CRE liquidity in Sun Belt, broadest employment base, top destination for corporate HQ relocations. Multifamily supply pipeline elevated. Office bifurcation acute.',
  'Job growth 3-yr ~5.5%. Toyota, Charles Schwab, McKesson, Caterpillar HQ moves. Industrial near-perfect (DFW Airport + 6 Class I railroads). Trophy office stable; commodity office under significant pressure.',
  'mz@firstmilecap.com'),

('Salt Lake City, UT', 'UT', 'Salt Lake City + Provo-Orem', 1280000, 'shortlisted', 7.8, 2,
  'High conviction in smaller package. "Silicon Slopes" tech employment, youngest population in US, low cost of business, disciplined supply. Below institutional radar = pricing inefficiency opportunity.',
  'Job growth 3-yr ~7%. eBay, Goldman Sachs (largest non-NYC office), Adobe, Qualtrics anchor tech base. Industrial absorption outpacing supply. Limited new office supply since 2023.',
  'mz@firstmilecap.com'),

('Austin, TX', 'TX', 'Austin-Round Rock-Georgetown', 2473000, 'researching', 7.5, 2,
  'High growth, cooling momentum. Best-in-class population/job CAGR but overbuilding in multifamily and office has compressed near-term returns. Long-term fundamentals intact; entry timing matters.',
  'Population growth 5-yr ~14% (top in US). Apple, Tesla, Oracle, Samsung major employers. Multifamily supply 3x absorption 2024-25; rents flat-to-down. Patience needed.',
  'mz@firstmilecap.com'),

('Atlanta, GA', 'GA', 'Atlanta-Sandy Springs-Alpharetta', 6307000, 'researching', 7.4, 2,
  'High conviction with mixed signals. Large diversified economy (Delta, Coca-Cola, UPS, Home Depot, CNN, fintech cluster), strong logistics anchor, increasingly attractive cost-of-business. Industrial supply elevated; office softer.',
  'Job growth 3-yr ~4.5%. Major film/TV production hub (#3 nationally). Strong Black household income growth supporting consumer fundamentals. Industrial leasing slowing from 2022-23 peak.',
  'mz@firstmilecap.com'),

('Boise, ID', 'ID', 'Boise City', 824000, 'researching', 7.1, 2,
  'Smaller-market high-conviction. Top per-capita net migration, lowest cost of business in Mountain West, Micron $15B fab + Meta data center. Liquidity depth is the constraint.',
  'Population growth 5-yr ~12%. Micron expansion adds ~17K jobs. Limited institutional ownership = thin comp set. Multifamily supply rising sharply but absorbing.',
  'mz@firstmilecap.com'),

-- ─── TIER 3 ───
('Indianapolis, IN', 'IN', 'Indianapolis-Carmel-Anderson', 2127000, 'researching', 6.7, 3,
  'Affordability + industrial-logistics anchor. Top US distribution hub (1-day drive to 50% of population), pro-business state, stable but slow growth. Limited demand catalysts beyond logistics.',
  'Job growth 3-yr ~3%. Eli Lilly $9B expansion adds biotech catalyst. Industrial near-100% leased. Office/retail growth modest. Strong school metrics for suburbs (Carmel, Fishers, Westfield).',
  'mz@firstmilecap.com'),

('Columbus, OH', 'OH', 'Columbus', 2151000, 'researching', 6.6, 3,
  'Intel-catalyst story with execution risk. $28B Intel fab build will reshape labor market through 2030; current fundamentals merit Tier 3 until catalyst confirms. State govt + Ohio State stabilize base demand.',
  'Job growth 3-yr ~3%. Intel build progress slower than initial timeline. Multifamily supply moderate. Office heavy on insurance (Nationwide, JPM) — stable but not growing.',
  'mz@firstmilecap.com'),

('Jacksonville, FL', 'FL', 'Jacksonville', 1716000, 'researching', 6.3, 3,
  'No-income-tax tailwind, smaller-market entry, port logistics. Lower institutional liquidity and slower wage growth than Tier 1/2 FL peers (Tampa, Miami).',
  'Population growth 5-yr ~6.5%. JAXPORT one of fastest-growing US container ports. Insurance pressure same as broader FL. Office fundamentals improving from low base.',
  'mz@firstmilecap.com'),

('Kansas City, MO', 'MO', 'Kansas City', 2222000, 'researching', 5.8, 3,
  'Affordable, central distribution hub, KCI airport expansion catalyst. Slow growth and limited employment catalysts keep ranking in researching range. Strong yields offsetting lower growth.',
  'Job growth 3-yr ~2.5%. Cerner/Oracle Health, Sprint/T-Mobile, Hallmark. Stadium district investment. Cap rates 50-100bps wider than Sun Belt peers — yield play.',
  'mz@firstmilecap.com'),

-- ─── TIER 4 ───
('Birmingham, AL', 'AL', 'Birmingham-Hoover', 1115000, 'researching', 4.2, 4,
  'Deep-value, long-tail. Lower cost of living and business, healthcare/banking anchors (UAB, Regions, BBVA). Thin transaction volume and demographic stagnation keep this in early research stage.',
  'Population effectively flat. UAB Medical largest employer. Limited institutional comps. Re-emerging downtown but pace is slow.',
  'mz@firstmilecap.com');

-- Verify count
SELECT
  (SELECT count(*) FROM market_research_criteria) AS criteria_count,
  (SELECT count(*) FROM market_research_markets) AS markets_count;
