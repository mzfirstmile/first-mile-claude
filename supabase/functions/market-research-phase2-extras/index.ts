// supabase/functions/market-research-phase2-extras/index.ts
//
// Backfills 3 additional Phase 2 criteria that the original phase2 fn didn't
// score, using extra Census ACS variables.
//
// 1. Average Household Income — B19025_001E (aggregate income) / B11001_001E (households)
//    target_min = $130,000  →  score = min(10, avg/13000)
// 2. High School Graduation Rate — % of 25+ with at least HS diploma
//    = 100 × (B15003_017E + B15003_018E + ... + B15003_025E) / B15003_001E
//    target_min = 94%  →  score = min(10, pct*10/94)
// 3. 10-Year Population Growth — % change 2012→2022 ACS 5-yr
//    target band: 2-8% sweet spot. Tent function.
//
// POST body (all optional):
//   { batch_size: 200, market_ids?: [], only_unscored: true }
//
// Deploy: supabase functions deploy market-research-phase2-extras --no-verify-jwt

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

function roundTo(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function scorePopGrowth(pct: number): number {
  // Tent function: sweet spot 2-8%. Below 0 → 0, 0-2 ramps to 10, 2-8 stays 10,
  // 8-20 decays to 0, above 20 → 0 (probably bubble/sprawl).
  if (pct == null) return 0;
  if (pct < 0 || pct > 20) return 0;
  if (pct < 2) return roundTo((pct / 2) * 10, 1);
  if (pct <= 8) return 10;
  return roundTo(((20 - pct) / 12) * 10, 1);
}

async function fetchAcs(stateFips: string, varList: string, key: string, year = "2022"): Promise<any[][] | null> {
  const url =
    `https://api.census.gov/data/${year}/acs/acs5?get=NAME,${varList}` +
    `&for=place:*&in=state:${stateFips}` +
    (key ? `&key=${key}` : "");
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.error(`ACS ${year} ${stateFips}:`, String(e).slice(0, 200));
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();
  const body = await req.json().catch(() => ({} as any));
  const batchSize = Math.min(body.batch_size ?? 250, 1000);
  const onlyUnscored = body.only_unscored !== false;
  const explicitIds: string[] | undefined = body.market_ids;
  const censusKey = Deno.env.get("CENSUS_API_KEY") || "";

  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // Pull markets to process
  let q = supa.from("market_research_markets")
    .select("id,name,state,population,census_place_geoid")
    .in("tier", [1, 2, 3])
    .not("census_place_geoid", "is", null)
    .limit(batchSize);
  if (explicitIds && explicitIds.length > 0) q = q.in("id", explicitIds);
  const { data: markets, error: mErr } = await q;
  if (mErr) {
    return new Response(JSON.stringify({ error: mErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!markets || markets.length === 0) {
    return new Response(JSON.stringify({ ok: true, done: true, processed: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Look up the 3 criterion IDs
  const { data: crits } = await supa
    .from("market_research_criteria")
    .select("id,name,target_min,target_min_office")
    .in("name", ["Average Household Income", "High School Graduation Rate", "10-Year Population Growth"]);
  const critByName = new Map<string, any>();
  for (const c of crits || []) critByName.set(c.name, c);
  const cAvgHHI = critByName.get("Average Household Income");
  const cHSGrad = critByName.get("High School Graduation Rate");
  const cPopGrow = critByName.get("10-Year Population Growth");

  // Fetch ACS data per state
  const states = [...new Set(markets.map((m: any) => m.state))];
  const acs2022 = new Map<string, Map<string, any>>();
  const acs2012 = new Map<string, Map<string, any>>();

  // 2022 ACS — Avg HHI vars + HS Grad vars
  const vars2022 = "B19025_001E,B11001_001E,B15003_001E,B15003_017E,B15003_018E,B15003_019E,B15003_020E,B15003_021E,B15003_022E,B15003_023E,B15003_024E,B15003_025E";
  // 2012 ACS — just population
  const vars2012 = "B01003_001E";

  await Promise.all(states.map(async (st) => {
    const fips = STATE_FIPS[st as string];
    if (!fips) return;
    const [r22, r12] = await Promise.all([
      fetchAcs(fips, vars2022, censusKey, "2022"),
      fetchAcs(fips, vars2012, censusKey, "2012"),
    ]);
    if (r22 && r22.length > 1) {
      const header = r22[0];
      const iState = header.indexOf("state");
      const iPlace = header.indexOf("place");
      const m = new Map<string, any>();
      for (let i = 1; i < r22.length; i++) {
        const row = r22[i];
        const geoid = String(row[iState]) + String(row[iPlace]);
        m.set(geoid, {
          aggInc: parseInt(row[header.indexOf("B19025_001E")]) || 0,
          hhTot:  parseInt(row[header.indexOf("B11001_001E")]) || 0,
          eduTot: parseInt(row[header.indexOf("B15003_001E")]) || 0,
          hsPlus: ["017", "018", "019", "020", "021", "022", "023", "024", "025"]
            .reduce((s, n) => s + (parseInt(row[header.indexOf(`B15003_${n}E`)]) || 0), 0),
        });
      }
      acs2022.set(st as string, m);
    }
    if (r12 && r12.length > 1) {
      const header = r12[0];
      const iState = header.indexOf("state");
      const iPlace = header.indexOf("place");
      const iPop   = header.indexOf("B01003_001E");
      const m = new Map<string, any>();
      for (let i = 1; i < r12.length; i++) {
        const row = r12[i];
        const geoid = String(row[iState]) + String(row[iPlace]);
        m.set(geoid, { pop2012: parseInt(row[iPop]) || 0 });
      }
      acs2012.set(st as string, m);
    }
  }));

  // Score each market
  const scoresToInsert: any[] = [];
  let scored = 0;
  for (const m of markets as any[]) {
    const state22 = acs2022.get(m.state);
    const state12 = acs2012.get(m.state);
    const d22 = state22?.get(m.census_place_geoid);
    const d12 = state12?.get(m.census_place_geoid);

    // 1. Average HHI
    if (cAvgHHI && d22 && d22.hhTot > 0 && d22.aggInc > 0) {
      const avg = d22.aggInc / d22.hhTot;
      const tgtR = cAvgHHI.target_min ?? 130000;
      const tgtO = cAvgHHI.target_min_office ?? tgtR;
      scoresToInsert.push({
        market_id: m.id, criterion_id: cAvgHHI.id,
        value_numeric: roundTo(Math.min(10, avg / tgtR * 10), 1),
        value_numeric_office: roundTo(Math.min(10, avg / tgtO * 10), 1),
        raw_value: avg,
        value_text: "$" + Math.round(avg).toLocaleString(),
        source: "https://data.census.gov/ (B19025/B11001 — agg income/households)",
        updated_by: "phase2_auto",
      });
    }
    // 2. HS Graduation Rate
    if (cHSGrad && d22 && d22.eduTot > 0) {
      const pct = (d22.hsPlus / d22.eduTot) * 100;
      const tgtR = cHSGrad.target_min ?? 94;
      const tgtO = cHSGrad.target_min_office ?? tgtR;
      scoresToInsert.push({
        market_id: m.id, criterion_id: cHSGrad.id,
        value_numeric: roundTo(Math.min(10, pct / tgtR * 10), 1),
        value_numeric_office: roundTo(Math.min(10, pct / tgtO * 10), 1),
        raw_value: pct,
        value_text: pct.toFixed(1) + "%",
        source: "https://data.census.gov/ (B15003 — educational attainment)",
        updated_by: "phase2_auto",
      });
    }
    // 3. 10-Year Population Growth
    if (cPopGrow && d12 && d12.pop2012 > 0 && m.population > 0) {
      const pct = ((m.population - d12.pop2012) / d12.pop2012) * 100;
      const sc = scorePopGrowth(pct);
      scoresToInsert.push({
        market_id: m.id, criterion_id: cPopGrow.id,
        value_numeric: sc,
        value_numeric_office: sc,
        raw_value: pct,
        value_text: pct.toFixed(1) + "% (" + d12.pop2012.toLocaleString() + " → " + m.population.toLocaleString() + ")",
        source: "https://data.census.gov/ (ACS 2012 vs 2022 5-year, B01003)",
        updated_by: "phase2_auto",
      });
    }
    if (state22) scored++;
  }

  // Delete any existing rows for these (market, criterion) pairs first, then insert
  const critIds = [cAvgHHI?.id, cHSGrad?.id, cPopGrow?.id].filter(Boolean);
  const marketIds = markets.map((m: any) => m.id);
  await supa.from("market_research_scores").delete()
    .in("market_id", marketIds).in("criterion_id", critIds);
  let inserted = 0;
  for (let i = 0; i < scoresToInsert.length; i += 500) {
    const chunk = scoresToInsert.slice(i, i + 500);
    const { error } = await supa.from("market_research_scores").insert(chunk);
    if (!error) inserted += chunk.length;
    else console.error("insert error:", error.message);
  }

  return new Response(JSON.stringify({
    ok: true, processed: markets.length, scored, score_rows_written: inserted,
    states: [...acs2022.keys()], duration_ms: Date.now() - t0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
