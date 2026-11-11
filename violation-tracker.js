/* ============================================================
   Violation Tracker Module — violation-tracker.js
   External IIFE module (same pattern as deal-tracking.js)
   Loaded via <script src="violation-tracker.js"> in index.html
   Called via window.violationTrackerInit() from switchView()

   Data: Supabase `violation_properties` (watch list + health
   summary), `violations` (one row per agency record) and
   `violation_check_runs`, all written by the `violation-check`
   edge function (daily pg_cron at 8 AM ET + "Run check now").
   ============================================================ */
(function () {
  'use strict';

  let _inited = false;
  let _props = [];
  let _lastRun = null;
  let _current = null;      // property row
  let _viol = [];           // violations for _current
  let _srcFilter = 'all';
  let _showClosed = false;
  let _showThird = true;
  let _showInactive = false;

  const SOURCES = [
    { key: 'dob_bis', label: 'DOB BIS', color: '#0ea5e9' },
    { key: 'dob_ecb', label: 'DOB ECB', color: '#8b5cf6' },
    { key: 'dob_now', label: 'DOB NOW', color: '#06b6d4' },
    { key: 'oath', label: 'OATH', color: '#f59e0b' },
    { key: 'fdny', label: 'FDNY', color: '#ef4444' },
    { key: 'epa_echo', label: 'EPA', long: 'US EPA ECHO (air / water / hazardous waste)', color: '#16a34a' },
    { key: 'njdep', label: 'NJDEP', long: 'NJ Dept of Environmental Protection', color: '#0d9488' },
    { key: 'ct_deep', label: 'CT DEEP', long: 'CT Dept of Energy & Environmental Protection', color: '#0d9488' },
    { key: 'nj_permit', label: 'Permits', long: 'NJ construction permits (info only)', color: '#64748b', info: true },
  ];
  const SRC = Object.fromEntries(SOURCES.map((s) => [s.key, s]));
  const HEALTH = {
    green: { label: 'Clear', color: '#059669', tip: 'No open owner violations' },
    amber: { label: 'Open items', color: '#f59e0b', tip: 'Open violations, none hazardous, no balance due, no upcoming hearing' },
    red: { label: 'Action needed', color: '#dc2626', tip: 'Hazardous / Class 1 / unsafe item open, a balance is due, or a hearing is coming up' },
    na: { label: 'Not covered', color: '#94a3b8', tip: 'No automated source covers this property (no location / unsupported state)' },
  };

  // ── CSS ──────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('vt-css')) return;
    const s = document.createElement('style');
    s.id = 'vt-css';
    s.textContent = `
      #vtRoot { color:#1e293b; }
      #vtRoot .vt-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
      #vtRoot .vt-head h2 { margin:0; font-size:22px; font-weight:700; }
      #vtRoot .vt-head p { margin:4px 0 0; color:#64748b; font-size:14px; max-width:760px; }
      #vtRoot .vt-btn { border:1px solid #e2e8f0; background:#fff; color:#1e293b; border-radius:8px; padding:8px 14px; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; }
      #vtRoot .vt-btn:hover { border-color:#0ea5e9; color:#0ea5e9; }
      #vtRoot .vt-btn.primary { background:linear-gradient(135deg,#0ea5e9,#0369a1); color:#fff; border:none; }
      #vtRoot .vt-btn.primary:hover { filter:brightness(1.05); color:#fff; }
      #vtRoot .vt-btn:disabled { opacity:.6; cursor:default; }
      #vtRoot .vt-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      #vtRoot .vt-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:18px 0; }
      #vtRoot .vt-kpi { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:14px 16px; }
      #vtRoot .vt-kpi .v { font-size:24px; font-weight:700; }
      #vtRoot .vt-kpi .l { font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:.04em; margin-top:2px; }
      #vtRoot table.vt-table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; }
      #vtRoot table.vt-table th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#64748b; padding:10px 12px; background:#f8fafc; border-bottom:1px solid #e2e8f0; white-space:nowrap; }
      #vtRoot table.vt-table th.num, #vtRoot table.vt-table td.num { text-align:right; }
      #vtRoot table.vt-table th.ctr, #vtRoot table.vt-table td.ctr { text-align:center; }
      #vtRoot table.vt-table td { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13.5px; vertical-align:top; }
      #vtRoot table.vt-table tr.row { cursor:pointer; }
      #vtRoot table.vt-table tr.row:hover td { background:#f0f9ff; }
      #vtRoot table.vt-table tr.muted td { color:#94a3b8; }
      #vtRoot table.vt-table tr.tp td { background:#fafafa; }
      #vtRoot .vt-name { font-weight:600; color:#0f172a; }
      #vtRoot .vt-sub { color:#64748b; font-size:12px; margin-top:2px; }
      #vtRoot .pill { display:inline-block; padding:2px 9px; border-radius:10px; font-size:11.5px; font-weight:700; color:#fff; white-space:nowrap; }
      #vtRoot .cnt { display:inline-block; min-width:22px; padding:1px 7px; border-radius:9px; font-size:12px; font-weight:700; }
      #vtRoot .cnt.z { color:#cbd5e1; }
      #vtRoot .cnt.nz { background:#fef3c7; color:#92400e; }
      #vtRoot .vt-section { margin:22px 0 8px; font-size:13px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.05em; }
      #vtRoot .vt-empty { text-align:center; color:#64748b; padding:40px 16px; background:#fff; border:1px dashed #e2e8f0; border-radius:12px; }
      #vtRoot .vt-note { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:14px 18px; margin-top:18px; font-size:13px; color:#475569; }
      #vtRoot .vt-note b { color:#1e293b; }
      #vtRoot .vt-note ul { margin:6px 0 0; padding-left:18px; }
      #vtRoot .vt-note li { margin:3px 0; }
      #vtRoot a { color:#0369a1; }
      #vtRoot .vt-chips { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:16px 0 12px; }
      #vtRoot .vt-chip { border:1px solid #e2e8f0; background:#fff; border-radius:20px; padding:5px 12px; font-size:13px; cursor:pointer; color:#475569; }
      #vtRoot .vt-chip.active { background:#1e293b; color:#fff; border-color:#1e293b; }
      #vtRoot .vt-chip b { margin-left:4px; opacity:.7; }
      #vtRoot label.vt-tog { font-size:13px; color:#475569; display:flex; gap:6px; align-items:center; cursor:pointer; margin-left:6px; }
      #vtRoot .vt-back { background:none; border:none; color:#0ea5e9; font-size:14px; cursor:pointer; padding:0; margin-bottom:12px; }
      #vtRoot .vt-detail-head { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:18px 22px; display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; }
      #vtRoot .vt-detail-head h2 { margin:0 0 6px; font-size:22px; }
      #vtRoot .vt-meta { color:#64748b; font-size:13px; }
      #vtRoot .vt-links { display:flex; gap:12px; flex-wrap:wrap; margin-top:8px; font-size:13px; }
      #vtRoot .desc { max-width:460px; min-width:220px; }
      #vtRoot .vt-scroll { overflow-x:auto; border-radius:12px; }
      #vtRoot .vt-scroll table.vt-table td:first-child { min-width:190px; }
      #vtRoot .haz { color:#dc2626; font-weight:700; }
      .vt-overlay { position:fixed; inset:0; background:rgba(15,23,42,.45); z-index:9000; display:flex; align-items:center; justify-content:center; }
      .vt-modal { background:#fff; border-radius:14px; width:min(760px,94vw); max-height:92vh; overflow:auto; padding:22px 26px; box-shadow:0 20px 60px rgba(0,0,0,.25); color:#1e293b; }
      .vt-modal h3 { margin:0 0 6px; }
      .vt-modal p.hint { margin:0 0 12px; color:#64748b; font-size:13px; }
      .vt-modal label { display:block; font-size:12px; font-weight:600; color:#475569; margin:10px 0 4px; }
      .vt-modal input, .vt-modal select, .vt-modal textarea { width:100%; border:1px solid #e2e8f0; border-radius:8px; padding:9px 10px; font:inherit; font-size:13.5px; box-sizing:border-box; }
      .vt-modal .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:0 12px; }
      .vt-modal .row { display:flex; gap:8px; align-items:center; }
      .vt-modal .foot { display:flex; justify-content:space-between; gap:8px; margin-top:16px; }
      .vt-modal .res { border:1px solid #e2e8f0; border-radius:8px; margin-top:6px; max-height:200px; overflow:auto; }
      .vt-modal .res div { padding:8px 10px; font-size:13px; cursor:pointer; border-bottom:1px solid #f1f5f9; }
      .vt-modal .res div:hover { background:#f0f9ff; }
      .vt-modal .vt-btn { border:1px solid #e2e8f0; background:#fff; color:#1e293b; border-radius:8px; padding:8px 14px; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; }
      .vt-modal .vt-btn.primary { background:linear-gradient(135deg,#0ea5e9,#0369a1); color:#fff; border:none; }
      .vt-spin { display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,.5); border-top-color:#fff; border-radius:50%; animation:vtspin .8s linear infinite; vertical-align:-2px; margin-right:6px; }
      .vt-spin.dark { border-color:rgba(0,0,0,.15); border-top-color:#0ea5e9; }
      @keyframes vtspin { to { transform:rotate(360deg); } }
    `;
    document.head.appendChild(s);
  }

  // ── Helpers ──────────────────────────────────────────────
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt$ = (n) => (n == null || isNaN(Number(n)) ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const fmtDate = (s) => { if (!s) return '—'; const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s); return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  const fmtDT = (s) => (s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never');
  const healthPill = (h) => { const x = HEALTH[h] || { label: 'Not checked', color: '#cbd5e1', tip: 'No check has run yet' }; return `<span class="pill" title="${esc(x.tip)}" style="background:${x.color}">${x.label}</span>`; };
  const srcPill = (k) => { const s = SRC[k] || { label: k, color: '#94a3b8' }; return `<span class="pill" style="background:${s.color}">${s.label}</span>`; };
  const cnt = (n) => `<span class="cnt ${n ? 'nz' : 'z'}">${n || 0}</span>`;
  const todayStr = () => new Date().toISOString().slice(0, 10);
  function _toast(msg, isErr) {
    if (typeof window.showToast === 'function' && !isErr) { window.showToast(msg); return; }
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${isErr ? '#b91c1c' : '#1e293b'};color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.15);max-width:420px`;
    t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), isErr ? 6000 : 2500);
  }
  function _root() { return document.getElementById('vtRoot'); }

  const bisLink = (bin) => `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${bin}`;
  const ecbLink = (bin) => `https://a810-bisweb.nyc.gov/bisweb/ECBQueryByLocationServlet?requestid=1&allbin=${bin}`;
  const zolaLink = (bbl) => `https://zola.planning.nyc.gov/l/lot/${bbl[0]}/${Number(bbl.slice(1, 6))}/${Number(bbl.slice(6))}`;
  const DOBNOW = 'https://a810-dobnow.nyc.gov/publish/Index.html#!/';
  const OATH_FINDER = 'https://a820-ecbticketfinder.nyc.gov/searchHome.action';
  const CITYPAY = 'https://a836-citypay.nyc.gov/citypay/ecb';

  // ── Data ─────────────────────────────────────────────────
  async function _load() {
    const [props, runs] = await Promise.all([
      window.supaFetch('violation_properties', '?select=*&order=name.asc'),
      window.supaFetch('violation_check_runs', '?select=*&order=started_at.desc&limit=1').catch(() => []),
    ]);
    _props = props; _lastRun = runs[0] || null;
  }
  async function _loadViolations(pid) {
    _viol = await window.supaFetch('violations', `?select=id,source,source_id,status,source_status,issue_date,violation_type,description,class_severity,is_hazardous,penalty,balance_due,hearing_date,hearing_status,issuing_agency,respondent,third_party,info_only,agency_url,first_seen,last_seen,closed_at&violation_property_id=eq.${pid}&order=status.desc,issue_date.desc.nullslast&limit=5000`);
  }
  async function _fn(body) {
    const r = await fetch(`${window.SUPABASE_URL}/functions/v1/violation-check`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + window.SUPABASE_KEY, apikey: window.SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `violation-check ${r.status}`);
    return j;
  }

  // ── Agency directory (who issues violations, and whether we can check it automatically) ──
  // auto = checked by violation-check every day; otherwise the agency publishes nothing usable
  // (no open data / API, or only behind a login) and is listed with a link / phone to check by hand.
  const MUNI = {
    'MORRIS TWP': { label: 'Morris Township', building: ['https://www.morristwp.com/121', 'Building Dept (UCC construction official), 50 Woodland Ave · 973-326-7445'], fire: ['https://morristwp.com/858/8605', 'Fire Prevention Bureau (Morris Twp FD), 20 Dwyer Ln, Convent Station · 973-326-7463'], site: 'https://www.morristwp.com' },
    'PARAMUS BORO': { label: 'Paramus Borough', building: ['https://www.paramusborough.gov/Directory.aspx?DID=17', 'Building Dept (construction official), 1 W Jockish Sq · 201-265-2100 x2230'], fire: ['https://www.paramusborough.gov/Directory.aspx?did=8', 'Fire Prevention Bureau, 1 W Jockish Sq · 201-265-2100 x2290'], site: 'https://www.paramusborough.gov' },
    'MIDDLETOWN TWP': { label: 'Middletown Township', building: ['https://middletownnj.org/149', 'Dept of Building & Inspections, 1 Kings Hwy · 732-615-2106'], fire: ['https://middletownnj.org/345/Fire-Prevention', 'Bureau of Fire Prevention, 1 Kings Hwy · 732-615-2270'], site: 'https://middletownnj.org' },
    'GREENWICH': { label: 'Town of Greenwich', building: ['https://www.greenwichct.gov/195/Building-Inspection', 'Building Inspection Division, Town Hall, 101 Field Point Rd (inspections via CitySquared)'], fire: ['https://www.greenwichct.gov', 'Fire Marshal’s Division (CT Fire Safety Code), 15 Havemeyer Pl · 203-618-8830 (state roster — verify)'], site: 'https://www.greenwichct.gov' },
  };
  const ECHO_ROW = (p) => ({ auto: true, name: 'US EPA — ECHO', what: 'Federal Clean Air / Clean Water / RCRA hazardous-waste / drinking-water inspections, violations, formal actions and penalties for facilities at the address (building systems and tenants).', url: p.latitude ? `https://echo.epa.gov/facilities/facility-search/results?p_lat=${p.latitude}&p_long=${p.longitude}&p_radius=0.25` : 'https://echo.epa.gov/' });
  const OSHA_ROW = { auto: false, name: 'US DOL — OSHA', what: 'Workplace-safety inspections and citations (issued to the employer — usually a tenant or the property manager). DOL’s enforcement API needs a registered key; search by establishment name.', url: 'https://www.osha.gov/ords/imis/establishment.html' };
  function _agencies(p) {
    const st = p.state || (p.nyc_covered ? 'NY' : null);
    const m = MUNI[String(p.municipality || '').toUpperCase()];
    if (st === 'NY') return [
      { auto: true, name: 'NYC DOB — BIS violations', what: 'Department of Buildings violations (elevators, boilers, facade/FISP, construction).', url: p.bin ? bisLink(p.bin) : DOBNOW },
      { auto: true, name: 'NYC DOB — ECB / OATH violations', what: 'DOB summonses heard at OATH (Class 1/2/3), penalties and balances.', url: p.bin ? ecbLink(p.bin) : OATH_FINDER },
      { auto: true, name: 'NYC DOB NOW — safety violations', what: 'Elevator, boiler, facade, gas-piping and LL97 filing violations.', url: DOBNOW },
      { auto: true, name: 'OATH Hearings Division', what: 'Summonses from DEP, DSNY, DOHMH, DOT, NYPD etc. at the lot, with hearing dates and balances.', url: OATH_FINDER },
      { auto: true, name: 'FDNY — summonses', what: 'FDNY summonses heard at OATH. FDNY violation orders are only in the FDNY Business portal (login) — not checked.', url: 'https://fires.fdnycloud.org/CitizenAccess/' },
      { auto: false, name: 'NYC CityPay', what: 'Payment portal only (no API). Balances shown here come from ECB/OATH balance_due.', url: CITYPAY },
      ECHO_ROW(p), OSHA_ROW,
    ];
    if (st === 'NJ') return [
      ECHO_ROW(p),
      { auto: true, name: 'NJDEP — Site Remediation / UST / IEC', what: 'Known Contaminated Sites List, remediation cases, underground-storage-tank registrations and Administrative Consent Orders, Immediate Environmental Concern sites at the address.', url: 'https://njems.nj.gov/DataMiner' },
      { auto: false, name: 'NJDEP — enforcement actions (DataMiner)', what: 'Air / water / waste enforcement actions and penalties by site — DataMiner report only, no API. Search the property address.', url: 'https://njems.nj.gov/DataMiner' },
      { auto: true, name: 'NJ DCA — construction permits (info)', what: 'Permits the municipality reported to the state for these lots; permits with no certificate reported are listed as open permits (not counted in health).', url: 'https://data.nj.gov/d/w9se-dmra' },
      { auto: false, name: m ? `${m.label} — construction official` : 'Municipal construction official', what: 'NJ Uniform Construction Code: notices of violation, stop-construction orders, unsafe-structure notices, COs/TCOs, open permits. Not published as data — OPRA request or call.', url: m?.building?.[0] || null, contact: m?.building?.[1] },
      { auto: false, name: m ? `${m.label} — fire prevention (Uniform Fire Code)` : 'Local fire enforcing agency', what: 'Annual / life-hazard-use inspections, fire-code violation notices and penalties. Records are public on request (N.J.A.C. 5:70) but not online.', url: m?.fire?.[0] || null, contact: m?.fire?.[1] },
      { auto: false, name: 'NJ DCA — Bureau of Fire Code Enforcement', what: 'State-retained life-hazard-use / high-rise inspections where the state is the enforcing agency.', url: 'https://www.nj.gov/dca/dfs/offices/inspections.shtml' },
      { auto: false, name: 'NJ DCA — Elevator Safety Unit', what: 'Elevator device registration and inspections (DCA Service Portal device search).', url: 'https://www.nj.gov/dca/codes/offices/elevatorsafety.shtml' },
      { auto: false, name: 'NJ DOL — Boiler & Pressure Vessel Compliance', what: 'Annual boiler / pressure-vessel inspection certificates.', url: 'https://www.nj.gov/labor/safetyandhealth/programs-services/boiler-pressure-vessel-compliance' },
      { auto: false, name: m ? `${m.label} — code enforcement, health, tax collector` : 'Municipality', what: 'Property-maintenance / zoning violations, health-department notices (tenant food service), and delinquent taxes or municipal liens.', url: m?.site || null },
      OSHA_ROW,
    ];
    if (st === 'CT') return [
      ECHO_ROW(p),
      { auto: true, name: 'CT DEEP — enforcement, USTs, contaminated sites', what: 'DEEP formal enforcement (orders, consent orders, penalties), UST enforcement and the contaminated / potentially contaminated sites list, by town + address.', url: 'https://data.ct.gov/d/t2bf-45ba' },
      { auto: false, name: m ? `${m.label} — building inspection` : 'Municipal building official', what: 'CT State Building Code: permits, COs, violation and unsafe-building notices. No public data feed.', url: m?.building?.[0] || null, contact: m?.building?.[1] },
      { auto: false, name: m ? `${m.label} — fire marshal` : 'Local fire marshal', what: 'CT State Fire Safety Code inspections and violation orders. Not published online.', url: m?.fire?.[0] || null, contact: m?.fire?.[1] },
      { auto: false, name: 'CT DAS — Office of State Building Inspector (elevators & boilers)', what: 'Elevator / escalator and boiler inspection certificates (state-run in CT).', url: 'https://portal.ct.gov/das/office-of-state-building-inspector/apply-for-boiler-elevator-and-escalator-inspections-and-certifications' },
      { auto: false, name: m ? `${m.label} — zoning enforcement, health, tax collector` : 'Municipality', what: 'Zoning / blight violations, health-department notices, delinquent taxes and liens.', url: m?.site || null },
      OSHA_ROW,
    ];
    return [ECHO_ROW(p), OSHA_ROW];
  }
  function _agencyTable(p) {
    const rows = _agencies(p);
    return `<details class="vt-note" ${p.state && p.state !== 'NY' ? 'open' : ''}><summary style="cursor:pointer"><b>Who issues violations for this property</b> <span class="vt-sub" style="display:inline">· ${rows.filter((r) => r.auto).length} checked daily, ${rows.filter((r) => !r.auto).length} check by hand</span></summary>
      <table class="vt-table" style="margin-top:10px"><tbody>${rows.map((r) => `<tr>
        <td style="width:120px">${r.auto ? '<span class="pill" style="background:#059669">✓ Daily</span>' : '<span class="pill" style="background:#94a3b8">Manual</span>'}</td>
        <td><b>${r.url ? `<a href="${esc(r.url)}" target="_blank">${esc(r.name)} ↗</a>` : esc(r.name)}</b><div class="vt-sub">${esc(r.what)}</div>${r.contact ? `<div class="vt-sub">${esc(r.contact)}</div>` : ''}</td>
      </tr>`).join('')}</tbody></table></details>`;
  }

  // ── List view ────────────────────────────────────────────
  const srcChips = (bs, info) => {
    const parts = SOURCES.filter((s) => !s.info && bs && bs[s.key]).map((s) => `<span class="pill" style="background:${s.color}" title="${esc(s.long || s.label)}">${s.label} ${bs[s.key]}</span>`);
    if (info) parts.push(`<span class="pill" style="background:#e2e8f0;color:#475569" title="Open construction permits (no certificate reported) — info only">${info} open permit${info === 1 ? '' : 's'}</span>`);
    return parts.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${parts.join('')}</div>` : '<span style="color:#cbd5e1">—</span>';
  };
  function _renderList() {
    const root = _root(); if (!root) return;
    const active = _props.filter((p) => p.active);
    const inactive = _props.filter((p) => !p.active);
    const red = active.filter((p) => p.health === 'red').length;
    const open = active.reduce((a, p) => a + (p.open_count || 0), 0);
    const due = active.reduce((a, p) => a + Number(p.balance_due || 0), 0);
    const haz = active.reduce((a, p) => a + (p.hazardous_open || 0), 0);
    const rank = { red: 0, amber: 1, green: 2 };
    const ORDER = { NY: 0, NJ: 1, CT: 2 };
    active.sort((a, b) => (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3) || (rank[a.health] ?? 3) - (rank[b.health] ?? 3) || (b.open_count || 0) - (a.open_count || 0));
    const run = _lastRun;
    const rowHtml = (p) => `<tr class="row" onclick="vtOpen('${p.id}')">
        <td><div class="vt-name">${esc(p.name)}</div><div class="vt-sub">${esc(p.address || '')}</div><div class="vt-sub">${p.state === 'NY' || (!p.state && p.nyc_covered) ? `BBL ${esc(p.bbl || '—')} · BIN ${esc(p.bin || '—')}` : `${esc(MUNI[String(p.municipality || '').toUpperCase()]?.label || p.municipality || '')}${(p.lots || []).length ? ' · Block/Lot ' + p.lots.map(esc).join(', ') : ''}`}</div></td>
        <td>${healthPill(p.health)}${p.last_check_error ? `<div class="vt-sub" style="color:#b91c1c" title="${esc(p.last_check_error)}">⚠ check error</div>` : ''}</td>
        <td>${srcChips(p.open_by_source, p.info_open)}</td>
        <td class="num"><b>${p.open_count || 0}</b>${p.hazardous_open ? `<div class="vt-sub haz">${p.hazardous_open} hazardous</div>` : ''}</td>
        <td class="num">${Number(p.balance_due) ? `<b style="color:#b91c1c">${fmt$(p.balance_due)}</b>` : '<span style="color:#cbd5e1">$0</span>'}</td>
        <td>${p.next_hearing ? fmtDate(p.next_hearing) : '<span style="color:#cbd5e1">—</span>'}</td>
        <td class="num">${p.third_party_open ? `${p.third_party_open}<div class="vt-sub">${fmt$(p.third_party_balance)}</div>` : '<span style="color:#cbd5e1">0</span>'}</td>
        <td><span class="vt-sub">${fmtDT(p.last_checked_at)}</span></td>
      </tr>`;
    const head = `<thead><tr><th>Property</th><th>Health</th><th>Open by source</th><th class="num">Open</th><th class="num">$ Due</th><th>Next hearing</th><th class="num" title="Open tickets / EPA facilities at the address in a tenant's, vendor's or vehicle's name — not the owner">3rd-party</th><th>Checked</th></tr></thead>`;
    const group = (st, label) => { const rs = active.filter((p) => (p.state || (p.nyc_covered ? 'NY' : '')) === st); return rs.length ? `<div class="vt-section">${label}</div><div class="vt-scroll"><table class="vt-table">${head}<tbody>${rs.map(rowHtml).join('')}</tbody></table></div>` : ''; };
    const other = active.filter((p) => !['NY', 'NJ', 'CT'].includes(p.state || (p.nyc_covered ? 'NY' : '')));

    root.innerHTML = `
      <div class="vt-head">
        <div>
          <h2>Violation Tracker</h2>
          <p>Daily check (8 AM ET) for open violations. NYC: DOB BIS, ECB, DOB NOW, OATH and FDNY. New Jersey: NJDEP, open construction permits. Connecticut: CT DEEP. All properties: EPA ECHO. Local fire, construction, elevator and boiler agencies in NJ/CT publish no data; each property lists them with links.</p>
        </div>
        <div class="vt-actions">
          <button class="vt-btn" onclick="vtRefresh()">↻ Refresh</button>
          <button class="vt-btn" id="vtRunAll" onclick="vtRunCheck()">▶ Run check now</button>
          <button class="vt-btn primary" onclick="vtOpenEdit()">+ Add property</button>
        </div>
      </div>
      <div class="vt-kpis">
        <div class="vt-kpi"><div class="v">${active.length}</div><div class="l">Properties tracked</div></div>
        <div class="vt-kpi"><div class="v" style="color:${red ? '#dc2626' : '#059669'}">${red}</div><div class="l">Need action</div></div>
        <div class="vt-kpi"><div class="v">${open}</div><div class="l">Open violations</div></div>
        <div class="vt-kpi"><div class="v" style="color:${haz ? '#dc2626' : 'inherit'}">${haz}</div><div class="l">Hazardous / Class 1</div></div>
        <div class="vt-kpi"><div class="v" style="color:${due ? '#b91c1c' : 'inherit'}">${fmt$(due)}</div><div class="l">Balance due</div></div>
        <div class="vt-kpi"><div class="v" style="font-size:15px;padding-top:6px">${run ? fmtDT(run.started_at) : 'never'}</div><div class="l">Last check ${run ? `· ${run.trigger || ''} ${run.ok === false ? '<span style="color:#b91c1c">⚠ errors</span>' : run.finished_at ? '✓' : '…'}` : ''}</div></div>
      </div>
      ${active.length ? group('NY', 'New York City') + group('NJ', 'New Jersey') + group('CT', 'Connecticut') + (other.length ? `<div class="vt-section">Other</div><div class="vt-scroll"><table class="vt-table">${head}<tbody>${other.map(rowHtml).join('')}</tbody></table></div>` : '') : '<div class="vt-empty">No properties on the watch list yet. Click <b>+ Add property</b>.</div>'}
      ${inactive.length ? `<div class="vt-section" style="cursor:pointer" onclick="vtToggleInactive()">${_showInactive ? '▾' : '▸'} Deactivated (${inactive.length})</div>${_showInactive ? `<table class="vt-table"><tbody>${inactive.map((p) => `<tr class="muted"><td><div class="vt-name">${esc(p.name)}</div><div class="vt-sub">${esc(p.address || '')}</div></td><td style="text-align:right"><button class="vt-btn" onclick="vtSetActive('${p.id}', true)">Reactivate</button></td></tr>`).join('')}</tbody></table>` : ''}` : ''}
      ${_coverageNote()}
    `;
  }

  function _coverageNote() {
    return `<div class="vt-note"><b>Sources &amp; coverage</b>
      <ul>
        <li><b>NYC — DOB BIS</b> (<a href="https://data.cityofnewyork.us/d/3h2n-5cm9" target="_blank">3h2n-5cm9</a>), <b>DOB ECB</b> (<a href="https://data.cityofnewyork.us/d/6bgk-3dad" target="_blank">6bgk-3dad</a>) and <b>DOB NOW</b> safety violations (<a href="https://data.cityofnewyork.us/d/855j-jady" target="_blank">855j-jady</a>), by BIN. <b>OATH</b> (<a href="https://data.cityofnewyork.us/d/jz4z-kudi" target="_blank">jz4z-kudi</a>), by borough/block/lot; open = a balance is due or a hearing is pending. <b>FDNY</b> = FDNY summonses at OATH. FDNY violation orders are only in the FDNY Business portal, which needs a login, so they aren't checked. <b>CityPay</b> has no API; balances come from ECB/OATH.</li>
        <li><b>All properties — EPA ECHO</b>: federal air, water, hazardous-waste and drinking-water compliance for facilities registered at the address. Open = current violation; Significant Non-Compliance = red.</li>
        <li><b>New Jersey — NJDEP</b> (NJEMS map service): Known Contaminated Site or active remediation case = amber; an Administrative Consent Order on a UST or an open Immediate Environmental Concern = red; an expired UST registration = amber. NJDEP enforcement actions and penalties are only in <a href="https://njems.nj.gov/DataMiner" target="_blank">DataMiner</a> (a report form, no API). <b>NJ DCA construction permits</b> (<a href="https://data.nj.gov/d/w9se-dmra" target="_blank">w9se-dmra</a>) by municipality + block/lot: a permit with no certificate reported is listed as an open permit. These are info only; many towns don't report certificates to the state.</li>
        <li><b>Connecticut — CT DEEP</b>: formal enforcement (<a href="https://data.ct.gov/d/t2bf-45ba" target="_blank">2021+</a>, <a href="https://data.ct.gov/d/tvbr-6b6t" target="_blank">1999–2021</a>), UST enforcement and the contaminated-sites list, by town + address. An enforcement action in the last 2 years counts as open.</li>
        <li><b>Not published by any NJ/CT agency</b>: municipal construction-code notices of violation and stop-work orders, local fire-code inspections, elevator, boiler, property-maintenance and health notices. Each property's detail page lists those agencies with links and phone numbers. Records are available on request (OPRA in NJ, FOIA in CT).</li>
        <li><b>3rd-party</b>: tickets or EPA facilities in a tenant's, vendor's or vehicle's name. They're shown on the detail page but excluded from health and $ due. Owner names can be edited per property.</li>
      </ul></div>`;
  }

  // ── Detail view ──────────────────────────────────────────
  async function _openProp(id, fromHistory) {
    const root = _root(); if (!root) return;
    let p = _props.find((x) => x.id === id);
    if (!p) { const r = await window.supaFetch('violation_properties', `?select=*&id=eq.${id}`); p = r[0]; }
    if (!p) { _toast('Property not found', true); _backToList(); return; }
    _current = p; _srcFilter = 'all';
    if (!fromHistory && window.pushSubNav) window.pushSubNav('violationtracker', id, 'prop=' + id);
    root.innerHTML = '<div style="padding:40px;color:#64748b">Loading violations…</div>';
    try { await _loadViolations(id); } catch (e) { _viol = []; _toast('Could not load violations: ' + e.message, true); }
    _renderDetail();
  }

  function _renderDetail() {
    const p = _current, root = _root(); if (!p || !root) return;
    const isNY = p.state === 'NY' || (!p.state && p.nyc_covered);
    const base = _viol.filter((v) => (_showClosed || v.status === 'open') && (_showThird || !v.third_party));
    const present = SOURCES.filter((s) => _viol.some((v) => v.source === s.key) || (p.sources_checked || []).includes(s.key));
    const counts = { all: base.length }; SOURCES.forEach((s) => (counts[s.key] = base.filter((v) => v.source === s.key).length));
    const rows = _srcFilter === 'all' ? base : base.filter((v) => v.source === _srcFilter);
    const today = todayStr();
    const bins = [p.bin, ...(p.alt_bins || [])].filter(Boolean);
    const m = MUNI[String(p.municipality || '').toUpperCase()];

    root.innerHTML = `
      <button class="vt-back" onclick="vtBack()">← Back to Violation Tracker</button>
      <div class="vt-detail-head">
        <div>
          <h2>${esc(p.name)} ${p.active ? '' : '<span class="pill" style="background:#94a3b8">Deactivated</span>'}</h2>
          <div class="vt-meta">${esc(p.address || '')}${p.borough ? ' · ' + esc(p.borough) : ''}</div>
          ${isNY ? `<div class="vt-meta" style="margin-top:4px">BBL ${esc(p.bbl || '—')}${(p.alt_bbls || []).length ? ' (+' + p.alt_bbls.map(esc).join(', ') + ')' : ''} · Block ${esc(p.block || '—')} · Lot ${esc(p.lot || '—')} · BIN ${esc(bins.join(', ') || '—')}</div>`
            : `<div class="vt-meta" style="margin-top:4px">${esc(m?.label || p.municipality || '—')}${p.county ? ', ' + esc(p.county) + ' County' : ''}, ${esc(p.state || '')}${(p.lots || []).length ? ' · Block/Lot ' + p.lots.map(esc).join(', ') : ''}${p.muni_code ? ' · muni code ' + esc(p.muni_code) : ''}</div>`}
          <div class="vt-meta" style="margin-top:4px">Owner / building names: ${(p.owner_names || []).length ? p.owner_names.map(esc).join('; ') : `<i>none yet${isNY ? ' (filled from PLUTO on next check)' : ''}</i>`}${(p.match_addresses || []).length ? ` · matched addresses: ${p.match_addresses.map(esc).join('; ')}` : ''}</div>
          <div style="margin-top:10px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            ${healthPill(p.health)}
            <span><b>${p.open_count || 0}</b> open${p.hazardous_open ? ` · <span class="haz">${p.hazardous_open} hazardous</span>` : ''} · <b style="color:${Number(p.balance_due) ? '#b91c1c' : 'inherit'}">${fmt$(p.balance_due)}</b> due${p.next_hearing ? ` · next hearing ${fmtDate(p.next_hearing)}` : ''}${p.info_open ? ` · <span style="color:#64748b">${p.info_open} open permit${p.info_open === 1 ? '' : 's'} (info)</span>` : ''}${p.third_party_open ? ` · <span style="color:#64748b">${p.third_party_open} third-party${Number(p.third_party_balance) ? ' (' + fmt$(p.third_party_balance) + ')' : ''}</span>` : ''}</span>
            <span class="vt-meta">Checked ${fmtDT(p.last_checked_at)}${(p.sources_checked || []).length ? ' · ' + p.sources_checked.map((k) => SRC[k]?.label || k).join(', ') : ''}</span>
          </div>
          ${p.last_check_error ? `<div class="vt-meta" style="color:#b91c1c;margin-top:6px">⚠ ${esc(p.last_check_error)}</div>` : ''}
          ${isNY ? `<div class="vt-links">
            ${p.bin ? `<a href="${bisLink(p.bin)}" target="_blank">DOB BIS profile ↗</a><a href="${ecbLink(p.bin)}" target="_blank">ECB violations (BIS) ↗</a>` : ''}
            <a href="${DOBNOW}" target="_blank">DOB NOW public portal ↗</a>
            <a href="${OATH_FINDER}" target="_blank">OATH ticket finder ↗</a>
            <a href="${CITYPAY}" target="_blank">CityPay ↗</a>
            ${p.bbl && p.bbl.length === 10 ? `<a href="${zolaLink(p.bbl)}" target="_blank">ZoLa map ↗</a>` : ''}
          </div>` : ''}
          ${p.notes ? `<div class="vt-meta" style="margin-top:8px"><i>${esc(p.notes)}</i></div>` : ''}
        </div>
        <div class="vt-actions" style="align-items:flex-start">
          ${p.active ? `<button class="vt-btn" id="vtRunOne" onclick="vtRunCheck('${p.id}')">▶ Run check now</button>` : ''}
          <button class="vt-btn" onclick="vtOpenEdit('${p.id}')">✎ Edit</button>
          ${p.active ? `<button class="vt-btn" onclick="vtSetActive('${p.id}', false)" style="color:#b91c1c">Deactivate</button>` : `<button class="vt-btn" onclick="vtSetActive('${p.id}', true)">Reactivate</button>`}
        </div>
      </div>
      ${_agencyTable(p)}
      <div class="vt-chips">
        <span class="vt-chip ${_srcFilter === 'all' ? 'active' : ''}" onclick="vtSrc('all')">All<b>${counts.all}</b></span>
        ${present.map((s) => `<span class="vt-chip ${_srcFilter === s.key ? 'active' : ''}" onclick="vtSrc('${s.key}')">${s.label}<b>${counts[s.key]}</b></span>`).join('')}
        <label class="vt-tog"><input type="checkbox" ${_showClosed ? 'checked' : ''} onchange="vtToggle('closed', this.checked)"> Show closed / history</label>
        <label class="vt-tog"><input type="checkbox" ${_showThird ? 'checked' : ''} onchange="vtToggle('third', this.checked)"> Show third-party</label>
      </div>
      ${rows.length ? `<div class="vt-scroll"><table class="vt-table"><thead><tr><th>Source</th><th>Record #</th><th>Date</th><th>Description</th><th>Class / severity</th><th>Status</th><th>Hearing</th><th class="num">Penalty</th><th class="num">Balance</th><th>First seen</th></tr></thead><tbody>
        ${rows.map((v) => `<tr class="${v.status === 'closed' ? 'muted' : ''} ${v.third_party || v.info_only ? 'tp' : ''}">
          <td>${srcPill(v.source)}${v.third_party ? '<div class="vt-sub">3rd party</div>' : ''}${v.info_only ? '<div class="vt-sub">info</div>' : ''}</td>
          <td style="white-space:nowrap">${v.agency_url ? `<a href="${esc(v.agency_url)}" target="_blank" title="Open at the agency">${esc(v.source_id)} ↗</a>` : esc(v.source_id)}</td>
          <td style="white-space:nowrap">${fmtDate(v.issue_date)}</td>
          <td class="desc">${v.is_hazardous ? '<span class="haz">⚠ </span>' : ''}${esc(v.description || '—')}${v.violation_type && v.violation_type !== v.description ? `<div class="vt-sub">${esc(v.violation_type)}${v.issuing_agency ? ' · ' + esc(v.issuing_agency) : ''}</div>` : ''}${v.respondent && !(v.description || '').includes(v.respondent) ? `<div class="vt-sub">Respondent: ${esc(v.respondent)}</div>` : ''}</td>
          <td>${v.is_hazardous ? `<span class="haz">${esc(v.class_severity || 'Hazardous')}</span>` : esc(v.class_severity || '—')}</td>
          <td>${v.status === 'open' ? (v.info_only ? '<span class="pill" style="background:#94a3b8">Open (info)</span>' : '<span class="pill" style="background:#f59e0b">Open</span>') : '<span class="pill" style="background:#cbd5e1">Closed</span>'}<div class="vt-sub">${esc(v.source_status || '')}</div>${v.closed_at ? `<div class="vt-sub">closed ${fmtDate(v.closed_at)}</div>` : ''}</td>
          <td style="white-space:nowrap">${v.hearing_date ? `<span style="${v.status === 'open' && v.hearing_date >= today ? 'color:#dc2626;font-weight:700' : ''}">${fmtDate(v.hearing_date)}</span>` : '—'}${v.hearing_status ? `<div class="vt-sub">${esc(v.hearing_status)}</div>` : ''}</td>
          <td class="num">${v.penalty != null ? fmt$(v.penalty) : '—'}</td>
          <td class="num">${Number(v.balance_due) > 0 ? `<b style="color:#b91c1c">${fmt$(v.balance_due)}</b>` : v.balance_due != null ? '$0' : '—'}</td>
          <td style="white-space:nowrap"><span class="vt-sub">${fmtDate(v.first_seen)}</span></td>
        </tr>`).join('')}
      </tbody></table></div>` : `<div class="vt-empty">${_viol.length ? (_showClosed ? 'Nothing matches these filters.' : `No open records. ${_viol.length} closed / historical record${_viol.length === 1 ? '' : 's'} — tick <b>Show closed / history</b>.`) : p.last_checked_at ? 'No agency records found at this address.' : 'No check has run yet — click <b>▶ Run check now</b>.'}</div>`}
    `;
  }

  function _backToList(fromHistory) {
    _current = null; _viol = [];
    if (!fromHistory && window.subNavBack) { if (window.subNavBack('violationtracker')) return; }
    if (window.replaceSubNav) window.replaceSubNav('violationtracker');
    _renderList();
  }

  // ── Add / edit modal ─────────────────────────────────────
  let _propsList = null;
  async function _openEdit(id) {
    const p = id ? (_props.find((x) => x.id === id) || _current) : null;
    if (!_propsList) { try { _propsList = await window.supaFetch('properties', '?select=id,property_name&order=property_name.asc'); } catch { _propsList = []; } }
    const v = (k, sep = ', ') => esc(p ? (Array.isArray(p[k]) ? p[k].join(sep) : p[k] ?? '') : '');
    const st = p ? (p.state || (p.nyc_covered ? 'NY' : '')) : 'NY';
    const ov = document.createElement('div'); ov.className = 'vt-overlay'; ov.id = 'vtEditOverlay';
    ov.innerHTML = `<div class="vt-modal">
      <h3>${p ? 'Edit property' : 'Add property to the watch list'}</h3>
      <p class="hint">Pick the state, then search the address. NYC uses NYC Planning GeoSearch to fill BBL/BIN. NJ/CT use the US Census geocoder, and NJ also gets municipality and block/lot from the NJ parcel map.</p>
      <div class="grid">
        <div><label>State</label><select id="vtF_state" onchange="vtStateChanged()">${['NY', 'NJ', 'CT'].map((s) => `<option ${st === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div style="grid-column:span 2"><label>Find address</label><div class="row"><input id="vtAddrQ" placeholder="e.g. 575 Broadway, Manhattan  ·  340 Mount Kemble Ave, Morristown NJ" onkeydown="if(event.key==='Enter'){event.preventDefault();vtLookup()}"><button class="vt-btn" onclick="vtLookup()">Search</button></div></div>
      </div>
      <div id="vtAddrRes"></div>
      <div class="grid">
        <div><label>Name *</label><input id="vtF_name" value="${v('name')}"></div>
        <div><label>Linked portfolio property</label><select id="vtF_property_id"><option value="">— none —</option>${_propsList.map((x) => `<option value="${esc(x.id)}" ${p && p.property_id === x.id ? 'selected' : ''}>${esc(x.property_name)}</option>`).join('')}</select></div>
      </div>
      <label>Address</label><input id="vtF_address" value="${v('address')}">
      <div id="vtNyFields" style="display:${st === 'NY' ? 'block' : 'none'}">
        <div class="grid">
          <div style="grid-column:span 2"><label>BBL (10 digits)</label><div class="row"><input id="vtF_bbl" value="${v('bbl')}" placeholder="1005120023"><button class="vt-btn" onclick="vtLookupBbl()" title="Fill address/BIN from this BBL">Look up</button></div></div>
          <div><label>BIN</label><input id="vtF_bin" value="${v('bin')}" placeholder="1080019"></div>
          <div><label>Borough</label><select id="vtF_borough"><option value="">—</option>${['Manhattan', 'Bronx', 'Brooklyn', 'Queens', 'Staten Island'].map((b) => `<option ${p && p.borough === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
          <div><label>Block</label><input id="vtF_block" value="${v('block')}"></div>
          <div><label>Lot</label><input id="vtF_lot" value="${v('lot')}"></div>
        </div>
        <div class="grid">
          <div><label>Extra BBLs (condo base lot, other lots)</label><input id="vtF_alt_bbls" value="${v('alt_bbls')}" placeholder="comma-separated"></div>
          <div><label>Extra BINs (other buildings)</label><input id="vtF_alt_bins" value="${v('alt_bins')}" placeholder="comma-separated"></div>
        </div>
      </div>
      <div id="vtUsFields" style="display:${st === 'NY' ? 'none' : 'block'}">
        <div class="grid">
          <div><label>Municipality (tax)</label><input id="vtF_municipality" value="${v('municipality')}" placeholder="e.g. MORRIS TWP · GREENWICH"></div>
          <div><label>NJ muni code</label><input id="vtF_muni_code" value="${v('muni_code')}" placeholder="e.g. 1422"></div>
          <div><label>County</label><input id="vtF_county" value="${v('county')}"></div>
        </div>
        <label>Block/Lot list (NJ — e.g. 1131/30, 1131/31)</label><input id="vtF_lots" value="${v('lots')}">
      </div>
      <div class="grid">
        <div><label>Latitude</label><input id="vtF_latitude" value="${v('latitude')}"></div>
        <div><label>Longitude</label><input id="vtF_longitude" value="${v('longitude')}"></div>
      </div>
      <label>Addresses agencies may use (matched against EPA / NJDEP / CT DEEP records; separate with ;)</label>
      <input id="vtF_match_addresses" value="${v('match_addresses', '; ')}" placeholder="e.g. 331 Newman Springs Rd; 100 Schultz Dr">
      <label>Owner / building names (tickets and EPA facilities under any other name count as third-party; separate with ;)</label>
      <input id="vtF_owner_names" value="${v('owner_names', '; ')}" placeholder="NYC: blank = fill from PLUTO on next check">
      <label>Notes</label><textarea id="vtF_notes" rows="2">${v('notes')}</textarea>
      <div class="foot"><span></span><span class="row"><button class="vt-btn" onclick="vtCloseEdit()">Cancel</button><button class="vt-btn primary" id="vtSaveBtn" onclick="vtSave('${p ? p.id : ''}')">${p ? 'Save' : 'Add & run check'}</button></span></div>
    </div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) _closeEdit(); });
    document.body.appendChild(ov);
    if (p) document.getElementById('vtAddrQ').value = p.address || '';
    setTimeout(() => document.getElementById(p ? 'vtF_name' : 'vtAddrQ')?.focus(), 50);
  }
  function _stateChanged() {
    const st = document.getElementById('vtF_state').value;
    document.getElementById('vtNyFields').style.display = st === 'NY' ? 'block' : 'none';
    document.getElementById('vtUsFields').style.display = st === 'NY' ? 'none' : 'block';
  }
  function _closeEdit() { document.getElementById('vtEditOverlay')?.remove(); }
  let _lookupResults = [];
  function _renderLookup(list, msg) {
    _lookupResults = list || [];
    const el = document.getElementById('vtAddrRes'); if (!el) return;
    const line = (r) => r.bbl ? `BBL ${esc(r.bbl)} · BIN ${esc(r.bin || '—')} · ${esc(r.borough || '')}${r.owner ? ' · ' + esc(r.owner) : ''}` : `${esc(r.municipality || '')}${r.county ? ', ' + esc(r.county) : ''} ${esc(r.state || '')}${(r.lots || []).length ? ' · Block/Lot ' + r.lots.map(esc).join(', ') : ''}${r.muni_code ? ' · code ' + esc(r.muni_code) : ''}`;
    el.innerHTML = msg ? `<div class="hint" style="font-size:13px;color:#64748b;margin-top:6px">${msg}</div>` : _lookupResults.length ? `<div class="res">${_lookupResults.map((r, i) => `<div onclick="vtPick(${i})"><b>${esc(r.label || '')}</b><br><span style="color:#64748b">${line(r)}</span></div>`).join('')}</div>` : '<div style="font-size:13px;color:#64748b;margin-top:6px">No match — check the address, or fill the fields by hand.</div>';
  }
  async function _lookup() {
    const q = document.getElementById('vtAddrQ').value.trim(); if (q.length < 4) return;
    const st = document.getElementById('vtF_state').value;
    _renderLookup([], '<span class="vt-spin dark"></span>Searching…');
    try { const r = await _fn({ action: st === 'NY' ? 'lookup' : 'lookup_us', address: q }); _renderLookup(r.results); } catch (e) { _renderLookup([], 'Lookup failed: ' + esc(e.message)); }
  }
  async function _lookupBbl() {
    const bbl = document.getElementById('vtF_bbl').value.replace(/\D/g, '');
    if (bbl.length !== 10) { _toast('BBL must be 10 digits: borough (1-5) + 5-digit block + 4-digit lot', true); return; }
    _renderLookup([], '<span class="vt-spin dark"></span>Looking up BBL…');
    try { const r = await _fn({ action: 'lookup_bbl', bbl }); _renderLookup(r.results); if (r.results?.length === 1) _pick(0); } catch (e) { _renderLookup([], 'Lookup failed: ' + esc(e.message)); }
  }
  function _pick(i) {
    const r = _lookupResults[i]; if (!r) return;
    const set = (k, val) => { const el = document.getElementById('vtF_' + k); if (el && val != null && val !== '') el.value = val; };
    const label = (r.label || '').replace(/, USA$/, '');
    set('address', label);
    set('latitude', r.lat ?? r.latitude); set('longitude', r.lng ?? r.longitude);
    const street = r.street || (r.match_addresses || [])[0] || label.split(',')[0];
    const ma = document.getElementById('vtF_match_addresses'); if (ma && !ma.value) ma.value = (r.match_addresses || [street]).join('; ');
    if (r.bbl) { set('bbl', r.bbl); set('bin', r.bin || ''); set('borough', r.borough); set('block', r.block); set('lot', r.lot); document.getElementById('vtF_state').value = 'NY'; }
    else { set('municipality', r.municipality); set('muni_code', r.muni_code); set('county', r.county); set('lots', (r.lots || []).join(', ')); if (r.state) document.getElementById('vtF_state').value = r.state; }
    _stateChanged();
    const nm = document.getElementById('vtF_name'); if (nm && !nm.value) nm.value = street.replace(/\b(\w)(\w*)/g, (m, a, b) => a + b.toLowerCase());
    if (r.owner) { const on = document.getElementById('vtF_owner_names'); if (on && !on.value) on.value = r.owner; }
    _renderLookup([], `✓ Filled from ${esc(label)}`);
  }
  async function _save(id) {
    const g = (k) => (document.getElementById('vtF_' + k)?.value || '').trim();
    const list = (k, sep = ',') => g(k).split(sep).map((s) => s.trim()).filter(Boolean);
    const st = g('state') || 'NY';
    const nyc = st === 'NY';
    const numOrNull = (k) => { const n = parseFloat(g(k)); return isNaN(n) ? null : n; };
    const body = {
      name: g('name'), address: g('address') || null, property_id: g('property_id') || null, state: st, nyc_covered: nyc,
      latitude: numOrNull('latitude'), longitude: numOrNull('longitude'),
      match_addresses: list('match_addresses', ';').map((s) => s.toUpperCase()), owner_names: list('owner_names', ';'), notes: g('notes') || null, updated_at: new Date().toISOString(),
    };
    if (nyc) Object.assign(body, {
      municipality: 'New York City', bbl: g('bbl').replace(/\D/g, '') || null, bin: g('bin').replace(/\D/g, '') || null,
      borough: g('borough') || null, block: g('block') || null, lot: g('lot') || null,
      alt_bbls: list('alt_bbls').map((s) => s.replace(/\D/g, '')).filter((s) => s.length === 10),
      alt_bins: list('alt_bins').map((s) => s.replace(/\D/g, '')).filter(Boolean),
    });
    else Object.assign(body, { municipality: g('municipality').toUpperCase() || null, muni_code: g('muni_code') || null, county: g('county') || null, lots: list('lots').map((s) => s.replace(/\s+/g, '')) });
    if (!body.name) { _toast('Name is required', true); return; }
    if (nyc && !body.bin && !body.bbl) { _toast('NYC properties need a BBL or BIN — search the address or enter the BBL', true); return; }
    if (nyc && body.bbl && body.bbl.length !== 10) { _toast('BBL must be 10 digits', true); return; }
    if (!nyc && (body.latitude == null || !body.match_addresses.length)) { _toast('NJ/CT properties need a location and at least one address — search the address first', true); return; }
    if (!nyc && !body.municipality) { _toast('Municipality is required for NJ/CT', true); return; }
    const dup = nyc && _props.find((x) => x.id !== id && x.nyc_covered && ((body.bbl && x.bbl === body.bbl) || (body.bin && x.bin === body.bin)));
    if (dup) { _toast(`"${dup.name}" already tracks this BBL/BIN${dup.active ? '' : ' (deactivated — reactivate it instead)'}`, true); return; }
    const btn = document.getElementById('vtSaveBtn'); btn.disabled = true; btn.innerHTML = '<span class="vt-spin"></span>Saving…';
    try {
      let pid = id;
      if (id) await window.supaWrite('violation_properties', 'PATCH', body, `?id=eq.${id}`);
      else { const u = window.currentUser || {}; const r = await window.supaWrite('violation_properties', 'POST', { ...body, created_by: u.email || null }); pid = r[0]?.id; }
      if (pid) { btn.innerHTML = '<span class="vt-spin"></span>Checking agencies…'; await _fn({ property_ids: [pid], trigger: 'manual' }).catch((e) => _toast('Saved, but the check failed: ' + e.message, true)); }
      _closeEdit();
      await _load();
      if (pid) _openProp(pid, !!(_current && _current.id === pid)); else _renderList();
      _toast(id ? 'Saved' : 'Property added');
    } catch (e) { btn.disabled = false; btn.textContent = id ? 'Save' : 'Add & run check'; _toast('Save failed: ' + e.message, true); }
  }

  // ── Actions ──────────────────────────────────────────────
  async function _runCheck(pid) {
    const btn = document.getElementById(pid ? 'vtRunOne' : 'vtRunAll');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="vt-spin dark"></span>Checking agencies…'; }
    try {
      const r = await _fn(pid ? { property_ids: [pid], trigger: 'manual' } : { trigger: 'manual' });
      await _load();
      if (_current) { _current = _props.find((x) => x.id === _current.id) || _current; await _loadViolations(_current.id); _renderDetail(); } else _renderList();
      const n = (r.results || []).reduce((a, x) => a + (x.new_open || 0), 0), c = (r.results || []).reduce((a, x) => a + (x.newly_closed || 0), 0);
      _toast(r.ok ? `Check complete — ${n} new open, ${c} closed` : `Check finished with errors: ${(r.errors || []).slice(0, 2).join('; ')}`, !r.ok);
    } catch (e) { _toast('Check failed: ' + e.message, true); if (btn) { btn.disabled = false; btn.textContent = '▶ Run check now'; } }
  }
  async function _setActive(id, active) {
    if (!active && !confirm('Deactivate this property? It stops being checked; its history is kept and you can reactivate it later.')) return;
    try {
      await window.supaWrite('violation_properties', 'PATCH', { active, updated_at: new Date().toISOString() }, `?id=eq.${id}`);
      await _load();
      if (_current && _current.id === id) { _current = _props.find((x) => x.id === id); _renderDetail(); } else _renderList();
      _toast(active ? 'Reactivated' : 'Deactivated');
    } catch (e) { _toast('Failed: ' + e.message, true); }
  }

  // ── Public API ───────────────────────────────────────────
  window.vtOpen = (id) => _openProp(id);
  window.vtBack = () => _backToList();
  window.vtSrc = (k) => { _srcFilter = k; _renderDetail(); };
  window.vtToggle = (k, on) => { if (k === 'closed') _showClosed = on; else _showThird = on; _renderDetail(); };
  window.vtToggleInactive = () => { _showInactive = !_showInactive; _renderList(); };
  window.vtRefresh = async () => { try { await _load(); if (_current) { _current = _props.find((x) => x.id === _current.id) || _current; await _loadViolations(_current.id); _renderDetail(); } else _renderList(); _toast('Refreshed'); } catch (e) { _toast(e.message, true); } };
  window.vtRunCheck = _runCheck;
  window.vtSetActive = _setActive;
  window.vtOpenEdit = _openEdit;
  window.vtCloseEdit = _closeEdit;
  window.vtLookup = _lookup;
  window.vtLookupBbl = _lookupBbl;
  window.vtPick = _pick;
  window.vtSave = _save;
  window.vtStateChanged = _stateChanged;

  window.violationTrackerInit = async function () {
    _injectCSS();
    const root = _root(); if (!root) return;
    if (!_inited) {
      _inited = true;
      if (window.registerSubNav) window.registerSubNav('violationtracker', (sub) => { if (sub) _openProp(sub, true); else _backToList(true); });
    }
    root.innerHTML = '<div style="padding:40px;color:#64748b">Loading Violation Tracker…</div>';
    try {
      await _load();
      const deep = window.getHashParam && window.getHashParam('prop');
      if (deep) { _openProp(deep, true); return; }
      if (_current) { _current = _props.find((x) => x.id === _current.id) || null; if (_current) { await _loadViolations(_current.id); _renderDetail(); return; } }
      _renderList();
    } catch (e) {
      root.innerHTML = `<div class="vt-empty">Could not load Violation Tracker: ${esc(e.message)}<br><br><small>Has <code>migration/create-violation-tracker.sql</code> been run?</small></div>`;
    }
  };
})();
