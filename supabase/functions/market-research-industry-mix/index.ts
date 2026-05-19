// supabase/functions/market-research-industry-mix/index.ts
//
// Scores '% of market that is Office' and '% of market that is Retail' using
// Census ACS table C24030 ("Sex by Industry"), which gives place-level
// employment by NAICS sector. BLS QCEW would give county-level data with
// more sector granularity but the place-level join is messier and adds 24h
// of work mapping markets → counties. C24030 is good enough.
//
// Office sectors = NAICS 52 (Finance), 53 (Real Estate), 54 (Professional),
//                  55 (Mgmt of Companies), 56 (Admin & Support).
// Retail sectors = NAICS 44-45 (Retail Trade).
//
// C24030 sub-variables we sum:
//   Office: 033 (Finance) + 036 (Real Estate) + 039 (Pro) + 042 (Mgmt) + 043 (Admin)
//   Retail: 028 (Retail Trade)
//
// Score formula: pct/target * 10, capped at 10. Target = 10% for both.
// Stores raw_value = pct so per-criterion re-score works on target edits.
//
// POST body: { batch_size: 250, market_ids?: [], only_unscored: true }
//
// Deploy: supabase functions deploy market-research-industry-mix --no-verify-jwt

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

// C24030 sub-variables. Lengthy list — but ACS API accepts up to ~50 vars per call.
const OFFICE_VARS = ["C24030_033E", "C24030_036E", "C24030_039E", "C24030_042E", "C24030_043E"];
const RETAIL_VAR = "C24030_028E";
const TOTAL_VAR = "C24030_001E";
const ALL_VARS = [TOTAL_VAR, RETAIL_VAR, ...OFFICE_VARS].join(",");

function roundTo(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

async function fetchAcs(stateFips: string, key: string): Promise<Map<string, any> | null> {
  const url = `https://api.census.gov/data/2022/acs/acs5?get=NAME,${ALL_VARS}` +
              `&for=place:*&in=state:${stateFips}` + (key ? `&key=${key}` : "");
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const json = await r.json();
    if (!Array.isArray(json) || json.length < 2) return null;
    const header = json[0];
    const iState = header.indexOf("state");
    const iPlace = header.indexOf("place");
    const iTot   = header.indexOf(TOTAL_VAR);
    const iRet   = header.indexOf(RETAIL_VAR);
    const officeIdxs = OFFICE_VARS.map(v => header.indexOf(v));
    const m = new Map<string, any>();
    for (let i = 1; i < json.length; i++) {
      const row = json[i];
      const geoid = String(row[iState]) + String(row[iPlace]);
      const total  = parseInt(row[iTot]) || 0;
      const retail = parseInt(row[iRet]) || 0;
      const office = officeIdxs.reduce((s, idx) => s + (parseInt(row[idx]) || 0), 0);
      m.set(geoid, { total, office, retail });
    }
    return m;
  } catch (e) {
    console.error("ACS", stateFips, String(e).slice(0, 200));
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();
  const body = await req.json().catch(() => ({} as any));
  const batchSize = Math.min(body.batch_size ?? 250, 1000);
  const explicitIds: string[] | undefined = body.market_ids;
  const censusKey = Deno.env.get("CENSUS_API_KEY") || "";

  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // Fetch markets to score
  let q = supa.from("market_research_markets")
    .select("id,name,state,census_place_geoid")
    .in("tier", [1, 2, 3])
    .not("census_place_geoid", "is", null)
    .limit(batchSize);
  if (explicitIds && explicitIds.length > 0) q = q.in("id", explicitIds);
  const { data: markets, error: mErr } = await q;
  if (mErr) return new Response(JSON.stringify({ error: mErr.message }),
    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (!markets || markets.length === 0)
    return new Response(JSON.stringify({ ok: true, done: true, processed: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Look up the 2 criterion IDs
  const { data: crits } = await supa.from("market_research_criteria")
    .select("id,name,target_min,target_min_office")
    .in("name", ["% of market that is Office", "% of market that is Retail"]);
  const critByName = new Map<string, any>();
  for (const c of crits || []) critByName.set(c.name, c);
  const cOffice = critByName.get("% of market that is Office");
  const cRetail = critByName.get("% of market that is Retail");

  // Fetch ACS per state
  const states = [...new Set(markets.map((m: any) => m.state))];
  const acsByState = new Map<string, Map<string, any>>();
  await Promise.all(states.map(async (st) => {
    const fips = STATE_FIPS[st as string];
    if (!fips) return;
    const m = await fetchAcs(fips, censusKey);
    if (m) acsByState.set(st as string, m);
  }));

  const scoresToInsert: any[] = [];
  for (const m of markets as any[]) {
    const stateAcs = acsByState.get(m.state);
    const acs = stateAcs?.get(m.census_place_geoid);
    if (!acs || acs.total <= 0) continue;
    const pctOffice = (acs.office / acs.total) * 100;
    const pctRetail = (acs.retail / acs.total) * 100;

    if (cOffice) {
      const tgtR = cOffice.target_min ?? 10;
      const tgtO = cOffice.target_min_office ?? tgtR;
      scoresToInsert.push({
        market_id: m.id, criterion_id: cOffice.id,
        value_numeric: roundTo(Math.min(10, pctOffice / tgtR * 10), 1),
        value_numeric_office: roundTo(Math.min(10, pctOffice / tgtO * 10), 1),
        raw_value: pctOffice,
        value_text: pctOffice.toFixed(1) + "%",
        source: "https://data.census.gov/ (ACS C24030 — Finance/Real Estate/Pro/Mgmt/Admin)",
        updated_by: "phase2_auto",
      });
    }
    if (cRetail) {
      const tgtR = cRetail.target_min ?? 10;
      const tgtO = cRetail.target_min_office ?? tgtR;
      scoresToInsert.push({
        market_id: m.id, criterion_id: cRetail.id,
        value_numeric: roundTo(Math.min(10, pctRetail / tgtR * 10), 1),
        value_numeric_office: roundTo(Math.min(10, pctRetail / tgtO * 10), 1),
        raw_value: pctRetail,
        value_text: pctRetail.toFixed(1) + "%",
        source: "https://data.census.gov/ (ACS C24030_028E — Retail Trade)",
        updated_by: "phase2_auto",
      });
    }
  }

  // Wipe + insert
  const critIds = [cOffice?.id, cRetail?.id].filter(Boolean);
  const marketIds = markets.map((m: any) => m.id);
  await supa.from("market_research_scores").delete()
    .in("market_id", marketIds).in("criterion_id", critIds);
  let inserted = 0;
  for (let i = 0; i < scoresToInsert.length; i += 500) {
    const chunk = scoresToInsert.slice(i, i + 500);
    const { error } = await supa.from("market_research_scores").insert(chunk);
    if (!error) inserted += chunk.length;
    else console.error("insert:", error.message);
  }

  return new Response(JSON.stringify({
    ok: true, processed: markets.length, score_rows_written: inserted,
    states: [...acsByState.keys()], duration_ms: Date.now() - t0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
