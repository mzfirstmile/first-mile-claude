// Non-NYC + federal sources for violation-check (added 2026-11-11).
//
//   epa_echo   EPA ECHO (CAA / CWA / RCRA / SDWA inspections, violations, formal actions, penalties)
//              — every property with lat/lng, NYC included. echodata.epa.gov, no key.
//   njdep      NJDEP NJEMS map service (mapsdep.nj.gov Environmental_NJEMS): Known Contaminated Sites (0),
//              UST facilities incl. Administrative Consent Orders (9), Immediate Environmental Concern
//              sites (20), Site Remediation cases (24). Spatial query + address match.
//   nj_permit  NJ DCA construction permits reported by municipalities (data.nj.gov w9se-dmra), by
//              treasury muni code + block/lot. A permit with no certificate reported = open permit.
//              info_only: listed, never counted in health.
//   ct_deep    CT DEEP formal enforcement 2021+ (t2bf-45ba) and 1999-2021 (tvbr-6b6t), UST enforcement
//              (sfgx-68fy), contaminated / potentially contaminated sites (xcxg-6jqp) — by town + address.
//
// Nothing here needs credentials. Local fire-code (NJ Uniform Fire Code / CT Fire Safety Code),
// construction-code NOVs, elevator, boiler and property-maintenance violations are NOT published by
// any NJ/CT agency as data; the UI lists those agencies with links instead.

type Row = Record<string, any>;

// ── address normalisation / matching ───────────────────────
const WORD: Record<string, string> = {
  AVENUE: "AVE", AV: "AVE", ROAD: "RD", DRIVE: "DR", STREET: "ST", BOULEVARD: "BLVD", PLACE: "PL", LANE: "LN",
  MOUNT: "MT", ROUTE: "RT", RTE: "RT", HWY: "RT", HIGHWAY: "RT", NJ: "RT", US: "RT", SOUTH: "S", NORTH: "N", EAST: "E", WEST: "W",
  FIFTH: "5TH", SCHULZ: "SCHULTZ", CENTRE: "CENTER", KIMBLE: "KEMBLE",
};
const SUFFIX = new Set(["AVE", "RD", "DR", "ST", "BLVD", "PL", "LN", "S", "N", "E", "W", "STATE", "THE", "OF"]);
export function normAddr(s: string): string[] {
  const t = String(s || "").toUpperCase().replace(/(\d)-(\d)/g, "$1$2").replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  return t.map((w) => WORD[w] || w);
}
// house number + every significant street word of one target address must appear in the record
export function addrMatch(record: string, targets: string[]): boolean {
  const rt = new Set(normAddr(record));
  return targets.some((t) => {
    const tt = normAddr(t);
    const house = tt.find((w) => /^\d/.test(w));
    if (!house || !rt.has(house)) return false;
    const sig = tt.filter((w) => w !== house && !SUFFIX.has(w));
    return sig.length > 0 && sig.every((w) => rt.has(w));
  });
}

async function getJson(url: string, timeoutMs = 45000): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "FirstMile-ViolationTracker/1.0" }, signal: ac.signal });
      if (r.ok) return await r.json();
      if (r.status < 500 && r.status !== 429) throw new Error(`${new URL(url).host} ${r.status}: ${(await r.text()).slice(0, 160)}`);
    } catch (e) { if (attempt === 2) throw e; } finally { clearTimeout(t); }
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
  }
  throw new Error(`${url}: retries exhausted`);
}
const num = (v: any) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[$,]/g, "")); return isNaN(n) ? null : n; };
const mdy = (s: any) => { const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };
const epoch = (v: any) => (typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : null);
const iso = (v: any) => { const m = String(v || "").match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; };
const clean = (s: any) => (s == null ? null : String(s).replace(/\s{2,}/g, " ").trim() || null);
const soql = (s: string) => `'${String(s).replace(/'/g, "''")}'`;

function base(source: string, source_id: string, extra: Row) {
  return {
    source, source_id, status: "closed", source_status: null, issue_date: null, violation_type: null, description: null,
    class_severity: null, is_hazardous: false, penalty: null, balance_due: null, hearing_date: null, hearing_status: null,
    issuing_agency: null, bin: null, bbl: null, agency_url: null, raw: null, respondent: null, info_only: false, ...extra,
  };
}

// ── EPA ECHO ───────────────────────────────────────────────
export async function fetchEcho(p: Row): Promise<Row[]> {
  if (p.latitude == null || p.longitude == null) return [];
  const B = "https://echodata.epa.gov/echo/echo_rest_services.";
  const radius = p.state === "NY" ? 0.1 : 0.35; // miles; NYC blocks are dense, NJ/CT campuses are big
  const r = await getJson(`${B}get_facilities?output=JSON&p_lat=${p.latitude}&p_long=${p.longitude}&p_radius=${radius}`);
  const qid = r?.Results?.QueryID; if (!qid) return [];
  const out: Row[] = [];
  for (let page = 1; page <= 5; page++) {
    const q = await getJson(`${B}get_qid?output=JSON&qid=${qid}&pageno=${page}`);
    const facs: Row[] = q?.Results?.Facilities || [];
    for (const f of facs) {
      if (!addrMatch(`${f.FacStreet || ""}`, p.match_addresses || [])) continue;
      const status = clean(f.FacComplianceStatus);
      const snc = f.FacSNCFlg === "Y";
      const open = snc || (!!status && !/^No Violation/i.test(status));
      const progs = [["CAA", f.CAAComplianceStatus], ["CWA", f.CWAComplianceStatus], ["RCRA", f.RCRAComplianceStatus], ["SDWA", f.SDWAComplianceStatus]]
        .filter(([, s]) => s).map(([k, s]) => `${k}: ${s}`);
      const qnc = Number(f.FacQtrsWithNC || 0), formal = Number(f.FacFormalActionCount || 0);
      out.push(base("epa_echo", String(f.RegistryID), {
        status: open ? "open" : "closed", source_status: status || "No program status",
        issue_date: mdy(f.FacDateLastInspection), violation_type: progs.map((x) => x.split(":")[0]).join(" / ") || "EPA-regulated facility",
        description: `${clean(f.FacName)} — ${progs.join("; ") || "registered with EPA"}${qnc ? ` · ${qnc} quarter(s) in non-compliance (last 3 yrs)` : ""}${formal ? ` · ${formal} formal enforcement action(s) (5 yrs)` : ""}${f.FacDateLastInspection ? ` · last inspected ${f.FacDateLastInspection}` : ""}`,
        class_severity: snc ? "Significant Non-Compliance" : qnc ? `${qnc} qtrs non-compliant` : null, is_hazardous: snc,
        penalty: num(f.FacTotalPenalties) || null, issuing_agency: "US EPA (ECHO)", respondent: clean(f.FacName),
        agency_url: `https://echo.epa.gov/detailed-facility-report?fid=${f.RegistryID}`, raw: f,
      }));
    }
    if (facs.length < 5000) break; // ECHO pages are large; one page is the norm
  }
  return out;
}

// ── NJDEP (NJEMS map service) ──────────────────────────────
const NJDEP = "https://mapsdep.nj.gov/arcgis/rest/services/Features/Environmental_NJEMS/MapServer";
const DATAMINER = "https://njems.nj.gov/DataMiner";
async function njdepLayer(p: Row, layer: number): Promise<Row[]> {
  const q = new URLSearchParams({
    geometry: `${p.longitude},${p.latitude}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    distance: "450", units: "esriSRUnit_Meter", outFields: "*", returnGeometry: "false", f: "json",
  });
  const d = await getJson(`${NJDEP}/${layer}/query?${q}`);
  if (d.error) throw new Error(`NJDEP layer ${layer}: ${JSON.stringify(d.error).slice(0, 160)}`);
  return (d.features || []).map((f: Row) => f.attributes);
}
export async function fetchNjdep(p: Row): Promise<Row[]> {
  if (p.latitude == null) return [];
  const addrs = p.match_addresses || [];
  const [kcsl, ust, iec, srp] = await Promise.all([0, 9, 20, 24].map((l) => njdepLayer(p, l)));
  const out: Row[] = [];
  const kcslIds = new Set<string>();
  for (const a of kcsl) {
    if (!addrMatch(a.ADDRESS, addrs)) continue;
    kcslIds.add(String(a.PI_NUMBER));
    const open = /^Active|Pending/i.test(a.STATUS || "");
    out.push(base("njdep", `kcsl:${a.PI_NUMBER}`, {
      status: open ? "open" : "closed", source_status: `KCSL ${a.STATUS}`, issue_date: epoch(a.STATUS_DT),
      violation_type: "Known Contaminated Site", class_severity: a.REM_LEVEL ? `Remedial level ${a.REM_LEVEL}` : null,
      description: `${clean(a.PI_NAME)} (${clean(a.ADDRESS)}) on NJDEP's Known Contaminated Sites List${a.CEA_STATUS ? ` · CEA ${a.CEA_STATUS}` : ""}${a.DN_STATUS ? ` · deed notice ${a.DN_STATUS}` : ""}${a.EC_STATUS ? ` · eng. controls ${a.EC_STATUS}` : ""}`,
      issuing_agency: "NJDEP Site Remediation", respondent: clean(a.PI_NAME), agency_url: DATAMINER, raw: a,
    }));
  }
  for (const a of srp) {
    if (!addrMatch(a.ADDRESS, addrs) || kcslIds.has(String(a.PREFERRED_ID))) continue;
    const open = /^Active/i.test(a.CASE_STATUS || "");
    out.push(base("njdep", `srp:${a.PREFERRED_ID}`, {
      status: open ? "open" : "closed", source_status: `Remediation case ${a.CASE_STATUS}${a.CLOSED_DATE ? " " + epoch(a.CLOSED_DATE) : ""}`,
      issue_date: epoch(a.CLOSED_DATE), violation_type: "Site Remediation case",
      description: `${clean(a.PI_NAME)} (${clean(a.ADDRESS)}) — NJDEP remediation case${a.DEED_NOTICE ? " · deed notice" : ""}${a.CEA ? " · CEA" : ""}${a.ENG_CONTROL ? " · engineering controls" : ""}`,
      class_severity: a.REMEDIAL_LEVEL || null, issuing_agency: "NJDEP Site Remediation", respondent: clean(a.PI_NAME), agency_url: DATAMINER, raw: a,
    }));
  }
  const now = Date.now();
  for (const a of ust) {
    if (!addrMatch(`${a.STREET1 || ""} ${a.STREET2 || ""}`, addrs)) continue;
    const aco = a.ACO_EXISTS === "Y";
    const expired = (a.DOC_STATUS === "Effective" && a.EXPIRATION_DATE && a.EXPIRATION_DATE < now) || a.DOC_STATUS === "Expired";
    const open = aco || expired;
    out.push(base("njdep", `ust:${a.PREF_ID_NUM}:${a.INT_DOC_ID || a.DOC_STATUS}`, {
      status: open ? "open" : "closed", source_status: `UST ${a.DOC_STATUS}${a.EXPIRATION_DATE ? ` (exp. ${epoch(a.EXPIRATION_DATE)})` : ""}`,
      issue_date: epoch(a.INSPECTION_DATE) || epoch(a.EXPIRATION_DATE), violation_type: "Underground Storage Tank",
      description: `${clean(a.PI_NAME)} (${clean(a.STREET1)}) — ${aco ? "Administrative Consent Order on file" : expired ? "UST registration expired" : a.DOC_STATUS === "Inspection Conducted" ? "NJDEP UST inspection" : "UST registration " + (a.DOC_STATUS || "")}`,
      class_severity: aco ? "Administrative Consent Order" : expired ? "Registration expired" : null, is_hazardous: aco,
      issuing_agency: "NJDEP UST program", respondent: clean(a.PI_NAME), agency_url: DATAMINER, raw: a,
    }));
  }
  for (const a of iec) {
    if (!addrMatch(`${a.LINE1_ADDR_DESC || ""} ${a.LINE2_ADDR_DESC || ""}`, addrs)) continue;
    const open = !/Receptor Addressed/i.test(a.RECEPTOR_STATUS || "");
    out.push(base("njdep", `iec:${a.IEC_NUM || a.INT_DOC_ID}`, {
      status: open ? "open" : "closed", source_status: `IEC ${a.RECEPTOR_STATUS || ""}`, issue_date: epoch(a.IDENTIFICATION_DATE),
      violation_type: "Immediate Environmental Concern", class_severity: clean(a.IEC_TYPE), is_hazardous: open,
      description: `${clean(a.PI_NAME)} — ${clean(a.IEC_DESCRIPTION) || "Immediate Environmental Concern"} (${clean(a.ACTIVITY) || ""})`,
      issuing_agency: "NJDEP Site Remediation", respondent: clean(a.PI_NAME), agency_url: DATAMINER, raw: a,
    }));
  }
  return out;
}

// ── NJ DCA construction permits (open permits) ─────────────
const NJ_BUILDING_URL: Record<string, string> = {
  "1422": "https://www.morristwp.com/121", "0246": "https://www.paramusborough.gov/Directory.aspx?DID=17", "1332": "https://middletownnj.org/149",
};
export async function fetchNjPermits(p: Row): Promise<Row[]> {
  if (!p.muni_code || !(p.lots || []).length) return [];
  const pairs = (p.lots as string[]).map((l) => l.split("/")).filter((x) => x.length === 2);
  const where = `treasurycode=${soql(p.muni_code)} AND (${pairs.map(([b, l]) => `(block=${soql(b)} AND lot=${soql(l)})`).join(" OR ")})`;
  const u = new URL("https://data.nj.gov/resource/w9se-dmra.json");
  u.searchParams.set("$where", where); u.searchParams.set("$limit", "5000");
  const rows: Row[] = await getJson(u.toString());
  const byPermit = new Map<string, Row[]>();
  // same permit is reported as "000020222184", "20222184", "20222184U" (update), "20260170+A" (amendment)
  const permitKey = (n: any) => String(n || "").toUpperCase().split("+")[0].trim().replace(/[A-Z]+$/, "").replace(/^0+/, "");
  for (const r of rows) { const k = permitKey(r.permitno); if (!k) continue; if (!byPermit.has(k)) byPermit.set(k, []); byPermit.get(k)!.push(r); }
  const cutoff = new Date(Date.now() - 10 * 365 * 864e5).toISOString().slice(0, 10);
  const out: Row[] = [];
  for (const [permitno, rs] of byPermit) {
    const permits = rs.filter((r) => r.status === "P").sort((a, b) => String(a.permitdate).localeCompare(String(b.permitdate)));
    if (!permits.length) continue;
    const first = permits[0];
    const issued = iso(first.permitdate);
    if (issued && issued < cutoff) continue;
    const certs = rs.filter((r) => r.status === "C");
    const finalCert = certs.find((c) => !/Temporary/i.test(c.certtypedesc || ""));
    const tco = certs.find((c) => /Temporary/i.test(c.certtypedesc || ""));
    const open = !finalCert;
    const cost = Math.max(...permits.map((r) => Number(r.constcost || 0)));
    const ageMo = issued ? Math.round((Date.now() - new Date(issued).getTime()) / (30.4 * 864e5)) : null;
    out.push(base("nj_permit", `${p.muni_code}:${permitno}`, {
      status: open ? "open" : "closed", info_only: true,
      source_status: finalCert ? `${finalCert.certtypedesc} ${iso(finalCert.certdate) || ""}`.trim() : tco ? `Temporary CO only (${iso(tco.certdate) || ""})` : "No certificate reported to NJ DCA — confirm with the construction office",
      issue_date: issued, violation_type: `Construction permit · ${clean(first.permittypedesc) || ""}`.trim(),
      description: `Permit ${permitno} — ${clean(first.permittypedesc) || "work"}${cost ? `, est. cost $${cost.toLocaleString("en-US")}` : ""}${first.usegroupdesc ? ` (${clean(first.usegroupdesc)})` : ""} · Block ${first.block} Lot ${first.lot}${open && ageMo != null ? ` · open ${ageMo} mo` : ""}`,
      class_severity: open ? (tco ? "Temporary CO" : ageMo != null && ageMo > 24 ? "Open > 2 yrs" : "Open permit") : "Closed",
      penalty: null, issuing_agency: `${clean(first.muniname)} construction official (NJ UCC)`,
      agency_url: NJ_BUILDING_URL[p.muni_code] || "https://data.nj.gov/d/w9se-dmra", raw: { permits, certs },
    }));
  }
  return out;
}

// ── CT DEEP ────────────────────────────────────────────────
async function ct(dataset: string, where: string): Promise<Row[]> {
  const u = new URL(`https://data.ct.gov/resource/${dataset}.json`);
  u.searchParams.set("$where", where); u.searchParams.set("$limit", "5000");
  return await getJson(u.toString());
}
export async function fetchCtDeep(p: Row): Promise<Row[]> {
  const town = String(p.municipality || "").toUpperCase(); if (!town) return [];
  const addrs = p.match_addresses || [];
  const tw = `upper(town) like ${soql("%" + town + "%")}`;
  const [enf, enfOld, ust, sites] = await Promise.all([
    ct("t2bf-45ba", tw), ct("tvbr-6b6t", tw),
    ct("sfgx-68fy", `upper(site_city) like ${soql("%" + town + "%")}`),
    ct("xcxg-6jqp", `upper(official_town) like ${soql("%" + town + "%")}`),
  ]);
  const out: Row[] = [];
  const recent = new Date(Date.now() - 2 * 365 * 864e5).toISOString().slice(0, 10);
  for (const a of enf) {
    if (!addrMatch(a.violation_address || "", addrs)) continue;
    const d = iso(a.date_issued);
    out.push(base("ct_deep", `enf:${a.order_number || d + ":" + a.respondent}`, {
      status: d && d >= recent ? "open" : "closed", source_status: clean(a.type_of_enforcement), issue_date: d,
      violation_type: `DEEP ${clean(a.deep_program) || ""} · ${clean(a.violation_citation) || ""}`.trim(), description: clean(a.violation_description),
      class_severity: clean(a.type_of_enforcement), penalty: num(a.penalty_amount), issuing_agency: "CT DEEP", respondent: clean(a.respondent),
      agency_url: a.path?.url || "https://data.ct.gov/d/t2bf-45ba", raw: a,
    }));
  }
  for (const a of enfOld) {
    if (!addrMatch(`${a.enforcement_title || ""} ${a.enforcement_action || ""} ${a.respondent || ""}`, addrs)) continue;
    out.push(base("ct_deep", `enf_old:${a.consentorder || iso(a.date) + ":" + a.respondent}`, {
      status: "closed", source_status: "Formal enforcement (1999-2021)", issue_date: iso(a.date), violation_type: `DEEP ${clean(a.program) || ""}`,
      description: `${clean(a.enforcement_title)} — ${clean(a.enforcement_action)}`, issuing_agency: "CT DEEP", respondent: clean(a.respondent),
      agency_url: a.path?.url || "https://data.ct.gov/d/tvbr-6b6t", raw: a,
    }));
  }
  for (const a of ust) {
    if (!addrMatch(a.site_address_line_1 || "", addrs)) continue;
    const open = /^Active/i.test(a.status_type_desc || "");
    out.push(base("ct_deep", `ust:${a.enforcement_action_id}`, {
      status: open ? "open" : "closed", source_status: `UST enforcement ${a.status_type_desc}${a.resolutiondesc ? " · " + clean(a.resolutiondesc) : ""}`,
      issue_date: iso(a.start_date), violation_type: `UST · ${clean(a.env_int_type_desc) || "enforcement"}`,
      description: `${clean(a.site_name)} (${clean(a.site_address_line_1)}) — ${a.num_of_violation || "?"} violation(s)`,
      class_severity: clean(a.env_int_type_desc), issuing_agency: "CT DEEP UST program",
      respondent: clean([a.client_first_name, a.client_last_name].filter(Boolean).join(" ")) || clean(a.site_name),
      agency_url: "https://data.ct.gov/d/sfgx-68fy", raw: a,
    }));
  }
  for (const a of sites) {
    if (!addrMatch(a.case_address || "", addrs)) continue;
    const open = !/Resolved|Withdrawn/i.test(a.case_status || "");
    out.push(base("ct_deep", `site:${a.case_number}`, {
      status: open ? "open" : "closed", source_status: `${clean(a.case_status)}${a.cleanup_stage ? " · " + clean(a.cleanup_stage) : ""}`,
      violation_type: `Contaminated site · ${clean(a.case_program) || ""}`, description: `${clean(a.case_name)} (${clean(a.case_address)})${a.env_use_restrictions_in_place ? " · environmental use restriction" : ""}${a.engineered_controls_in_place ? " · engineered controls" : ""}`,
      class_severity: clean(a.case_program), issuing_agency: "CT DEEP Remediation", respondent: clean(a.case_name),
      agency_url: a.react_case_link?.url || a.react_site_link?.url || "https://deep-react.service.ct.gov/s/", raw: a,
    }));
  }
  return out;
}

// ── Add-property lookup outside NYC: Census geocoder (+ NJ parcel for block/lot) ──
export async function lookupUs(address: string): Promise<Row[]> {
  const u = new URL("https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress");
  u.searchParams.set("address", address); u.searchParams.set("benchmark", "Public_AR_Current"); u.searchParams.set("vintage", "Current_Current");
  u.searchParams.set("layers", "County Subdivisions,Counties"); u.searchParams.set("format", "json");
  const d = await getJson(u.toString());
  const out: Row[] = [];
  for (const m of (d?.result?.addressMatches || []).slice(0, 4)) {
    const lat = m.coordinates?.y, lng = m.coordinates?.x;
    const st = m.addressComponents?.state || "";
    const sub = m.geographies?.["County Subdivisions"]?.[0]?.NAME || "";
    const county = (m.geographies?.Counties?.[0]?.NAME || "").replace(/ County$/, "");
    const street = String(m.matchedAddress || "").split(",")[0];
    const r: Row = { label: m.matchedAddress, state: st, latitude: lat, longitude: lng, county, municipality: sub.replace(/ (town|township|borough|city|village)$/i, "").toUpperCase(), match_addresses: [street], lots: [], muni_code: null };
    if (st === "NJ" && lat != null) {
      try {
        const q = new URLSearchParams({ geometry: `${lng},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", distance: "25", units: "esriSRUnit_Meter", outFields: "PAMS_PIN,PCLBLOCK,PCLLOT,MUN_NAME,PROP_LOC,CALC_ACRE,BLDG_DESC", returnGeometry: "false", f: "json" });
        const pd = await getJson(`https://maps.nj.gov/arcgis/rest/services/Framework/Cadastral/MapServer/0/query?${q}`);
        const parcels = (pd.features || []).map((f: Row) => f.attributes).filter((a: Row) => a.PCLBLOCK && a.PCLLOT);
        const best = parcels.find((a: Row) => a.PROP_LOC && addrMatch(a.PROP_LOC, [street])) || parcels.find((a: Row) => a.MUN_NAME) || parcels[0];
        if (best) {
          r.municipality = best.MUN_NAME || r.municipality; r.muni_code = String(best.PAMS_PIN || "").split("_")[0] || null;
          r.lots = [`${best.PCLBLOCK}/${best.PCLLOT}`]; r.parcel = best;
          if (best.PROP_LOC && !addrMatch(best.PROP_LOC, [street])) r.match_addresses.push(best.PROP_LOC);
        }
      } catch (_) { /* parcel layer is best-effort */ }
    }
    out.push(r);
  }
  return out;
}
