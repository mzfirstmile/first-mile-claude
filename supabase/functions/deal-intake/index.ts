// supabase/functions/deal-intake/index.ts
// Deal Tracking intake: takes an inbound email (or raw text), extracts prospective-deal facts with
// Claude, geocodes the address, matches it to the nearest Market Research town, pulls that town's
// category scores, writes an assessment + HTML report to `deal_tracking`, and returns the report
// HTML so auto-reply can send it back to the sender.
//
// Deploy: supabase functions deploy deal-intake
// Secrets: CLAUDE_API_KEY, ANTHROPIC_WORKSPACE_ID, SB_SERVICE_KEY (SUPABASE_URL is injected)
//
// POST body (one of):
//   { emailId }                                  — classify + intake an inbox email (used by auto-reply)
//   { text, from, from_name, subject, force }    — manual/chat intake (force=true skips the "is this a deal?" gate)
//   { dealId }                                   — re-score an existing deal (re-runs match + assessment on stored facts)
// Response: { is_deal, deal_id, deal, replyHtml }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DASHBOARD = "https://admin.firstmilecap.com";
const MODEL = "claude-sonnet-4-6";
const MATCH_RADIUS_MI = 20;      // beyond this, "no shortlisted market nearby"
const NEARBY_RADIUS_MI = 25;
const NEARBY_LIMIT = 6;

// ── Claude helper ────────────────────────────────────────────
async function claude(system: string, user: string, tool: any, maxTokens = 4000): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "anthropic-workspace-id": Deno.env.get("ANTHROPIC_WORKSPACE_ID") || "wrkspc_01KFMjdE8FRViEkxanZET8rH",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const block = (data.content || []).find((b: any) => b.type === "tool_use");
  if (!block) throw new Error("Claude returned no tool_use block");
  return block.input;
}

// ── Step 1: extraction ───────────────────────────────────────
const EXTRACT_TOOL = {
  name: "record_deal",
  description: "Record the structured facts of a prospective real-estate deal described in an email.",
  input_schema: {
    type: "object",
    properties: {
      is_deal: { type: "boolean", description: "true only if the email describes a specific prospective real-estate investment opportunity (an asset, note, site, or recap being offered/considered). false for general questions, task replies, newsletters, internal chatter." },
      confidence: { type: "number", description: "0-1 confidence in is_deal" },
      deal_name: { type: "string", description: "Short name, e.g. '1 & 25 Deforest Ave — Summit NJ office'" },
      address: { type: "string", description: "Street address if given" },
      city: { type: "string" },
      state: { type: "string", description: "2-letter state" },
      zip: { type: "string" },
      asset_type: { type: "string", enum: ["office", "retail", "multifamily", "industrial", "mixed_use", "medical", "hospitality", "land", "other"] },
      deal_type: { type: "string", enum: ["acquisition", "note", "recap", "development", "jv", "ground_lease", "other"] },
      sf: { type: "number", description: "Rentable/gross square feet" },
      units: { type: "integer" },
      asking_price: { type: "number", description: "USD" },
      noi: { type: "number", description: "Annual NOI in USD (in-place or T12 if stated)" },
      cap_rate: { type: "number", description: "Percent, e.g. 6.5" },
      occupancy_pct: { type: "number" },
      year_built: { type: "integer" },
      broker: { type: "string" },
      seller: { type: "string" },
      key_tenants: { type: "string", description: "Comma-separated anchor tenants with SF/LXD if given" },
      debt: { type: "string", description: "Existing/assumable debt terms if mentioned" },
      timeline: { type: "string", description: "Bid date, call for offers, closing expectations" },
      other_facts: { type: "array", items: { type: "string" }, description: "Any other material facts (WALT, rent PSF, capex needs, zoning, upside story)" },
      sender_ask: { type: "string", description: "What the sender is asking the team to do, in one sentence" },
    },
    required: ["is_deal", "confidence"],
  },
};

const EXTRACT_SYSTEM = `You are the deal-intake analyst for First Mile Capital, a New York commercial real estate investment firm (office, retail, mixed-use, notes, development). Colleagues forward prospective deals to the AI assistant mailbox. Extract the facts exactly as stated — never invent numbers. Derive price_psf only from stated price and SF. If cap rate is not stated but NOI and price are, leave cap_rate empty (it will be computed). Use null/omit for anything not in the text.`;

// ── Step 2: geocode (Nominatim) ──────────────────────────────
async function geocode(q: string): Promise<{ lat: number; lng: number; display: string } | null> {
  if (!q || !q.trim()) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "User-Agent": "FirstMileCapital-DealIntake/1.0 (aiassistant@firstmilecap.com)" } });
  if (!res.ok) return null;
  const arr = await res.json();
  if (!arr?.length) return null;
  return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon), display: arr[0].display_name };
}

function distMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// market_research_markets.name already carries the state ("Florham Park, NJ") — normalize once
const townOf = (m: any) => String(m.name || "").replace(/,\s*[A-Z]{2}$/, "");
const marketLabel = (m: any) => (/,\s*[A-Z]{2}$/.test(String(m.name || "")) ? m.name : `${m.name}, ${m.state}`);

function tierFor(score: number | null): number | null {
  if (score == null) return null;
  const s = Math.round(score * 10) / 10;
  return s >= 8.5 ? 1 : s >= 7.0 ? 2 : s >= 4.0 ? 3 : 4;
}

// ── Step 3: market match ─────────────────────────────────────
async function loadShortlist(sb: any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("market_research_markets")
      .select("id,name,state,latitude,longitude,population,median_household_income,score,tier,office_score,office_tier,rank_residential,rank_office,thesis,nearest_top50_city")
      .eq("phase", "shortlisted")
      .range(from, from + 999);
    if (error) throw new Error(`markets: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function categoryScores(sb: any, marketId: string): Promise<any[]> {
  const { data, error } = await sb
    .from("market_research_scores")
    .select("value_numeric,value_numeric_office,value_text,source,updated_by,criterion:market_research_criteria(name,name_office,category_id,is_active_residential,is_active_office,target_label,target_label_office)")
    .eq("market_id", marketId);
  if (error) throw new Error(`scores: ${error.message}`);
  const { data: cats, error: cErr } = await sb
    .from("market_research_categories")
    .select("id,name,slug,weight,weight_office,sort_order,is_active")
    .order("sort_order");
  if (cErr) throw new Error(`categories: ${cErr.message}`);
  const byCat: Record<string, any> = {};
  for (const c of cats || []) byCat[c.id] = { category: c.name, slug: c.slug, weight_res: Number(c.weight), weight_office: Number(c.weight_office), res: [] as number[], off: [] as number[], criteria: [] as any[] };
  for (const s of data || []) {
    const cr = s.criterion; if (!cr?.category_id || !byCat[cr.category_id]) continue;
    const b = byCat[cr.category_id];
    if (cr.is_active_residential !== false && s.value_numeric != null) b.res.push(Number(s.value_numeric));
    if (cr.is_active_office !== false && s.value_numeric_office != null) b.off.push(Number(s.value_numeric_office));
    b.criteria.push({ name: cr.name, value_res: s.value_numeric, value_office: s.value_numeric_office, value_text: s.value_text, source: s.source, active_res: cr.is_active_residential !== false, active_office: cr.is_active_office !== false });
  }
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  return Object.values(byCat).map((b: any) => ({ category: b.category, slug: b.slug, weight_res: b.weight_res, weight_office: b.weight_office, mean_res: avg(b.res), mean_office: avg(b.off), n: b.criteria.length, criteria: b.criteria.sort((x: any, y: any) => x.name.localeCompare(y.name)) }));
}

// ── Step 4: assessment ───────────────────────────────────────
const ASSESS_TOOL = {
  name: "record_assessment",
  description: "Record the opportunity assessment.",
  input_schema: {
    type: "object",
    properties: {
      recommendation: { type: "string", enum: ["Pursue", "Review", "Pass"] },
      headline: { type: "string", description: "One sentence verdict" },
      summary: { type: "string", description: "2-4 sentence narrative tying the deal facts to the market research" },
      strengths: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      questions: { type: "array", items: { type: "string" }, description: "Diligence questions / data to request from the sender or broker" },
      market_fit_note: { type: "string", description: "How well the matched market fits First Mile's thesis for this asset type; call out if the match is distant or the town scored poorly" },
    },
    required: ["recommendation", "headline", "summary", "strengths", "risks", "questions"],
  },
};

const ASSESS_SYSTEM = `You are the acquisitions analyst for First Mile Capital (NYC-based; owns suburban Class A office in NJ/CT, NYC retail/mixed-use, and does note purchases, recaps and ground-up development). First Mile's thesis: buy well-located assets in small affluent towns and employment nodes that the Market Research module ranks highly (composite 0-10; Tier 1 ≥ 8.5, Tier 2 7.0-8.4, Tier 3 4.0-6.9, Tier 4 < 4.0). The office view weights Office Demand (LEHD payroll jobs in town), Company Concentrations and Relation to Other Asset Classes; the residential view weights Demographics, Education and Quality of Life.

Rules: be direct and analytical; never invent numbers; when a metric is missing say so and ask for it. Judge (a) market quality from the research scores, (b) deal metrics vs. what you'd expect for the asset type (cap rate, price PSF, occupancy, tenancy), (c) fit with First Mile's playbook. Recommendation guidance: Pursue = Tier 1-2 market AND deal metrics look attractive or fixable; Review = mixed signals or key data missing; Pass = weak market (Tier 3-4 with no offsetting story) or clearly mispriced. If the nearest researched town is more than ${MATCH_RADIUS_MI} miles away, say the market is outside the research universe and weight your view accordingly.`;

// ── Report HTML ──────────────────────────────────────────────
const fmt$ = (n: any) => (n == null || isNaN(Number(n)) ? "—" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const fmtN = (n: any, d = 0) => (n == null || isNaN(Number(n)) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d }));
const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const tierColor = (t: number | null) => (t === 1 ? "#059669" : t === 2 ? "#0ea5e9" : t === 3 ? "#f59e0b" : t === 4 ? "#ef4444" : "#94a3b8");
const recColor = (r: string) => (r === "Pursue" ? "#059669" : r === "Pass" ? "#ef4444" : "#f59e0b");

function scoreBar(v: number | null): string {
  if (v == null) return `<span style="color:#94a3b8">—</span>`;
  const pct = Math.max(0, Math.min(100, (v / 10) * 100));
  const col = v >= 8.5 ? "#059669" : v >= 7 ? "#0ea5e9" : v >= 4 ? "#f59e0b" : "#ef4444";
  return `<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;min-width:90px"><div style="width:${pct}%;height:100%;background:${col}"></div></div><b style="min-width:28px;text-align:right">${v.toFixed(1)}</b></div>`;
}

function buildReport(d: any, m: any, cats: any[], nearby: any[], a: any, view: string): string {
  const th = `style="text-align:left;padding:6px 10px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:.04em"`;
  const td = `style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:14px;vertical-align:top"`;
  const tdx = (x: string) => `style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:14px;vertical-align:top;${x}"`;
  const thx = (x: string) => `style="text-align:left;padding:6px 10px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:.04em;${x}"`;
  const row = (k: string, v: string) => `<tr><td ${td}><span style="color:#64748b">${k}</span></td><td ${td}>${v}</td></tr>`;
  const factRows = [
    row("Address", esc([d.address, d.city, d.state, d.zip].filter(Boolean).join(", ") || "—")),
    row("Asset / Deal type", `${esc(d.asset_type || "—")} · ${esc(d.deal_type || "—")}`),
    row("Size", `${d.sf ? fmtN(d.sf) + " SF" : ""}${d.units ? (d.sf ? " · " : "") + fmtN(d.units) + " units" : ""}` || "—"),
    row("Asking price", `${fmt$(d.asking_price)}${d.price_psf ? ` <span style="color:#64748b">(${fmt$(d.price_psf)}/SF)</span>` : ""}`),
    row("NOI / Cap rate", `${fmt$(d.noi)}${d.cap_rate != null ? ` · ${Number(d.cap_rate).toFixed(2)}% cap` : ""}`),
    row("Occupancy", d.occupancy_pct != null ? `${fmtN(d.occupancy_pct, 1)}%` : "—"),
    row("Key tenants", esc(d.key_tenants || "—")),
    d.extracted?.debt ? row("Debt", esc(d.extracted.debt)) : "",
    d.extracted?.timeline ? row("Timeline", esc(d.extracted.timeline)) : "",
    row("Broker / Seller", `${esc(d.broker || "—")} / ${esc(d.seller || "—")}`),
    row("Submitted by", `${esc(d.submitted_by_name || d.submitted_by || "—")}`),
  ].join("");

  const viewLabel = view === "office" ? "Office view" : "Residential view";
  const marketBlock = m
    ? `<table cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:6px">
        ${row("Matched market", `<a href="${DASHBOARD}/#marketresearch&market=${m.id}" style="color:#0ea5e9;font-weight:600">${esc(marketLabel(m))}</a> <span style="color:#64748b">· ${d.market_distance_mi != null ? d.market_distance_mi.toFixed(1) + " mi from site" : ""}${d.market_distance_mi > MATCH_RADIUS_MI ? ' · <b style="color:#ef4444">outside research radius</b>' : ""}</span>`)}
        ${row("Population / Median HHI", `${fmtN(m.population)} / ${fmt$(m.median_household_income)}`)}
        ${row("Office score", `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${tierColor(m.office_tier)};color:#fff;font-weight:700;font-size:12px">T${m.office_tier ?? "—"}</span> &nbsp;<b>${m.office_score ?? "—"}</b> / 10 &nbsp;<span style="color:#64748b">rank #${m.rank_office ?? "—"} of shortlist</span>`)}
        ${row("Residential score", `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${tierColor(m.tier)};color:#fff;font-weight:700;font-size:12px">T${m.tier ?? "—"}</span> &nbsp;<b>${m.score ?? "—"}</b> / 10 &nbsp;<span style="color:#64748b">rank #${m.rank_residential ?? "—"}</span>`)}
        ${m.thesis ? row("Market thesis", `<span style="color:#334155">${esc(m.thesis)}</span>`) : ""}
      </table>`
    : `<p style="color:#ef4444"><b>No researched market could be matched</b> — the address could not be geocoded or no shortlisted town is within ${NEARBY_RADIUS_MI} miles.</p>`;

  const catRows = cats
    .filter((c) => (view === "office" ? c.weight_office > 0 : c.weight_res > 0))
    .map((c) => {
      const mean = view === "office" ? c.mean_office : c.mean_res;
      const w = view === "office" ? c.weight_office : c.weight_res;
      return `<tr><td ${td}>${esc(c.category)}</td><td ${tdx("padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;text-align:center")}>${w}</td><td ${td}>${scoreBar(mean)}</td></tr>`;
    })
    .join("");

  const nearbyRows = nearby
    .map((n) => `<tr><td ${td}><a href="${DASHBOARD}/#marketresearch&market=${n.id}" style="color:#0ea5e9">${esc(marketLabel(n))}</a></td><td ${tdx("padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:14px;text-align:right")}>${n.miles.toFixed(1)}</td><td ${tdx("padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:14px;text-align:center")}><span style="color:${tierColor(n.office_tier)};font-weight:700">${n.office_score ?? "—"}</span> <span style="color:#94a3b8">T${n.office_tier ?? "—"}</span></td><td ${tdx("padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:14px;text-align:center")}><span style="color:${tierColor(n.tier)};font-weight:700">${n.score ?? "—"}</span> <span style="color:#94a3b8">T${n.tier ?? "—"}</span></td></tr>`)
    .join("");

  const list = (arr: string[] | undefined) => (arr?.length ? `<ul style="margin:6px 0 0 18px;padding:0">${arr.map((s) => `<li style="margin:3px 0">${esc(s)}</li>`).join("")}</ul>` : `<p style="color:#94a3b8;margin:4px 0">—</p>`);

  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1e293b;max-width:760px">
  <div style="border-left:4px solid ${recColor(a.recommendation)};padding:10px 14px;background:#f8fafc;border-radius:0 8px 8px 0;margin-bottom:14px">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b">Deal Tracking · Opportunity Report</div>
    <div style="font-size:20px;font-weight:700;margin:2px 0">${esc(d.deal_name || "Prospective deal")}</div>
    <div style="margin-top:6px"><span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${recColor(a.recommendation)};color:#fff;font-weight:700;font-size:13px">${esc(a.recommendation)}</span>
      &nbsp; <b>Opportunity score ${d.opportunity_score != null ? Number(d.opportunity_score).toFixed(1) : "—"} / 10</b> <span style="color:#64748b">(Tier ${d.opportunity_tier ?? "—"}, ${viewLabel})</span></div>
    <div style="margin-top:6px;font-size:15px">${esc(a.headline)}</div>
  </div>

  <p style="margin:0 0 14px;font-size:15px;line-height:1.5">${esc(a.summary)}</p>

  <h3 style="font-size:14px;margin:18px 0 4px;color:#0f172a">Deal facts (as submitted)</h3>
  <table cellspacing="0" style="width:100%;border-collapse:collapse">${factRows}</table>

  <h3 style="font-size:14px;margin:18px 0 4px;color:#0f172a">Market match — Market Research module</h3>
  ${marketBlock}
  ${a.market_fit_note ? `<p style="margin:8px 0 0;font-size:14px;color:#334155"><b>Fit:</b> ${esc(a.market_fit_note)}</p>` : ""}

  ${catRows ? `<h3 style="font-size:14px;margin:18px 0 4px;color:#0f172a">Category scores — ${viewLabel}</h3>
  <table cellspacing="0" style="width:100%;border-collapse:collapse"><tr><th ${th}>Category</th><th ${thx("text-align:center;padding:6px 10px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569")}>Weight</th><th ${th}>Score</th></tr>${catRows}</table>` : ""}

  ${nearbyRows ? `<h3 style="font-size:14px;margin:18px 0 4px;color:#0f172a">Other researched towns within ${NEARBY_RADIUS_MI} mi</h3>
  <table cellspacing="0" style="width:100%;border-collapse:collapse"><tr><th ${th}>Town</th><th ${thx("text-align:right;padding:6px 10px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569")}>Miles</th><th ${thx("text-align:center;padding:6px 10px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569")}>Office</th><th ${thx("text-align:center;padding:6px 10px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569")}>Residential</th></tr>${nearbyRows}</table>` : ""}

  <table cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:12px 0;margin:14px -12px 0"><tr>
    <td style="width:50%;vertical-align:top;background:#f0fdf4;border-radius:8px;padding:10px 12px"><b style="color:#059669">Strengths</b>${list(a.strengths)}</td>
    <td style="width:50%;vertical-align:top;background:#fef2f2;border-radius:8px;padding:10px 12px"><b style="color:#ef4444">Risks</b>${list(a.risks)}</td>
  </tr></table>

  <h3 style="font-size:14px;margin:18px 0 4px;color:#0f172a">Diligence questions</h3>
  ${list(a.questions)}

  <p style="margin-top:18px;font-size:13px;color:#64748b">Logged in <a href="${DASHBOARD}/#dealtracking&deal=${d.id}" style="color:#0ea5e9">Deal Tracking</a> on the admin dashboard. Market scores come from the Market Research module (composite of ${cats.length} weighted categories). Deal-level numbers are as submitted and unverified.</p>
</div>`;
}

// ── Excel export of the whole deal table (attached to every reply) ──
async function buildDealsXlsx(sb: any): Promise<{ name: string; contentType: string; contentBytes: string; count: number }> {
  const { data, error } = await sb
    .from("deal_tracking")
    .select("id,created_at,submitted_by_name,submitted_by,deal_name,address,city,state,asset_type,deal_type,sf,units,asking_price,price_psf,noi,cap_rate,occupancy_pct,key_tenants,market_name,market_distance_mi,market_score_office,market_tier_office,market_rank_office,market_score_res,market_tier_res,market_rank_res,scoring_view,opportunity_score,opportunity_tier,recommendation,status,notes")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`xlsx export: ${error.message}`);
  const num = (v: any) => (v == null ? null : Number(v));
  const rows = (data || []).map((d: any) => ({
    "Deal": d.deal_name, "Status": d.status, "Recommendation": d.recommendation,
    "Opportunity Score": num(d.opportunity_score), "Opp. Tier": d.opportunity_tier, "Scoring View": d.scoring_view,
    "Address": d.address, "City": d.city, "State": d.state, "Asset Type": d.asset_type, "Deal Type": d.deal_type,
    "SF": num(d.sf), "Units": d.units, "Asking Price": num(d.asking_price), "$/SF": num(d.price_psf), "NOI": num(d.noi), "Cap Rate %": num(d.cap_rate), "Occupancy %": num(d.occupancy_pct),
    "Key Tenants": d.key_tenants,
    "Matched Market": d.market_name, "Miles to Market": num(d.market_distance_mi),
    "Office Score": num(d.market_score_office), "Office Tier": d.market_tier_office, "Office Rank": d.market_rank_office,
    "Residential Score": num(d.market_score_res), "Residential Tier": d.market_tier_res, "Residential Rank": d.market_rank_res,
    "Submitted By": d.submitted_by_name || d.submitted_by, "Submitted": d.created_at ? new Date(d.created_at) : null,
    "Notes": d.notes, "Portal Link": `${DASHBOARD}/#dealtracking&deal=${d.id}`,
  }));
  const ws = XLSX.utils.json_to_sheet(rows, { cellDates: true });
  const headers = Object.keys(rows[0] || { Deal: 1 });
  ws["!cols"] = headers.map((h) => ({ wch: Math.min(48, Math.max(10, h.length + 2, ...rows.map((r: any) => String(r[h] ?? "").length).slice(0, 200))) }));
  ws["!autofilter"] = { ref: ws["!ref"] };
  // number formats
  const fmtFor: Record<string, string> = { "Asking Price": "$#,##0", "$/SF": "$#,##0", "NOI": "$#,##0", "SF": "#,##0", "Cap Rate %": "0.00", "Occupancy %": "0.0", "Miles to Market": "0.0", "Submitted": "yyyy-mm-dd" };
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const h = headers[c], f = fmtFor[h]; if (!f) continue;
    for (let r = 1; r <= range.e.r; r++) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.v != null) cell.z = f; }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Deal Tracking");
  const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx", cellDates: true });
  const stamp = new Date().toISOString().slice(0, 10);
  return { name: `First_Mile_Deal_Tracking_${stamp}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", contentBytes: b64, count: rows.length };
}

// Acknowledgement + headline numbers that lead the email reply (the full report follows)
function buildReplyIntro(deal: any, primary: any, a: any, view: string, xlsxCount: number): string {
  const score = deal.opportunity_score != null ? Number(deal.opportunity_score).toFixed(1) : "—";
  const rank = primary ? (view === "office" ? primary.rank_office : primary.rank_residential) : null;
  const li = (k: string, v: string) => `<li style="margin:3px 0"><span style="color:#64748b">${k}:</span> ${v}</li>`;
  return `
<p>Got it — I logged <b>${esc(deal.deal_name || "this deal")}</b> in Deal Tracking and scored it against our Market Research universe.</p>
<ul style="margin:6px 0 10px 18px;padding:0;font-size:15px">
  ${li("Recommendation", `<b style="color:${recColor(a.recommendation)}">${esc(a.recommendation)}</b> — ${esc(a.headline || "")}`)}
  ${li("Opportunity score", `<b>${score} / 10</b> (Tier ${deal.opportunity_tier ?? "—"}, ${view} view)`)}
  ${primary ? li("Market match", `<a href="${DASHBOARD}/#marketresearch&market=${primary.id}" style="color:#0ea5e9">${esc(marketLabel(primary))}</a>${deal.market_distance_mi != null ? ` (${Number(deal.market_distance_mi).toFixed(1)} mi)` : ""} — ranked <b>#${rank ?? "—"}</b> of ~1,870 researched towns in the ${view} view${deal.market_distance_mi > MATCH_RADIUS_MI ? ' · <b style="color:#ef4444">outside research radius</b>' : ""}`) : li("Market match", `<span style="color:#ef4444">none — address could not be matched to a researched town</span>`)}
</ul>
<p style="margin:8px 0">
  <a href="${DASHBOARD}/#dealtracking&deal=${deal.id}" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;font-weight:600;padding:8px 14px;border-radius:8px;margin-right:8px">Open this deal</a>
  <a href="${DASHBOARD}/#dealtracking" style="display:inline-block;background:#f1f5f9;color:#0f172a;text-decoration:none;font-weight:600;padding:8px 14px;border-radius:8px">View all deals on the portal</a>
</p>
<p style="color:#64748b;font-size:13px">Attached: Excel export of the full Deal Tracking table (${xlsxCount} deal${xlsxCount === 1 ? "" : "s"}). Full opportunity report below.</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:14px 0">`;
}

// ── Main pipeline ────────────────────────────────────────────
async function intake(sb: any, opts: { text: string; from?: string; fromName?: string; subject?: string; emailId?: string; force?: boolean; existing?: any; source?: string }) {
  // 1. extract (or reuse stored facts on re-score)
  let ex: any;
  if (opts.existing?.extracted) ex = { ...opts.existing.extracted, is_deal: true };
  else {
    ex = await claude(EXTRACT_SYSTEM, `Subject: ${opts.subject || ""}\nFrom: ${opts.fromName || ""} <${opts.from || ""}>\n\n${opts.text}`, EXTRACT_TOOL, 2000);
    if (!ex.is_deal && !opts.force) return { is_deal: false, confidence: ex.confidence };
  }
  if (ex.asking_price && ex.sf && !ex.price_psf) ex.price_psf = Math.round(ex.asking_price / ex.sf);
  if (ex.asking_price && ex.noi && ex.cap_rate == null) ex.cap_rate = Math.round((ex.noi / ex.asking_price) * 10000) / 100;

  // 2. geocode: full address → city/state
  let geo: any = null;
  if (opts.existing?.latitude) geo = { lat: opts.existing.latitude, lng: opts.existing.longitude };
  else {
    const full = [ex.address, ex.city, ex.state, ex.zip].filter(Boolean).join(", ");
    geo = await geocode(full);
    if (!geo && (ex.city || ex.zip)) geo = await geocode([ex.city, ex.state, ex.zip].filter(Boolean).join(", "));
  }

  // 3. market match
  const markets = await loadShortlist(sb);
  let primary: any = null, nearby: any[] = [], distance: number | null = null;
  if (geo) {
    const ranked = markets.filter((m) => m.latitude != null).map((m) => ({ ...m, miles: distMi(geo.lat, geo.lng, m.latitude, m.longitude) })).sort((a, b) => a.miles - b.miles);
    // prefer exact town-name match within radius, else nearest
    const named = ex.city ? ranked.find((m) => townOf(m).toLowerCase() === String(ex.city).toLowerCase() && (!ex.state || m.state === ex.state) && m.miles <= NEARBY_RADIUS_MI) : null;
    primary = named || ranked[0] || null;
    if (primary) distance = primary.miles;
    nearby = ranked.filter((m) => m.id !== primary?.id && m.miles <= NEARBY_RADIUS_MI).slice(0, NEARBY_LIMIT)
      .map((m) => ({ id: m.id, name: m.name, state: m.state, miles: Math.round(m.miles * 10) / 10, score: m.score, tier: m.tier, office_score: m.office_score, office_tier: m.office_tier }));
  } else if (ex.city) {
    primary = markets.find((m) => townOf(m).toLowerCase() === String(ex.city).toLowerCase() && (!ex.state || m.state === ex.state)) || null;
  }
  const cats = primary ? await categoryScores(sb, primary.id) : [];

  // 4. scoring view + opportunity score
  const view = ["office", "medical", "mixed_use"].includes(ex.asset_type) ? "office" : "residential";
  const oppScore = primary ? (view === "office" ? primary.office_score : primary.score) : null;
  const oppTier = tierFor(oppScore != null ? Number(oppScore) : null);

  // 5. assessment
  const marketCtx = primary
    ? `Matched market: ${marketLabel(primary)} (${distance != null ? distance.toFixed(1) + " mi from site" : "name match"}); pop ${primary.population}, median HHI $${primary.median_household_income}. Office view: ${primary.office_score}/10 Tier ${primary.office_tier} (rank #${primary.rank_office} of ~1,870 shortlisted towns). Residential view: ${primary.score}/10 Tier ${primary.tier} (rank #${primary.rank_residential}). Market thesis: ${primary.thesis || "n/a"}.\nCategory means (${view} view): ${cats.map((c) => `${c.category}=${view === "office" ? c.mean_office : c.mean_res}`).join("; ")}.\nNotable criteria: ${cats.flatMap((c) => c.criteria.filter((k: any) => (view === "office" ? k.active_office : k.active_res)).slice(0, 4).map((k: any) => `${k.name}: ${k.value_text ?? (view === "office" ? k.value_office : k.value_res)}`)).join("; ")}.\nOther researched towns nearby: ${nearby.map((n) => `${marketLabel(n)} ${n.miles}mi (off ${n.office_score}/res ${n.score})`).join(", ") || "none within 25 mi"}.`
    : `No researched market matched (address not geocodable or none of the ~1,870 shortlisted towns is nearby).`;
  const dealCtx = `Deal facts: ${JSON.stringify(ex)}\nScoring view chosen: ${view}. Opportunity score (market composite): ${oppScore ?? "n/a"} (Tier ${oppTier ?? "n/a"}).`;
  const a = await claude(ASSESS_SYSTEM, `${dealCtx}\n\n${marketCtx}\n\nOriginal email:\n${opts.text.slice(0, 6000)}`, ASSESS_TOOL, 2500);

  // 6. persist
  const rowBase: any = {
    updated_at: new Date().toISOString(),
    deal_name: ex.deal_name, address: ex.address, city: ex.city, state: ex.state, zip: ex.zip,
    latitude: geo?.lat ?? null, longitude: geo?.lng ?? null,
    asset_type: ex.asset_type, deal_type: ex.deal_type, sf: ex.sf, units: ex.units, asking_price: ex.asking_price, price_psf: ex.price_psf,
    noi: ex.noi, cap_rate: ex.cap_rate, occupancy_pct: ex.occupancy_pct, year_built: ex.year_built, broker: ex.broker, seller: ex.seller, key_tenants: ex.key_tenants,
    extracted: ex,
    market_id: primary?.id ?? null, market_name: primary ? marketLabel(primary) : null, market_distance_mi: distance != null ? Math.round(distance * 10) / 10 : null,
    market_score_res: primary?.score ?? null, market_tier_res: primary?.tier ?? null, market_rank_res: primary?.rank_residential ?? null,
    market_score_office: primary?.office_score ?? null, market_tier_office: primary?.office_tier ?? null, market_rank_office: primary?.rank_office ?? null,
    scoring_view: view, nearby_markets: nearby, category_scores: cats,
    opportunity_score: oppScore, opportunity_tier: oppTier, recommendation: a.recommendation, assessment: a,
  };
  let deal: any;
  if (opts.existing) {
    const { data, error } = await sb.from("deal_tracking").update(rowBase).eq("id", opts.existing.id).select().single();
    if (error) throw new Error(`update: ${error.message}`);
    deal = data;
  } else {
    const ins = { ...rowBase, source: opts.source || "email", source_email_id: opts.emailId ?? null, submitted_by: opts.from ?? null, submitted_by_name: opts.fromName ?? null, email_subject: opts.subject ?? null, raw_text: opts.text, status: "new" };
    const { data, error } = await sb.from("deal_tracking").upsert(ins, { onConflict: "source_email_id", ignoreDuplicates: false }).select().single();
    if (error) throw new Error(`insert: ${error.message}`);
    deal = data;
  }
  const html = buildReport({ ...deal, market_distance_mi: deal.market_distance_mi != null ? Number(deal.market_distance_mi) : null }, primary, cats, nearby, a, view);
  await sb.from("deal_tracking").update({ report_html: html }).eq("id", deal.id);
  // Excel export of the whole table + acknowledgement intro for the email reply
  let attachment: any = null, xlsxCount = 0;
  try { attachment = await buildDealsXlsx(sb); xlsxCount = attachment.count; } catch (e) { console.warn(`xlsx export failed: ${e}`); }
  const replyHtml = buildReplyIntro(deal, primary, a, view, xlsxCount) + html;
  return { is_deal: true, deal_id: deal.id, deal: { ...deal, report_html: html }, replyHtml, attachments: attachment ? [{ name: attachment.name, contentType: attachment.contentType, contentBytes: attachment.contentBytes }] : [] };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const body = await req.json();
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SB_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (body.dealId) {
      const { data: existing, error } = await sb.from("deal_tracking").select("*").eq("id", body.dealId).single();
      if (error || !existing) return json({ error: "deal not found" }, 404);
      const r = await intake(sb, { text: existing.raw_text || "", from: existing.submitted_by, fromName: existing.submitted_by_name, subject: existing.email_subject, existing: body.reextract ? { ...existing, extracted: null, latitude: null } : existing, force: true });
      return json(r);
    }
    if (body.emailId) {
      const { data: email, error } = await sb.from("emails").select("*").eq("id", body.emailId).single();
      if (error || !email) return json({ error: "email not found" }, 404);
      const text = email.body_text || email.body_preview || "";
      const r = await intake(sb, { text, from: email.from_address, fromName: email.from_name, subject: email.subject, emailId: email.id, force: !!body.force, source: "email" });
      return json(r);
    }
    if (body.text) {
      const r = await intake(sb, { text: body.text, from: body.from, fromName: body.from_name, subject: body.subject, force: body.force !== false, source: body.source || "manual" });
      return json(r);
    }
    return json({ error: "Provide emailId, dealId, or text" }, 400);
  } catch (err) {
    console.error("deal-intake error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
