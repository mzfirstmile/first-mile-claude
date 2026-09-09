// supabase/functions/market-research-office-demand/index.ts
//
// Scores the "Office Demand" category (office view only) from Census ACS
// WORKPLACE-geography tables — i.e. jobs located IN the town, not where
// residents commute to. Everything else in Phase 2 is residence-based, which
// is why the office view previously had no town-level office signal.
//
// Sources (all ACS 5-year, place level, one API call per table per state):
//   S0804  Means of Transportation to Work by Selected Characteristics for
//          WORKPLACE Geography. C01_001E = workers 16+ whose workplace is in
//          the place. INDUSTRY sub-rows are PERCENT of that total.
//          Office-using sectors = Information (NAICS 51) + Finance/insurance/
//          real estate (52-53) + Professional/scientific/management/
//          administrative (54-56).
//   B08301 Means of Transportation to Work (RESIDENCE geography).
//          _001E = employed residents 16+, "Worked from home" row = WFH count.
//
// Criteria written (updated_by = 'phase2_office'):
//   1. Office-Using Jobs in Town        = S0804 total × office share      target 5,000
//   2. Office Share of Local Jobs       = office % of in-town jobs         target 35%
//   3. Jobs-to-Resident-Workers Ratio   = S0804 total / B08301 total       target 1.0
//   4. Office Job Growth (5-yr)         = 2013-17 → 2018-22 office jobs   ≤−15%→0 … ≥+10%→10
//   5. Resident Remote-Work Share       = WFH / employed residents         target 25%
//
// Variable IDs are resolved at runtime from the ACS group metadata
// (groups/S0804.json, groups/B08301.json) by label match, so a Census
// re-numbering won't silently score the wrong column.
//
// POST body (all optional):
//   { states?: ["NJ","CT"], max_states?: 6, market_ids?: [], year?: "2022", base_year?: "2017" }
//   With no `states`, picks up to max_states states that still have shortlisted
//   markets without Office Demand rows. Loop until remaining_states is empty.
//
// Returns: { ok, states_done, processed, score_rows_written, remaining_states, errors, duration_ms }
//
// AFTER a full run: the composite must be recomputed (Update Rankings button
// or the canonical SQL in market-research.js _scheduleRecomputeAll) — this
// function writes score rows only.
//
// Deploy: supabase functions deploy market-research-office-demand --no-verify-jwt

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

const CRITERIA = {
  jobs: "Office-Using Jobs in Town",
  share: "Office Share of Local Jobs",
  ratio: "Jobs-to-Resident-Workers Ratio",
  growth: "Office Job Growth (5-yr)",
  wfh: "Resident Remote-Work Share",
};
const UPDATED_BY = "phase2_office";

function roundTo(n: number, d = 1): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}
function linScore(value: number, target: number): number {
  if (!(target > 0) || !(value >= 0)) return 0;
  return roundTo(Math.min(10, (value / target) * 10), 1);
}
function growthScore(pct: number): number {
  // ≤ −15% → 0 ; linear to +10% → 10 ; ≥ +10% → 10
  if (pct == null || !isFinite(pct)) return 0;
  if (pct <= -15) return 0;
  if (pct >= 10) return 10;
  return roundTo(((pct + 15) / 25) * 10, 1);
}
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtPct = (n: number) => n.toFixed(1) + "%";

// ── ACS variable resolution ────────────────────────────────────────────────
interface S0804Vars { total: string; office: string[] }
interface B08301Vars { total: string; wfh: string }

async function fetchJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) { console.error("HTTP", r.status, url.slice(0, 120)); return null; }
    return await r.json();
  } catch (e) {
    console.error("fetch failed:", url.slice(0, 120), String(e).slice(0, 200));
    return null;
  }
}

async function resolveS0804(year: string): Promise<S0804Vars | { error: string; labels: Record<string, string> } | null> {
  const g = await fetchJson(`https://api.census.gov/data/${year}/acs/acs5/subject/groups/S0804.json`);
  if (!g?.variables) return null;
  let total = "";
  const office: string[] = [];
  const c01: Record<string, string> = {};
  for (const [id, v] of Object.entries<any>(g.variables)) {
    if (!/^S0804_C01_\d+E$/.test(id)) continue;           // C01 = Total column, estimates only
    const label: string = (v.label || "").replace(/:/g, "");
    c01[id] = label;
    const segs = label.split("!!");
    const leaf = (segs.pop() || "").trim();
    // Total row: first C01 estimate, or the "Workers 16 years and over" row with no deeper segments
    if (id === "S0804_C01_001E" || (segs.length <= 2 && /^Workers 16 years and over/i.test(leaf))) { if (!total) total = id; continue; }
    if (!/INDUSTRY/i.test(label)) continue;
    if (/^Information$/i.test(leaf) ||
        /^Finance and insurance/i.test(leaf) ||
        /^Professional, scientific/i.test(leaf)) {
      office.push(id);
    }
  }
  if (!total || office.length !== 3) {
    console.error(`S0804 ${year}: resolved total=${total} office=${office.join(",")}`);
    return { error: `S0804 ${year}: total=${total || "none"} office=[${office.join(",")}]`, labels: c01 };
  }
  return { total, office };
}

async function resolveB08301(year: string): Promise<B08301Vars | null> {
  const g = await fetchJson(`https://api.census.gov/data/${year}/acs/acs5/groups/B08301.json`);
  if (!g?.variables) return null;
  let total = "", wfh = "";
  for (const [id, v] of Object.entries<any>(g.variables)) {
    if (!/^B08301_\d+E$/.test(id)) continue;
    const label: string = (v.label || "").replace(/:/g, "");
    if (/^Estimate!!Total$/.test(label)) total = id;
    else if (/^Estimate!!Total!!Worked from home$/.test(label)) wfh = id;
  }
  if (!total || !wfh) { console.error(`B08301 ${year}: total=${total} wfh=${wfh}`); return null; }
  return { total, wfh };
}

// Returns Map<geoid7, number[]> for the requested vars (same order), NaN-free.
async function fetchPlaces(year: string, dataset: string, vars: string[], fips: string, key: string): Promise<Map<string, number[]> | null> {
  const url = `https://api.census.gov/data/${year}/acs/acs5${dataset}?get=${vars.join(",")}&for=place:*&in=state:${fips}` + (key ? `&key=${key}` : "");
  const rows = await fetchJson(url);
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const header: string[] = rows[0];
  const iState = header.indexOf("state"), iPlace = header.indexOf("place");
  const idx = vars.map((v) => header.indexOf(v));
  const out = new Map<string, number[]>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const geoid = String(row[iState]).padStart(2, "0") + String(row[iPlace]).padStart(5, "0");
    out.set(geoid, idx.map((j) => {
      const n = parseFloat(row[j]);
      // Census null sentinels are large negatives (-666666666 etc.)
      return isFinite(n) && n > -1000 ? n : NaN;
    }));
  }
  return out;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const body = await req.json().catch(() => ({} as any));
  const year: string = body.year || "2022";
  const baseYear: string = body.base_year || "2017";
  const maxStates: number = Math.max(1, Math.min(15, body.max_states ?? 6));
  const explicitIds: string[] | undefined = body.market_ids;
  const censusKey = Deno.env.get("CENSUS_API_KEY") || "";

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Criteria ids + office targets
  const { data: crits, error: cErr } = await supa
    .from("market_research_criteria")
    .select("id,name,target_min_office")
    .in("name", Object.values(CRITERIA));
  if (cErr) return json({ error: cErr.message }, 500);
  const crit = new Map<string, any>();
  for (const c of crits || []) crit.set(c.name, c);
  const missing = Object.values(CRITERIA).filter((n) => !crit.has(n));
  if (missing.length) return json({ error: "criteria missing — run migration/add-office-demand-category.sql", missing }, 500);
  const critIds = Object.values(CRITERIA).map((n) => crit.get(n).id);
  const tgtJobs = crit.get(CRITERIA.jobs).target_min_office ?? 5000;
  const tgtShare = crit.get(CRITERIA.share).target_min_office ?? 35;
  const tgtRatio = crit.get(CRITERIA.ratio).target_min_office ?? 1.0;
  const tgtWfh = crit.get(CRITERIA.wfh).target_min_office ?? 25;

  // Which markets?
  let markets: any[] = [];
  let remainingStates: string[] = [];
  if (explicitIds?.length) {
    const { data } = await supa.from("market_research_markets")
      .select("id,name,state,census_place_geoid").in("id", explicitIds).not("census_place_geoid", "is", null);
    markets = data || [];
  } else {
    // All shortlisted markets (paginate past the 1000-row cap)
    const all: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await supa.from("market_research_markets")
        .select("id,name,state,census_place_geoid").eq("phase", "shortlisted")
        .not("census_place_geoid", "is", null).order("id").range(off, off + 999);
      if (error) return json({ error: error.message }, 500);
      all.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    let states: string[];
    if (Array.isArray(body.states) && body.states.length) {
      states = body.states.map((s: string) => s.toUpperCase());
    } else {
      // States still lacking Office Demand rows
      const done = new Set<string>();
      for (let off = 0; ; off += 1000) {
        const { data } = await supa.from("market_research_scores").select("market_id")
          .eq("updated_by", UPDATED_BY).eq("criterion_id", crit.get(CRITERIA.share).id).range(off, off + 999);
        for (const r of data || []) done.add(r.market_id);
        if (!data || data.length < 1000) break;
      }
      const todo = [...new Set(all.filter((m) => !done.has(m.id)).map((m) => m.state))].sort();
      states = todo.slice(0, maxStates);
      remainingStates = todo.slice(maxStates);
    }
    const set = new Set(states);
    markets = all.filter((m) => set.has(m.state));
    if (!explicitIds && !body.states) {
      // nothing left
      if (markets.length === 0) return json({ ok: true, done: true, states_done: [], processed: 0, remaining_states: [] });
    }
  }
  if (markets.length === 0) return json({ ok: true, done: true, processed: 0, states_done: [] });

  // Resolve ACS variable ids (metadata is small — one fetch per table/year)
  const [r22, r17, b22] = await Promise.all([resolveS0804(year), resolveS0804(baseYear), resolveB08301(year)]);
  if (!r22 || "error" in r22 || !b22) {
    return json({ error: `could not resolve ACS variables (S0804 ${year}: ${r22 ? ("error" in r22 ? r22.error : "ok") : "fetch failed"}, B08301 ${year}: ${!!b22})`,
                  s0804_labels: r22 && "error" in r22 ? r22.labels : undefined }, 502);
  }
  const s22 = r22 as S0804Vars;
  const s17 = r17 && !("error" in r17) ? (r17 as S0804Vars) : null;
  if (body.debug) return json({ ok: true, debug: true, s0804: s22, s0804_base: s17, b08301: b22 });

  const states = [...new Set(markets.map((m) => m.state))];
  const errors: string[] = [];
  const work = new Map<string, Map<string, number[]>>();   // state → S0804 year
  const workBase = new Map<string, Map<string, number[]>>(); // state → S0804 baseYear
  const res = new Map<string, Map<string, number[]>>();    // state → B08301 year

  await Promise.all(states.map(async (st) => {
    const fips = STATE_FIPS[st];
    if (!fips) { errors.push(`no FIPS for ${st}`); return; }
    const [w, wb, r] = await Promise.all([
      fetchPlaces(year, "/subject", [s22.total, ...s22.office], fips, censusKey),
      s17 ? fetchPlaces(baseYear, "/subject", [s17.total, ...s17.office], fips, censusKey) : Promise.resolve(null),
      fetchPlaces(year, "", [b22.total, b22.wfh], fips, censusKey),
    ]);
    if (w) work.set(st, w); else errors.push(`S0804 ${year} fetch failed for ${st}`);
    if (wb) workBase.set(st, wb);
    if (r) res.set(st, r); else errors.push(`B08301 ${year} fetch failed for ${st}`);
  }));

  const src = (tbl: string) => `https://data.census.gov/table/ACSST5Y${year}.${tbl} (ACS 5-yr ${tbl}, place level)`;
  const rows: any[] = [];
  let processed = 0;
  for (const m of markets) {
    const w = work.get(m.state)?.get(m.census_place_geoid);
    const r = res.get(m.state)?.get(m.census_place_geoid);
    if (!w && !r) continue;
    processed++;

    let jobsTotal = NaN, officeJobs = NaN, officeShare = NaN;
    if (w && isFinite(w[0])) {
      jobsTotal = w[0];
      const pct = w.slice(1).filter(isFinite).reduce((a, b) => a + b, 0); // sub-rows are % of total
      if (w.slice(1).some(isFinite)) { officeShare = pct; officeJobs = jobsTotal * pct / 100; }
    }
    let resWorkers = NaN, wfhPct = NaN;
    if (r && isFinite(r[0]) && r[0] > 0) {
      resWorkers = r[0];
      if (isFinite(r[1])) wfhPct = (r[1] / r[0]) * 100;
    }

    const push = (name: string, score: number, raw: number, text: string, source: string) => {
      rows.push({
        market_id: m.id, criterion_id: crit.get(name).id,
        value_numeric: null,                 // office-view-only criterion
        value_numeric_office: score,
        raw_value: isFinite(raw) ? roundTo(raw, 3) : null,
        value_text: text, source, updated_by: UPDATED_BY,
      });
    };

    if (isFinite(officeJobs)) {
      push(CRITERIA.jobs, linScore(officeJobs, tgtJobs), officeJobs,
        `${fmtInt(officeJobs)} office jobs of ${fmtInt(jobsTotal)} in town`, src("S0804"));
      push(CRITERIA.share, linScore(officeShare, tgtShare), officeShare,
        `${fmtPct(officeShare)} of in-town jobs are office-using`, src("S0804"));
    }
    if (isFinite(jobsTotal) && isFinite(resWorkers) && resWorkers > 0) {
      const ratio = jobsTotal / resWorkers;
      push(CRITERIA.ratio, linScore(ratio, tgtRatio), ratio,
        `${ratio.toFixed(2)}× (${fmtInt(jobsTotal)} jobs in town ÷ ${fmtInt(resWorkers)} employed residents)`, `${src("S0804")} ÷ ${src("B08301")}`);
    }
    const wb = workBase.get(m.state)?.get(m.census_place_geoid);
    if (wb && isFinite(wb[0]) && wb[0] > 0 && wb.slice(1).some(isFinite) && isFinite(officeJobs)) {
      const basePct = wb.slice(1).filter(isFinite).reduce((a, b) => a + b, 0);
      const baseJobs = wb[0] * basePct / 100;
      if (baseJobs >= 100) { // tiny bases make growth % meaningless
        const g = ((officeJobs - baseJobs) / baseJobs) * 100;
        push(CRITERIA.growth, growthScore(g), g,
          `${g >= 0 ? "+" : ""}${g.toFixed(1)}% (${fmtInt(baseJobs)} → ${fmtInt(officeJobs)} office jobs, ACS ${baseYear}→${year})`,
          `https://data.census.gov/table/ACSST5Y${baseYear}.S0804 vs ACSST5Y${year}.S0804`);
      }
    }
    if (isFinite(wfhPct)) {
      push(CRITERIA.wfh, linScore(wfhPct, tgtWfh), wfhPct,
        `${fmtPct(wfhPct)} of employed residents work from home`, src("B08301"));
    }
  }

  // Replace prior rows for these markets × criteria, then insert
  const marketIds = markets.map((m) => m.id);
  for (let i = 0; i < marketIds.length; i += 200) {
    const { error } = await supa.from("market_research_scores").delete()
      .in("market_id", marketIds.slice(i, i + 200)).in("criterion_id", critIds);
    if (error) errors.push("delete: " + error.message);
  }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supa.from("market_research_scores").insert(chunk);
    if (error) errors.push("insert: " + error.message); else inserted += chunk.length;
  }

  return json({
    ok: true, states_done: states, processed, markets_in_scope: markets.length,
    score_rows_written: inserted, remaining_states: remainingStates,
    acs_vars: { s0804_total: s22.total, s0804_office: s22.office, b08301: b22 },
    errors, duration_ms: Date.now() - t0,
  });
});
