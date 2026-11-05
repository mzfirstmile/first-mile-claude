// supabase/functions/loan-memo/index.ts
// AI lending memo for a Loan Opportunities lead (Market Research → 🏦 Loan Opportunities).
// Researches the property, sponsor and tenants online (Claude server-side web search), combines that
// with the CRED iQ loan data in `market_loans` and our market scoring, and writes a lending memo to
// `loan_memos` (one row per property key, shared by every viewer — generated once, never paid twice).
//
// Deploy: supabase functions deploy loan-memo   (GitHub Action does this on push)
// Secrets: CLAUDE_API_KEY, ANTHROPIC_WORKSPACE_ID, SB_SERVICE_KEY (SUPABASE_URL is injected)
//
// POST body (one of):
//   { action: "queue", items: [{ key, market_id, property_name, priority, data_as_of }], requested_by }
//        — queue memos (the tab sends its top-50 lending targets on load). Skips keys that are already
//          queued/running or have a memo < 30 days old on the same data_as_of.
//   { action: "work", limit?: 1 }       — pg_cron worker: claim the highest-priority queued memo(s) and write them
//   { action: "generate", key, ... }    — on-demand (row button): queue at top priority and write it now
// Key format = the tab's aggregation key: `${source_location_id}|${lower(property_name) if no location}|${market_id}`.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-opus-5-5";
// $ per token / per search — Claude Opus 5.5 list price; web search $10 per 1,000 searches
const PRICE = { in: 4 / 1e6, out: 20 / 1e6, cacheRead: 0.2 / 1e6, search: 0.01 };
const STALE_DAYS = 30;

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SB_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const claude = new Anthropic({
  apiKey: Deno.env.get("CLAUDE_API_KEY")!,
  defaultHeaders: { "anthropic-workspace-id": Deno.env.get("ANTHROPIC_WORKSPACE_ID") || "wrkspc_01KFMjdE8FRViEkxanZET8rH" },
  timeout: 140_000,
  maxRetries: 1,
});

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// ── Inputs ──────────────────────────────────────────────────────────────
async function loadInputs(key: string) {
  const [loc, name, marketId] = key.split("|");
  let q = sb.from("market_loans").select("*").eq("market_id", marketId).gt("current_balance", 0);
  q = loc ? q.eq("source_location_id", loc) : q.ilike("property_name", name);
  const { data: loans, error } = await q.limit(50);
  if (error) throw new Error("market_loans: " + error.message);
  if (!loans?.length) throw new Error("no live loans for key " + key);
  const { data: mkt } = await sb.from("market_research_markets")
    .select("name,state,population,median_household_income,median_home_value,score,tier,office_score,office_tier,rank_residential,rank_office,thesis,summary")
    .eq("id", marketId).single();
  return { loans, mkt };
}

function loanFacts(loans: any[]) {
  // Trim each note to the fields that matter for a lending view (keeps the prompt small).
  const keep = ["loan_name", "property_name", "address", "property_type", "property_subtype", "building_size", "size_unit", "year_built", "year_renovated",
    "deal_name", "deal_type", "originator", "origination_date", "maturity_date", "original_balance", "current_balance", "mortgage_rate", "rate_type",
    "amortization", "io_periods", "prepay_desc", "lockout_end_date", "payment_status", "watchlist", "watchlist_reason", "special_serviced", "ss_reason",
    "workout_strategy", "modified", "appraisal_date", "appraised_value", "uw_noi", "uw_ncf", "latest_noi", "latest_dscr", "latest_occupancy",
    "financials_as_of", "ltv", "debt_yield", "master_servicer", "special_servicer", "borrower", "sponsor", "servicer_commentary"];
  return loans.map((l) => {
    const o: Record<string, unknown> = {};
    for (const k of keep) if (l[k] != null && l[k] !== "") o[k] = l[k];
    const d = l.detail || {};
    if (d.financials_raw) o.financial_history = d.financials_raw;
    if (d.num_props) o.number_of_collateral_properties = d.num_props;
    if (d.alloc_bal) o.this_property_allocated_balance = d.alloc_bal;
    if (d.defeasance) o.defeasance = d.defeasance;
    if (d.distribution_date) o.last_servicer_report = d.distribution_date;
    return o;
  });
}

const SYSTEM = `You are a senior commercial real estate credit analyst at First Mile Capital, a New York real estate investment firm that is building a lending business (senior first-mortgage, bridge, and mezzanine / preferred equity loans on assets in markets it has scored highly).

You will receive (1) CMBS / agency loan data from CRED iQ for one property, possibly split across several pari-passu notes, (2) First Mile's own market scoring for the town, and (3) today's date.

Before writing, research the property online with web search: the property name and address, the sponsor / borrower, major tenants, recent sales or refinancing, leasing news, lawsuits, foreclosure or default reporting, and local market news that bears on the credit. Do 3–6 searches. Prefer primary or trade sources (local business press, CoStar/Commercial Observer/The Real Deal/Bisnow/GlobeSt, Trepp, county records, company press releases). If searches return nothing specific about this property, say so plainly — never invent news.

Then write a lending memo for First Mile's investment committee deciding whether to reach out to the owner and offer financing. Be specific, quantitative and candid. Use the loan data's numbers (balance across all notes, coupon, maturity, NOI history, appraisal, LTV, DSCR, servicer status and commentary). Today's lender sizing assumption: 1.25x DSCR on in-place NOI and max ~65% LTV, at roughly 7.0% office / 6.0% multifamily / 6.75% retail / 6.5% industrial / 7.5% hotel.

Return ONLY an HTML fragment (no <html>/<body>, no markdown, no code fences), using exactly this structure:
<p class="lm-rec"><b>Recommendation: Pursue | Watch | Pass</b> — one-sentence headline</p>
<h4>Why now</h4><p>…the financing need and its timing…</p>
<h4>Property, sponsor &amp; news</h4><ul><li>…findings from your research, each with an inline <a href="URL" target="_blank">source</a> link…</li></ul>
<h4>Credit view</h4><p>…NOI trend, coverage, leverage, tenant/lease risk, market quality…</p>
<h4>What we would lend</h4><p>…product (senior refi / bridge / senior + mezz / rescue), indicative size, LTV, DSCR, rate range, term, key structure points…</p>
<h4>Risks &amp; diligence</h4><ul><li>…</li></ul>
<h4>Outreach</h4><p>…who to contact (sponsor / borrower, servicer if in special servicing) and why they would take the call…</p><p><i>Draft email:</i> 3–5 sentence first-touch email to the sponsor, professional and specific.</p>
Keep it under ~600 words.`;

async function writeMemo(key: string) {
  const { loans, mkt } = await loadInputs(key);
  const facts = loanFacts(loans);
  const p0 = facts[0] as any;
  const user = `Today: ${new Date().toISOString().slice(0, 10)}

FIRST MILE MARKET SCORING — ${mkt?.name}
${JSON.stringify({
    residential_score_0_100: mkt?.score, residential_tier: mkt?.tier, residential_rank_of_1971: mkt?.rank_residential,
    office_score_0_100: mkt?.office_score, office_tier: mkt?.office_tier, office_rank_of_1971: mkt?.rank_office,
    population: mkt?.population, median_household_income: mkt?.median_household_income, median_home_value: mkt?.median_home_value,
    market_thesis: mkt?.thesis, market_summary: mkt?.summary,
  })}
(Tier bands: T1 ≥ 85, T2 70–84.9, T3 40–69.9, T4 < 40.)

CRED iQ LOAN DATA — ${p0.property_name || p0.loan_name}${p0.address ? ", " + p0.address : ""} (${facts.length} note${facts.length > 1 ? "s" : ""})
${JSON.stringify(facts)}

Research this property online, then write the memo.`;

  const params: any = {
    model: MODEL,
    max_tokens: 12000,
    system: SYSTEM,
    output_config: { effort: "medium" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6, user_location: { type: "approximate", country: "US" } }],
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: user }],
  };

  let msg: any; const usage = { input: 0, output: 0, cacheRead: 0, searches: 0 };
  for (let turn = 0; turn < 4; turn++) {
    msg = await claude.beta.messages.create(params);
    usage.input += msg.usage?.input_tokens || 0;
    usage.output += msg.usage?.output_tokens || 0;
    usage.cacheRead += msg.usage?.cache_read_input_tokens || 0;
    usage.searches += msg.usage?.server_tool_use?.web_search_requests || 0;
    if (msg.stop_reason === "pause_turn") { params.messages.push({ role: "assistant", content: msg.content }); continue; }
    break;
  }
  if (msg.stop_reason === "refusal") throw new Error("model declined: " + (msg.stop_details?.category || "refusal"));
  if (msg.stop_reason === "max_tokens") throw new Error("memo truncated (max_tokens)");

  // Text = the memo (it may be split into several text blocks around citations)
  let html = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (!html) throw new Error("empty memo");

  // Sources = every search result the model saw + every cited URL
  const sources = new Map<string, string>();
  for (const b of msg.content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) sources.set(r.url, r.title || r.url);
    if (b.type === "text" && Array.isArray(b.citations)) for (const c of b.citations) if (c.url) sources.set(c.url, c.title || c.url);
  }
  const rec = (html.match(/Recommendation:\s*(Pursue|Watch|Pass)/i) || [])[1] || null;
  const headline = ((html.match(/<p class="lm-rec">([\s\S]*?)<\/p>/i) || [])[1] || "").replace(/<[^>]+>/g, "").replace(/^Recommendation:\s*\w+\s*[—-]\s*/i, "").trim();
  const cost = usage.input * PRICE.in + usage.output * PRICE.out + usage.cacheRead * PRICE.cacheRead + usage.searches * PRICE.search;
  return {
    memo_html: html, recommendation: rec ? rec[0].toUpperCase() + rec.slice(1).toLowerCase() : null, summary: headline || null,
    sources: [...sources].map(([url, title]) => ({ url, title })).slice(0, 25),
    model: msg.model || MODEL, usage, cost_usd: Math.round(cost * 10000) / 10000,
    data_as_of: loans.map((l: any) => l.data_as_of).filter(Boolean).sort().pop() || null,
  };
}

// ── Queue / worker ─────────────────────────────────────────────────────
async function queue(items: any[], requestedBy: string | null, force = false) {
  const keys = items.map((i) => i.key);
  const { data: existing } = await sb.from("loan_memos").select("key,status,generated_at,data_as_of").in("key", keys);
  const ex = new Map((existing || []).map((r: any) => [r.key, r]));
  const fresh = (r: any, i: any) => r.status === "done" && r.generated_at && (Date.now() - Date.parse(r.generated_at)) < STALE_DAYS * 864e5 && (!i.data_as_of || r.data_as_of === i.data_as_of);
  const rows = items.filter((i) => {
    const r: any = ex.get(i.key);
    if (!r) return true;
    if (r.status === "queued" || r.status === "running") return false;
    return force || !fresh(r, i);
  }).map((i) => ({ key: i.key, market_id: i.market_id || null, property_name: i.property_name || null, priority: i.priority ?? 100, status: "queued", requested_by: requestedBy, error: null, updated_at: new Date().toISOString() }));
  if (rows.length) { const { error } = await sb.from("loan_memos").upsert(rows, { onConflict: "key" }); if (error) throw new Error(error.message); }
  return rows.length;
}

async function runOne(key?: string) {
  // Release memos stuck in "running" (function killed mid-flight)
  await sb.from("loan_memos").update({ status: "queued" }).eq("status", "running").lt("updated_at", new Date(Date.now() - 10 * 60e3).toISOString());
  let target = key;
  if (!target) {
    const { data } = await sb.from("loan_memos").select("key").eq("status", "queued").order("priority", { ascending: true }).order("updated_at", { ascending: true }).limit(1);
    target = data?.[0]?.key;
    if (!target) return null;
  }
  // Atomic claim: only one worker flips queued → running
  const { data: claimed } = await sb.from("loan_memos").update({ status: "running", updated_at: new Date().toISOString() }).eq("key", target).eq("status", "queued").select("key");
  if (!claimed?.length) return { key: target, skipped: "already claimed" };
  try {
    const m = await writeMemo(target);
    await sb.from("loan_memos").update({ ...m, status: "done", error: null, generated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("key", target);
    return { key: target, status: "done", recommendation: m.recommendation, cost_usd: m.cost_usd, searches: m.usage.searches };
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 500);
    await sb.from("loan_memos").update({ status: "error", error: msg, updated_at: new Date().toISOString() }).eq("key", target);
    return { key: target, status: "error", error: msg };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "work";
    if (action === "queue") {
      const n = await queue(Array.isArray(body.items) ? body.items.slice(0, 200) : [], body.requested_by || null, !!body.force);
      return json({ queued: n });
    }
    if (action === "generate") {
      if (!body.key) return json({ error: "key required" }, 400);
      await queue([{ key: body.key, market_id: body.market_id, property_name: body.property_name, priority: 0 }], body.requested_by || null, true);
      const r = await runOne(body.key);
      const { data } = await sb.from("loan_memos").select("*").eq("key", body.key).single();
      return json({ result: r, memo: data });
    }
    // work
    const out = [];
    for (let i = 0; i < Math.min(Number(body.limit) || 1, 2); i++) { const r = await runOne(); if (!r) break; out.push(r); }
    return json({ processed: out });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
