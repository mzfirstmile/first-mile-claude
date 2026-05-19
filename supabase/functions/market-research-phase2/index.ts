// supabase/functions/market-research-phase2/index.ts
//
// Server-side Phase 2 programmatic scoring for Market Research.
// Scores towns on the 3 categories reachable from Census + Big Four Excel:
//   - Demographics (Town Population, MHI, Home Value, Households $200k+)
//   - Education (Bachelor's, Grad)
//   - Company Concentrations (inherited from same-metro peer)
//
// Reverse-engineered scoring formulas (validated against existing 1,046 scores):
//   - Town Population: tent function, peak 25k-50k:
//       <5000 or >75000 → 0
//       5000-25000      → (pop-5000)/2000  (linear ramp 0-10)
//       25000-50000     → 10
//       50000-75000     → (75000-pop)/2500 (linear decay 10-0)
//   - Generic target_min criterion: min(10, value/target_min*10)
//     Used for: MHI ($200k), Home ($1.5M), HHs $200k+ (35%), Bachelor's (70%), Grad (30%)
//
// POST body (all optional):
//   {
//     "batch_size":    number   // default 200, max per call so we stay under timeout
//     "only_unscored": boolean  // default true; if false, re-scores all shortlisted
//     "market_ids":    string[] // explicit list overrides only_unscored filter
//   }
//
// Returns: { ok, processed, score_rows_written, market_updates, remaining, done }
//
// Deploy: supabase functions deploy market-research-phase2 --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09",
  DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17",
  IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24",
  MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31",
  NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38",
  OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46",
  TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54",
  WI: "55", WY: "56", PR: "72",
};

const TIER_T1 = 8.5, TIER_T2 = 7.0, TIER_T3 = 4.0;

interface Market {
  id: string;
  name: string;
  state: string;
  population: number | null;
  median_household_income: number | null;
  median_home_value: number | null;
  nearest_top50_city: string | null;
  census_place_geoid: string | null;
}

interface Criterion {
  id: string;
  name: string;
  category_id: string;
  target_min: number | null;
  target_max: number | null;
  category_name?: string;
  category_weight?: number;
}

function roundTo(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function scorePopulation(pop: number | null): number {
  if (pop == null || pop < 5000 || pop > 75000) return 0;
  if (pop < 25000) return roundTo((pop - 5000) / 2000, 1);
  if (pop <= 50000) return 10;
  return roundTo((75000 - pop) / 2500, 1);
}

function scoreTargetMin(value: number | null, targetMin: number): number {
  if (value == null || value <= 0) return 0;
  return roundTo(Math.min(10, (value / targetMin) * 10), 1);
}

async function fetchCensusForState(stateFips: string): Promise<Map<string, any> | null> {
  const censusKey = Deno.env.get("CENSUS_API_KEY") || "";
  const keyParam = censusKey ? `&key=${censusKey}` : "";
  const url =
    `https://api.census.gov/data/2022/acs/acs5` +
    `?get=NAME,B19001_001E,B19001_017E,B15003_001E,B15003_022E,B15003_023E,B15003_024E,B15003_025E` +
    `&for=place:*&in=state:${stateFips}${keyParam}`;
  try {
    const r = await fetch(url);
    if (!r.ok) {
      console.error(`Census ${stateFips}: HTTP ${r.status}`);
      return null;
    }
    const json = await r.json();
    if (!Array.isArray(json) || json.length < 2) return null;
    const header = json[0];
    const iState = header.indexOf("state");
    const iPlace = header.indexOf("place");
    const iHhTot = header.indexOf("B19001_001E");
    const iHh200 = header.indexOf("B19001_017E");
    const iEduTot = header.indexOf("B15003_001E");
    const iBach = header.indexOf("B15003_022E");
    const iMast = header.indexOf("B15003_023E");
    const iProf = header.indexOf("B15003_024E");
    const iDoct = header.indexOf("B15003_025E");
    const m = new Map<string, any>();
    for (let i = 1; i < json.length; i++) {
      const row = json[i];
      const geoid = String(row[iState]) + String(row[iPlace]);
      m.set(geoid, {
        hh_total: parseInt(row[iHhTot]) || 0,
        hh_200k: parseInt(row[iHh200]) || 0,
        edu_total: parseInt(row[iEduTot]) || 0,
        bachelors: parseInt(row[iBach]) || 0,
        masters: parseInt(row[iMast]) || 0,
        prof: parseInt(row[iProf]) || 0,
        doctorate: parseInt(row[iDoct]) || 0,
      });
    }
    return m;
  } catch (e) {
    console.error(`Census ${stateFips} error:`, String(e));
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const t0 = Date.now();
  const body = await req.json().catch(() => ({} as any));
  const batchSize = Math.min(body.batch_size ?? 200, 500);
  const onlyUnscored = body.only_unscored !== false; // default true
  const explicitIds: string[] | undefined = body.market_ids;

  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // 1. Pull markets to score
  let q = supa
    .from("market_research_markets")
    .select(
      "id,name,state,population,median_household_income,median_home_value,nearest_top50_city,census_place_geoid",
    )
    .eq("phase", "shortlisted")
    .limit(batchSize);
  if (explicitIds && explicitIds.length > 0) {
    q = q.in("id", explicitIds);
  } else if (onlyUnscored) {
    q = q.is("score", null);
  }
  const { data: markets, error: mErr } = await q;
  if (mErr) {
    return new Response(JSON.stringify({ ok: false, error: mErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!markets || markets.length === 0) {
    return new Response(JSON.stringify({ ok: true, done: true, processed: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Load criteria + categories
  const { data: critsRaw } = await supa
    .from("market_research_criteria")
    .select("id,name,category_id,target_min,target_max");
  const { data: catsRaw } = await supa
    .from("market_research_categories")
    .select("id,name,weight");
  const catById = new Map<string, { name: string; weight: number }>();
  for (const c of catsRaw || []) catById.set(c.id, { name: c.name, weight: c.weight ?? 1 });
  const critByName = new Map<string, Criterion>();
  for (const c of critsRaw || []) {
    const cat = catById.get(c.category_id);
    critByName.set(c.name, { ...c, category_name: cat?.name, category_weight: cat?.weight });
  }

  // 3. Fetch ACS per unique state
  const uniqueStates = [...new Set(markets.map((m: any) => m.state))].filter(Boolean);
  const acsByState = new Map<string, Map<string, any>>();
  await Promise.all(
    uniqueStates.map(async (st) => {
      const fips = STATE_FIPS[st as string];
      if (!fips) return;
      const m = await fetchCensusForState(fips);
      if (m) acsByState.set(st as string, m);
    }),
  );

  // 4. Fetch Company Concentrations seed scores per unique metro
  const CC_NAMES = [
    "Big Four Flagship / Major Office within 60 mi",
    "Big Four Offices within 60 mi",
    "Tenant Sector Diversity",
    "Total Tenant-Base Offices within 60 mi",
    "Wealth Management Offices within 60 mi",
    "Wealth Mgmt Flagship / Major Office within 60 mi",
  ];
  const ccCritIds = CC_NAMES.map((n) => critByName.get(n)?.id).filter(Boolean) as string[];
  const uniqueMetros = [
    ...new Set(markets.map((m: any) => m.nearest_top50_city).filter(Boolean)),
  ] as string[];
  const ccByMetro = new Map<string, Map<string, any>>();

  // For each metro, get a sample peer's CC scores
  await Promise.all(
    uniqueMetros.map(async (metro) => {
      // Find any market in this metro that has CC scores already
      const { data: peers } = await supa
        .from("market_research_markets")
        .select("id")
        .eq("nearest_top50_city", metro)
        .eq("phase", "shortlisted")
        .not("score", "is", null)
        .limit(5);
      if (!peers || peers.length === 0) {
        ccByMetro.set(metro, new Map());
        return;
      }
      const peerIds = peers.map((p: any) => p.id);
      const { data: ccScores } = await supa
        .from("market_research_scores")
        .select("criterion_id,value_numeric,value_text")
        .in("market_id", peerIds)
        .in("criterion_id", ccCritIds)
        .eq("updated_by", "phase2_auto");
      const metroMap = new Map<string, any>();
      for (const s of ccScores || []) {
        const cn = [...critByName.values()].find((c) => c.id === s.criterion_id)?.name;
        if (cn && !metroMap.has(cn)) {
          metroMap.set(cn, { value_numeric: s.value_numeric, value_text: s.value_text });
        }
      }
      ccByMetro.set(metro, metroMap);
    }),
  );

  // 5. Score each market
  const scoresToInsert: any[] = [];
  const marketUpdates: { id: string; score: number; tier: number }[] = [];
  const failures: { id: string; reason: string }[] = [];

  for (const m of markets as Market[]) {
    const stateAcs = acsByState.get(m.state);
    const acs = stateAcs?.get(m.census_place_geoid || "");

    const rows: { name: string; vn: number | null; vt: string | null; src: string }[] = [];

    // Town Population
    if (m.population != null) {
      rows.push({
        name: "Town Population",
        vn: scorePopulation(m.population),
        vt: m.population.toLocaleString(),
        src: "https://data.census.gov/ (B01003_001E)",
      });
    }
    // MHI
    if (m.median_household_income != null) {
      rows.push({
        name: "Median Household Income",
        vn: scoreTargetMin(m.median_household_income, 200000),
        vt: "$" + m.median_household_income.toLocaleString(),
        src: "https://data.census.gov/ (B19013_001E)",
      });
    }
    // Home Value
    if (m.median_home_value != null && m.median_home_value > 0) {
      rows.push({
        name: "Median Single-Family Home Price",
        vn: scoreTargetMin(m.median_home_value, 1500000),
        vt: "$" + m.median_home_value.toLocaleString(),
        src: "https://data.census.gov/ (B25077_001E)",
      });
    }
    // Households $200k+
    if (acs && acs.hh_total > 0) {
      const pct = (acs.hh_200k / acs.hh_total) * 100;
      rows.push({
        name: "Households Earning $200k+",
        vn: roundTo(Math.min(10, (pct / 35) * 10), 1),
        vt: pct.toFixed(1) + "%",
        src: "https://data.census.gov/ (B19001 brackets)",
      });
    }
    // Bachelor's
    if (acs && acs.edu_total > 0) {
      const bachPlus = acs.bachelors + acs.masters + acs.prof + acs.doctorate;
      const pct = (bachPlus / acs.edu_total) * 100;
      rows.push({
        name: "Bachelor's Degree Attainment",
        vn: roundTo(Math.min(10, (pct / 70) * 10), 1),
        vt: pct.toFixed(1) + "%",
        src: "https://data.census.gov/ (B15003 brackets)",
      });
    }
    // Grad
    if (acs && acs.edu_total > 0) {
      const gradPlus = acs.masters + acs.prof + acs.doctorate;
      const pct = (gradPlus / acs.edu_total) * 100;
      rows.push({
        name: "Professional / Graduate Degrees",
        vn: roundTo(Math.min(10, (pct / 30) * 10), 1),
        vt: pct.toFixed(1) + "%",
        src: "https://data.census.gov/ (B15003 brackets)",
      });
    }
    // Company Concentrations (inherit from metro)
    if (m.nearest_top50_city) {
      const metroMap = ccByMetro.get(m.nearest_top50_city);
      if (metroMap && metroMap.size > 0) {
        for (const cn of CC_NAMES) {
          const v = metroMap.get(cn);
          if (v != null) {
            rows.push({
              name: cn,
              vn: v.value_numeric,
              vt: v.value_text,
              src: "Big_Four_and_Wealth_Mgmt_Within_60mi.xlsx (Dropbox)",
            });
          }
        }
      }
    }

    if (rows.length === 0) {
      failures.push({ id: m.id, reason: "no scoreable data (missing ACS + no metro peer)" });
      continue;
    }

    // Build INSERT rows
    for (const r of rows) {
      const c = critByName.get(r.name);
      if (!c) continue;
      scoresToInsert.push({
        market_id: m.id,
        criterion_id: c.id,
        value_numeric: r.vn,
        value_text: r.vt,
        source: r.src,
        updated_by: "phase2_auto",
      });
    }

    // Composite score: weighted avg of category means
    const byCat = new Map<string, number[]>();
    for (const r of rows) {
      const c = critByName.get(r.name);
      if (!c || !c.category_name || r.vn == null) continue;
      if (!byCat.has(c.category_name)) byCat.set(c.category_name, []);
      byCat.get(c.category_name)!.push(r.vn);
    }
    let wSum = 0, wTot = 0;
    for (const [catName, vals] of byCat) {
      if (vals.length === 0) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const w = [...catById.values()].find((c) => c.name === catName)?.weight ?? 1;
      wSum += mean * w;
      wTot += w;
    }
    if (wTot === 0) continue;
    const composite = roundTo(wSum / wTot, 1);
    const tier = composite >= TIER_T1 ? 1 : composite >= TIER_T2 ? 2 : composite >= TIER_T3 ? 3 : 4;
    marketUpdates.push({ id: m.id, score: composite, tier });
  }

  // 6. Delete existing phase2_auto rows for these markets (to avoid UNIQUE violation)
  const marketIds = markets.map((m: any) => m.id);
  const { error: delErr } = await supa
    .from("market_research_scores")
    .delete()
    .in("market_id", marketIds)
    .eq("updated_by", "phase2_auto");
  if (delErr) console.error("Delete error:", delErr.message);

  // 7. Bulk insert scores
  let inserted = 0;
  for (let i = 0; i < scoresToInsert.length; i += 500) {
    const chunk = scoresToInsert.slice(i, i + 500);
    const { error } = await supa.from("market_research_scores").insert(chunk);
    if (error) {
      console.error("Insert error:", error.message);
    } else {
      inserted += chunk.length;
    }
  }

  // 8. Update markets with composite score + tier
  const nowIso = new Date().toISOString();
  let updated = 0;
  for (const u of marketUpdates) {
    const { error } = await supa
      .from("market_research_markets")
      .update({ score: u.score, tier: u.tier, phase2_ran_at: nowIso })
      .eq("id", u.id);
    if (!error) updated += 1;
  }

  // 9. Count remaining
  const { count: remaining } = await supa
    .from("market_research_markets")
    .select("*", { count: "exact", head: true })
    .eq("phase", "shortlisted")
    .is("score", null);

  return new Response(
    JSON.stringify({
      ok: true,
      processed: markets.length,
      score_rows_written: inserted,
      market_updates: updated,
      remaining: remaining ?? 0,
      done: (remaining ?? 0) === 0,
      failures,
      states_fetched: [...acsByState.keys()],
      metros_seeded: ccByMetro.size,
      duration_ms: Date.now() - t0,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
