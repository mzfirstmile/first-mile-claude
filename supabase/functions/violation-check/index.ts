// violation-check — daily NYC violation sweep for the Violation Tracker module.
//
// For every active, NYC-covered row in `violation_properties` it queries NYC Open Data
// (Socrata, no credentials) and upserts one `violations` row per agency record:
//   dob_bis  DOB Violations (BIS)            3h2n-5cm9   by BIN
//   dob_ecb  DOB ECB Violations              6bgk-3dad   by BIN
//   dob_now  DOB Safety Violations (DOB NOW) 855j-jady   by BIN
//   oath     OATH Hearings Division cases    jz4z-kudi   by boro/block/lot (all agencies except FDNY;
//                                                        DOB tickets already in ECB are skipped)
//   fdny     FDNY summonses heard at OATH    jz4z-kudi   issuing_agency = FIRE DEPARTMENT OF NYC
// Not reachable without credentials: CityPay (payment portal only — balances come from the
// ECB / OATH balance_due fields) and FDNY violation orders (FDNY's open-data copy, bi53-yph3,
// stopped updating in 2019; current orders are only in the FDNY Business account portal).
//
// Open records missing from a source's latest response are closed. Per-property summary
// (health, counts, $ due, next hearing) is written back to violation_properties.
//
// POST {}                                   → check all active properties (cron)
// POST {property_ids:[uuid…], trigger}      → check some
// POST {action:'lookup', address}           → NYC GeoSearch → [{label,bbl,bin,borough,block,lot}]
// POST {action:'lookup_bbl', bbl}           → PLUTO + GeoSearch → same shape
// Secrets: SB_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY); optional NYC_OPEN_DATA_APP_TOKEN.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SB_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SODA = "https://data.cityofnewyork.us/resource";
const APP_TOKEN = Deno.env.get("NYC_OPEN_DATA_APP_TOKEN") || "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const BORO_NAME: Record<string, string> = { "1": "MANHATTAN", "2": "BRONX", "3": "BROOKLYN", "4": "QUEENS", "5": "STATEN IS" };
const BORO_LABEL: Record<string, string> = { "1": "Manhattan", "2": "Bronx", "3": "Brooklyn", "4": "Queens", "5": "Staten Island" };

type Row = Record<string, any>;

async function soda(dataset: string, where: string, limit = 5000): Promise<Row[]> {
  const u = new URL(`${SODA}/${dataset}.json`);
  u.searchParams.set("$where", where);
  u.searchParams.set("$limit", String(limit));
  const h: Record<string, string> = { Accept: "application/json" };
  if (APP_TOKEN) h["X-App-Token"] = APP_TOKEN;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(u, { headers: h });
    if (r.ok) return await r.json();
    if (r.status >= 500 || r.status === 429) { await new Promise((res) => setTimeout(res, 1500 * (attempt + 1))); continue; }
    throw new Error(`${dataset} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error(`${dataset}: retries exhausted`);
}

const q = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const num = (v: any) => { const n = Number(v); return v == null || v === "" || isNaN(n) ? null : n; };
const pos = (v: any) => { const n = num(v); return n == null ? null : Math.max(0, n); };
function ymd(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) { const d = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; return /^(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d) ? d : null; }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null;
}
const clean = (s: any) => (s == null ? null : String(s).replace(/\s{2,}/g, " ").trim() || null);
const normTicket = (s: string) => String(s || "").trim().toUpperCase().replace(/^0+/, "");
function splitBbl(bbl: string) {
  const s = String(bbl || "").replace(/\D/g, "");
  if (s.length !== 10) return null;
  return { boro: s[0], block: s.slice(1, 6), lot: s.slice(6, 10) };
}

// ── agency links ───────────────────────────────────────────
const BIS_LOC = (bin: string) => `https://a810-bisweb.nyc.gov/bisweb/ActionsByLocationServlet?requestid=1&allbin=${bin}&allinquirytype=BXS4OCV3`;
const ECB_NUM = (n: string) => `https://a810-bisweb.nyc.gov/bisweb/ECBQueryByNumberServlet?requestid=2&ecbin=${encodeURIComponent(n)}`;
const DOBNOW = () => `https://a810-dobnow.nyc.gov/publish/Index.html#!/`;
const OATH_TICKET = (t: string) => `https://a820-ecbticketfinder.nyc.gov/getViolationbyID.action?searchViolationObject.violationNo=${encodeURIComponent(t)}&searchViolationObject.searchType=violationNumber&submit=Search`;

// ── mappers ────────────────────────────────────────────────
function mapBis(r: Row) {
  const cat = String(r.violation_category || "");
  const deleted = /^DELETED/i.test(String(r.disposition_comments || ""));
  const open = /ACTIVE/i.test(cat) && !deleted;
  return {
    source: "dob_bis", source_id: String(r.isn_dob_bis_viol || r.number),
    status: open ? "open" : "closed", source_status: clean(cat) + (deleted ? " (deleted)" : ""),
    issue_date: ymd(r.issue_date), violation_type: clean(r.violation_type), description: clean(r.description) || clean(r.violation_type),
    class_severity: clean(r.violation_type_code), is_hazardous: false, penalty: null, balance_due: null,
    hearing_date: null, hearing_status: null, issuing_agency: "DOB", bin: r.bin, bbl: r.boro && r.block && r.lot ? `${r.boro}${String(r.block).padStart(5, "0")}${String(r.lot).slice(-4).padStart(4, "0")}` : null,
    agency_url: BIS_LOC(r.bin), raw: r,
  };
}
function mapEcb(r: Row) {
  const open = String(r.ecb_violation_status || "").toUpperCase() === "ACTIVE";
  const sev = clean(r.severity);
  return {
    source: "dob_ecb", source_id: String(r.ecb_violation_number),
    status: open ? "open" : "closed", source_status: clean(r.ecb_violation_status) + (r.certification_status ? ` · ${clean(r.certification_status)}` : ""),
    issue_date: ymd(r.issue_date), violation_type: clean(r.violation_type), description: clean(r.violation_description) || clean(r.section_law_description1),
    class_severity: sev, is_hazardous: open && /CLASS - 1|^HAZARDOUS|IMMEDIATELY/i.test(sev || ""),
    penalty: num(r.penality_imposed), balance_due: pos(r.balance_due),
    hearing_date: ymd(r.hearing_date), hearing_status: clean(r.hearing_status), issuing_agency: "DOB (ECB)", bin: r.bin,
    bbl: r.boro && r.block && r.lot ? `${r.boro}${String(r.block).padStart(5, "0")}${String(r.lot).slice(-4).padStart(4, "0")}` : null,
    agency_url: ECB_NUM(r.ecb_violation_number), raw: r,
  };
}
function mapDobNow(r: Row) {
  const open = String(r.violation_status || "").toLowerCase() === "active";
  const t = clean(r.violation_type) || "";
  return {
    source: "dob_now", source_id: String(r.violation_number),
    status: open ? "open" : "closed", source_status: clean(r.violation_status),
    issue_date: ymd(r.violation_issue_date), violation_type: t, description: clean(r.violation_remarks) || t,
    class_severity: clean(r.device_type), is_hazardous: open && /(^|-)HAZ(-|$)|UNSAFE/i.test(t),
    penalty: null, balance_due: null, hearing_date: null, hearing_status: null, issuing_agency: "DOB NOW", bin: r.bin, bbl: r.bbl || null,
    agency_url: DOBNOW(), raw: r,
  };
}
const OATH_OPEN = /NEW ISSUANCE|RESCHEDULED|ADJOURN|PENDING|SCHEDULED|STAYED|APPEAL PENDING/i;
const OATH_CLOSED = /PAID IN FULL|WRITTEN OFF|DISMISS|CLOSED/i;
function mapOath(r: Row) {
  const agency = clean(r.issuing_agency) || "Unknown agency";
  const fdny = /^FIRE DEP/i.test(agency);
  const bal = pos(r.balance_due) || 0;
  const hs = String(r.hearing_status || "");
  const hd = ymd(r.hearing_date);
  const today = new Date().toISOString().slice(0, 10);
  const open = !OATH_CLOSED.test(hs) && (bal > 0 || OATH_OPEN.test(hs) || (!!hd && hd >= today && !/COMPLETED/i.test(hs)));
  const charges = [1, 2, 3].map((i) => clean(r[`charge_${i}_code_description`])).filter(Boolean);
  return {
    source: fdny ? "fdny" : "oath", source_id: String(r.ticket_number),
    status: open ? "open" : "closed", source_status: clean(hs) + (r.compliance_status ? ` · ${clean(r.compliance_status)}` : ""),
    issue_date: ymd(r.violation_date), violation_type: clean(r.charge_1_code_section) ? `${agency} §${clean(r.charge_1_code_section)}` : agency,
    description: (charges.join("; ") || clean(r.violation_description) || agency) + (r.respondent_last_name ? ` — respondent: ${clean(r.respondent_last_name)}` : ""),
    class_severity: clean(r.hearing_result), is_hazardous: false,
    penalty: num(r.penalty_imposed) ?? num(r.total_violation_amount), balance_due: bal,
    hearing_date: hd, hearing_status: clean(hs), issuing_agency: agency, bin: null,
    bbl: null, agency_url: OATH_TICKET(r.ticket_number), raw: r,
  };
}

// ── one property ───────────────────────────────────────────
async function checkProperty(p: Row) {
  const errors: string[] = [];
  const bins = [p.bin, ...(p.alt_bins || [])].map((b) => String(b || "").trim()).filter((b) => /^\d{7}$/.test(b));
  const lotKeys = new Map<string, { boro: string; block: string; lot: string }>();
  for (const b of [p.bbl, ...(p.alt_bbls || [])]) { const s = splitBbl(b); if (s) lotKeys.set(`${s.boro}${s.block}${s.lot}`, s); }

  const okSources = new Set<string>();
  let records: Row[] = [];
  if (bins.length) {
    const inBins = `bin in(${bins.map(q).join(",")})`;
    const [bis, ecb, now] = await Promise.allSettled([soda("3h2n-5cm9", inBins), soda("6bgk-3dad", inBins), soda("855j-jady", inBins)]);
    if (bis.status === "fulfilled") { okSources.add("dob_bis"); records.push(...bis.value.map(mapBis)); for (const r of bis.value) { if (r.boro && r.block && r.lot) { const s = { boro: String(r.boro), block: String(r.block).padStart(5, "0"), lot: String(r.lot).slice(-4).padStart(4, "0") }; lotKeys.set(`${s.boro}${s.block}${s.lot}`, s); } } } else errors.push(`dob_bis: ${bis.reason}`);
    if (ecb.status === "fulfilled") { okSources.add("dob_ecb"); records.push(...ecb.value.map(mapEcb)); for (const r of ecb.value) { if (r.boro && r.block && r.lot) { const s = { boro: String(r.boro), block: String(r.block).padStart(5, "0"), lot: String(r.lot).slice(-4).padStart(4, "0") }; lotKeys.set(`${s.boro}${s.block}${s.lot}`, s); } } } else errors.push(`dob_ecb: ${ecb.reason}`);
    if (now.status === "fulfilled") { okSources.add("dob_now"); records.push(...now.value.map(mapDobNow)); } else errors.push(`dob_now: ${now.reason}`);
  } else errors.push("no BIN — DOB sources skipped");

  // OATH (+FDNY) by every boro/block/lot we know for the site (condo base + billing lots included).
  // OATH stores lots both as 4- and 5-digit strings ('0035' and '00035').
  if (lotKeys.size) {
    const clauses = [...lotKeys.values()].map((s) => `(violation_location_borough=${q(BORO_NAME[s.boro])} AND violation_location_block_no=${q(s.block)} AND violation_location_lot_no in(${q(s.lot)},${q("0" + s.lot)}))`);
    try {
      const rows = await soda("jz4z-kudi", clauses.join(" OR "));
      const ecbNums = new Set(records.filter((r) => r.source === "dob_ecb").map((r) => normTicket(r.source_id)));
      records.push(...rows.filter((r) => r.ticket_number && !ecbNums.has(normTicket(r.ticket_number))).map(mapOath));
      okSources.add("oath"); okSources.add("fdny");
    } catch (e) { errors.push(`oath: ${e}`); }
  } else errors.push("no BBL — OATH/FDNY skipped");

  // de-dupe within the batch (same record can come back for two BINs / lots)
  const byKey = new Map<string, Row>();
  for (const r of records) byKey.set(`${r.source}|${r.source_id}`, r);
  records = [...byKey.values()];

  // existing rows for this property (to compute new/closed + preserve closed_at)
  const { data: existing, error: exErr } = await sb.from("violations").select("id,source,source_id,status,closed_at").eq("violation_property_id", p.id);
  if (exErr) throw new Error("load existing: " + exErr.message);
  const ex = new Map((existing || []).map((r: Row) => [`${r.source}|${r.source_id}`, r]));
  const nowIso = new Date().toISOString();
  let newOpen = 0, newlyClosed = 0;
  const payload = records.map((r) => {
    const prev = ex.get(`${r.source}|${r.source_id}`);
    if (!prev && r.status === "open") newOpen++;
    if (prev && prev.status === "open" && r.status === "closed") newlyClosed++;
    const closed_at = r.status === "closed" ? (prev?.closed_at || (prev?.status === "open" ? nowIso : null)) : null;
    return { ...r, violation_property_id: p.id, last_seen: nowIso, updated_at: nowIso, closed_at };
  });
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await sb.from("violations").upsert(payload.slice(i, i + 200), { onConflict: "source,source_id" });
    if (error) throw new Error("upsert: " + error.message);
  }
  // open rows that a successfully-queried source no longer returns → closed
  const seen = new Set(records.map((r) => `${r.source}|${r.source_id}`));
  const vanished = (existing || []).filter((r: Row) => r.status === "open" && okSources.has(r.source) && !seen.has(`${r.source}|${r.source_id}`));
  if (vanished.length) {
    newlyClosed += vanished.length;
    const { error } = await sb.from("violations").update({ status: "closed", source_status: "No longer listed by agency", closed_at: nowIso, updated_at: nowIso }).in("id", vanished.map((r: Row) => r.id));
    if (error) errors.push("close vanished: " + error.message);
  }

  // summary
  const { data: openRows } = await sb.from("violations").select("source,balance_due,hearing_date,is_hazardous").eq("violation_property_id", p.id).eq("status", "open");
  const today = new Date().toISOString().slice(0, 10);
  const bySrc: Record<string, number> = {};
  let bal = 0, haz = 0, next: string | null = null;
  for (const r of openRows || []) {
    bySrc[r.source] = (bySrc[r.source] || 0) + 1;
    bal += Number(r.balance_due || 0);
    if (r.is_hazardous) haz++;
    if (r.hearing_date && r.hearing_date >= today && (!next || r.hearing_date < next)) next = r.hearing_date;
  }
  const openCount = (openRows || []).length;
  const health = haz > 0 || bal > 0 || next ? "red" : openCount > 0 ? "amber" : "green";
  await sb.from("violation_properties").update({
    health, open_count: openCount, open_by_source: bySrc, balance_due: bal, next_hearing: next, hazardous_open: haz,
    last_checked_at: nowIso, last_check_error: errors.length ? errors.join(" | ").slice(0, 1000) : null,
  }).eq("id", p.id);

  return { id: p.id, name: p.name, records: records.length, open: openCount, new_open: newOpen, newly_closed: newlyClosed, health, balance_due: bal, errors };
}

// ── lookups (Add property modal) ───────────────────────────
async function geosearch(text: string) {
  const u = new URL("https://geosearch.planninglabs.nyc/v2/search");
  u.searchParams.set("text", text); u.searchParams.set("size", "6");
  const r = await fetch(u); if (!r.ok) throw new Error(`GeoSearch ${r.status}`);
  const j = await r.json();
  return (j.features || []).map((f: Row) => {
    const pad = f.properties?.addendum?.pad || {};
    const s = splitBbl(pad.bbl);
    return { label: f.properties?.label, bbl: pad.bbl || null, bin: pad.bin || null, borough: s ? BORO_LABEL[s.boro] : f.properties?.borough || null, block: s ? String(Number(s.block)) : null, lot: s ? String(Number(s.lot)) : null, lng: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1] };
  }).filter((x: Row) => x.bbl);
}
async function lookupBbl(bbl: string) {
  const s = splitBbl(bbl); if (!s) throw new Error("BBL must be 10 digits (borough 1-5 + 5-digit block + 4-digit lot)");
  const rows = await soda("64uk-42ks", `bbl=${Number(bbl)}`, 1);
  const p = rows[0];
  let bin: string | null = null, label = p ? `${p.address}, ${BORO_LABEL[s.boro]}` : null;
  if (p?.address) { const g = await geosearch(`${p.address}, ${BORO_LABEL[s.boro]}`); const m = g.find((x: Row) => x.bbl === bbl) || g[0]; if (m) { bin = m.bin; label = m.label || label; } }
  if (!bin) { const d = await soda("855j-jady", `bbl=${q(bbl)}`, 1).catch(() => []); bin = d[0]?.bin || null; }
  return [{ label, bbl, bin, borough: BORO_LABEL[s.boro], block: String(Number(s.block)), lot: String(Number(s.lot)), owner: p?.ownername || null }];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: Row = {};
  try { body = await req.json(); } catch { /* empty body = cron */ }
  try {
    if (body.action === "lookup") return json({ results: await geosearch(String(body.address || "")) });
    if (body.action === "lookup_bbl") return json({ results: await lookupBbl(String(body.bbl || "")) });

    let qy = sb.from("violation_properties").select("*").eq("active", true).eq("nyc_covered", true);
    if (Array.isArray(body.property_ids) && body.property_ids.length) qy = qy.in("id", body.property_ids);
    const { data: props, error } = await qy;
    if (error) throw new Error(error.message);

    const { data: run } = await sb.from("violation_check_runs").insert({ trigger: body.trigger || (Object.keys(body).length ? "api" : "cron"), property_ids: (props || []).map((p: Row) => p.id) }).select("id").single();
    const results: Row[] = [];
    for (const p of props || []) {
      try { results.push(await checkProperty(p)); }
      catch (e) {
        results.push({ id: p.id, name: p.name, errors: [String(e)] });
        await sb.from("violation_properties").update({ last_check_error: String(e).slice(0, 1000), last_checked_at: new Date().toISOString() }).eq("id", p.id);
      }
    }
    // not-covered properties get a neutral health
    await sb.from("violation_properties").update({ health: "na" }).eq("nyc_covered", false);

    const errs = results.flatMap((r) => (r.errors || []).map((e: string) => `${r.name}: ${e}`)).filter((e) => !/skipped$/.test(e));
    const summary = { properties: results.map(({ id, name, open, health, balance_due, new_open, newly_closed }) => ({ id, name, open, health, balance_due, new_open, newly_closed })) };
    if (run?.id) await sb.from("violation_check_runs").update({
      finished_at: new Date().toISOString(), properties_checked: results.length,
      records_seen: results.reduce((a, r) => a + (r.records || 0), 0),
      new_open: results.reduce((a, r) => a + (r.new_open || 0), 0),
      newly_closed: results.reduce((a, r) => a + (r.newly_closed || 0), 0),
      errors: errs, summary, ok: errs.length === 0,
    }).eq("id", run.id);
    return json({ ok: errs.length === 0, run_id: run?.id, results, errors: errs });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
