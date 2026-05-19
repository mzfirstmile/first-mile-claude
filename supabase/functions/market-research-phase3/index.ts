// supabase/functions/market-research-phase3/index.ts
//
// Server-side Phase 3 deep-research runner for the Market Research module.
// Designed to be called in batches (e.g. 20 towns per invocation) so each call
// stays under the Supabase Edge Function timeout (~150s on Pro plans).
//
// POST body (all optional):
//   {
//     "tier_filter":         number[]   // restrict to these tiers (e.g. [1])
//     "market_ids":          string[]   // explicit list overrides tier_filter
//     "limit":               number     // max markets to process this call (default 20)
//     "concurrency":         number     // parallel Claude calls (default 8)
//     "skip_already_done":   boolean    // default true — skip markets with phase3_ran_at set
//     "max_cost_usd":        number     // hard stop if running cost crosses this (default 25)
//   }
//
// Returns:
//   { ok, processed, score_rows_written, errors, cost_usd, remaining_in_filter, duration_ms }
//
// Required Supabase secrets:
//   CLAUDE_API_KEY                — Anthropic key with Sonnet 4-6 access
//   SUPABASE_URL                  — auto-populated
//   SUPABASE_SERVICE_ROLE_KEY     — auto-populated
//
// Deploy: supabase functions deploy market-research-phase3

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEARCH_SOURCES = [
  "- CBRE Insights: https://www.cbre.com/insights",
  "- JLL Market Outlook (US): https://www.jll.com/en-us/insights/market-outlook",
  "- JLL Cities Insights: https://www.jll.com/en-us/insights/cities",
  "- Newmark Insights: https://www.nmrk.com/insights",
  "- Walker Dunlop Suite: https://suite.walkerdunlop.com/",
  "- Savills Impacts: https://impacts.savills.com/",
  "- Challenger Gray: https://www.challengergray.com/blog/",
  "- St Louis Fed: https://www.stlouisfed.org/on-the-economy",
  "- Niche.com: https://www.niche.com/places-to-live/",
  "- GreatSchools.org: https://www.greatschools.org/",
  "- FBI Crime Data Explorer: https://crime-data-explorer.fr.cloud.gov/",
  "- US Census ACS: https://data.census.gov/",
].join("\n");

const PHASE3_CATEGORIES = ["governance", "economic_activity", "quality_of_life", "transit"];

interface Market {
  id: string;
  name: string;
  state: string;
  population: number | null;
  median_household_income: number | null;
  median_home_value: number | null;
  nearest_top50_city: string | null;
}

interface Criterion {
  id: string;
  name: string;
  category: string;
  description: string | null;
  target_min: number | null;
  target_max: number | null;
  target_unit: string | null;
  target_label: string | null;
}

function fmtTarget(c: Criterion): string {
  if (c.target_label) return c.target_label;
  if (c.target_min != null && c.target_max != null) return `${c.target_min}-${c.target_max} ${c.target_unit || ""}`;
  if (c.target_min != null) return `≥ ${c.target_min} ${c.target_unit || ""}`;
  if (c.target_max != null) return `≤ ${c.target_max} ${c.target_unit || ""}`;
  return "qualitative";
}

function buildSystemPrompt(criteria: Criterion[]): string {
  const critList = criteria.map((c) => {
    return `- "${c.name}" (${c.category}) — target: ${fmtTarget(c)}. ${c.description || ""}`;
  }).join("\n");
  return `You are a real estate market research analyst for First Mile Capital. Your job is to score a specific US town against 4 categories of evaluation criteria that require web/qualitative research (the kind Census data alone can't answer): Governance & Barriers to Entry, Economic Activity, Quality of Life, and Transit & Access.

For each sub-criterion below, return:
- A 1-10 score (1 = far below target, 10 = meets or exceeds target).
- A brief value (≤ 60 chars) summarizing the data point (e.g. "Top 5% nationally", "AA+ rating", "Walking distance to Metro-North").
- A sources array — 1 to 3 authoritative citations. Prefer URLs from the Research Websites list. Multiple sources are encouraged when more than one body of data supports the score (e.g. FBI UCR + Niche.com for crime).

If you genuinely don't have a reliable answer, set score=null and value="insufficient data". Don't invent numbers.

Sub-criteria to score:
${critList}

Authoritative research sources to cite (use these where possible):
${RESEARCH_SOURCES}

Return STRICT JSON in this exact shape, with no commentary outside the JSON:
{
  "scores": [
    {"criterion_name": "<exact name from list>", "score": <0-10 or null>, "value": "<short value>", "sources": ["<URL or label>", "<optional 2nd>", "<optional 3rd>"]}
  ],
  "thesis": "<2-3 paragraph investment thesis>",
  "summary": "<one sentence executive summary, max 200 chars>"
}`;
}

function buildUserPrompt(m: Market): string {
  return `Town: ${m.name}
Population: ${m.population?.toLocaleString() ?? "?"}
Median Household Income: ${m.median_household_income != null ? "$" + m.median_household_income.toLocaleString() : "?"}
Median Home Value: ${m.median_home_value != null ? "$" + m.median_home_value.toLocaleString() : "?"}
Nearest Top-50 Metro: ${m.nearest_top50_city ?? "?"}

Research this town now and produce the scoring JSON.`;
}

function extractJson(text: string): unknown {
  let s = text.trim();
  const md = s.match(/```json\s*([\s\S]*?)\s*```/i);
  if (md) s = md[1];
  else {
    const bare = s.match(/\{[\s\S]*\}/);
    if (bare) s = bare[0];
  }
  return JSON.parse(s);
}

async function callClaudeForTown(apiKey: string, system: string, m: Market) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: buildUserPrompt(m) }],
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`API ${r.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const usage = data.usage || {};
  const inputTok = usage.input_tokens || 0;
  const outputTok = usage.output_tokens || 0;
  // Sonnet 4-6 pricing
  const costUsd = (inputTok / 1_000_000) * 3 + (outputTok / 1_000_000) * 15;
  const txt = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  const parsed: any = extractJson(txt);
  return { parsed, costUsd, inputTok, outputTok };
}

async function recomputeMarketComposite(sb: any, marketId: string) {
  // Pull all scores for this market joined with criterion -> category
  const { data: rows, error } = await sb
    .from("market_research_scores")
    .select("value_numeric, criterion:market_research_criteria(category_id)")
    .eq("market_id", marketId)
    .not("value_numeric", "is", null);
  if (error || !rows) return null;
  // Get category weights
  const { data: cats } = await sb.from("market_research_categories").select("id,weight");
  const weightMap = new Map<string, number>((cats || []).map((c: any) => [c.id, parseFloat(c.weight || 1)]));
  // Group scores by category
  const byCat = new Map<string, number[]>();
  for (const r of rows as any[]) {
    const catId = r.criterion?.category_id;
    if (!catId) continue;
    if (!byCat.has(catId)) byCat.set(catId, []);
    byCat.get(catId)!.push(parseFloat(r.value_numeric));
  }
  // Weighted mean across categories
  let weightedSum = 0, totalWeight = 0;
  for (const [catId, subs] of byCat) {
    if (subs.length === 0) continue;
    const mean = subs.reduce((a, b) => a + b, 0) / subs.length;
    const w = weightMap.get(catId) ?? 1;
    weightedSum += mean * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return null;
  const composite = weightedSum / totalWeight;
  const score = Math.round(composite * 10) / 10;
  // Tier bands (unified across recompute paths) — T1 is tight at ≥8.5 so it
  // stays selective even after Phase 2 Commute lifted metro-adjacent towns.
  const tier = score >= 8.5 ? 1 : score >= 6.5 ? 2 : score >= 4.5 ? 3 : 4;
  await sb.from("market_research_markets").update({ score, tier }).eq("id", marketId);
  return { score, tier, categories_with_data: byCat.size };
}

async function processOne(sb: any, apiKey: string, system: string, m: Market, critByName: Map<string, Criterion>) {
  const { parsed, costUsd } = await callClaudeForTown(apiKey, system, m);
  const scoreRows: any[] = [];
  let scored = 0;
  for (const s of (parsed.scores || [])) {
    const crit = critByName.get((s.criterion_name || "").toLowerCase().trim());
    if (!crit) continue;
    if (s.score == null || s.score === "") continue;
    const sc = Math.max(0, Math.min(10, parseFloat(s.score)));
    if (!Number.isFinite(sc)) continue;
    // Accept either sources[] (new) or source (legacy single string)
    const srcs: string[] = Array.isArray((s as any).sources)
      ? (s as any).sources.filter((x: any) => !!x)
      : ((s as any).source ? [(s as any).source] : []);
    scoreRows.push({
      market_id: m.id,
      criterion_id: crit.id,
      value_numeric: Math.round(sc * 10) / 10,
      value_text: s.value || null,
      source: srcs[0] || null,  // back-compat
      sources: srcs,
      updated_by: "phase3_claude",
    });
    scored++;
  }
  // Wipe old phase3 rows for this market
  await sb.from("market_research_scores").delete().eq("market_id", m.id).eq("updated_by", "phase3_claude");
  if (scoreRows.length > 0) {
    const { error } = await sb.from("market_research_scores").insert(scoreRows);
    if (error) throw new Error(`scores insert: ${error.message}`);
  }
  // Update market thesis/summary + ran timestamp
  await sb.from("market_research_markets").update({
    thesis: parsed.thesis || null,
    summary: parsed.summary || null,
    phase3_ran_at: new Date().toISOString(),
  }).eq("id", m.id);
  // Recompute composite Score/Tier using ALL scores (Phase 2 + Phase 3)
  await recomputeMarketComposite(sb, m.id);
  return { scored, costUsd };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const apiKey = Deno.env.get("CLAUDE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "CLAUDE_API_KEY secret not set on this function" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const limit = Math.max(1, Math.min(500, body.limit ?? 20));
    const concurrency = Math.max(1, Math.min(15, body.concurrency ?? 8));
    const skipDone = body.skip_already_done !== false;
    const maxCostUsd = body.max_cost_usd ?? 25;
    const recomputeOnly = body.recompute_only === true;

    // Recompute-only mode: refresh Score/Tier from existing stored scores, no Claude calls.
    if (recomputeOnly) {
      let q = sb.from("market_research_markets").select("id").eq("phase", "shortlisted");
      if (body.market_ids && Array.isArray(body.market_ids) && body.market_ids.length > 0) {
        q = q.in("id", body.market_ids);
      } else if (body.tier_filter && Array.isArray(body.tier_filter) && body.tier_filter.length > 0) {
        q = q.in("tier", body.tier_filter);
      }
      q = q.limit(limit);
      const { data: ids, error: idErr } = await q;
      if (idErr) throw idErr;
      let count = 0;
      for (const row of (ids || []) as any[]) {
        try { await recomputeMarketComposite(sb, row.id); count++; } catch {}
      }
      return new Response(JSON.stringify({
        ok: true, mode: "recompute_only", recomputed: count, duration_ms: Date.now() - t0,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1. Load criteria
    const { data: criteria, error: critErr } = await sb
      .from("market_research_criteria")
      .select("*")
      .in("category", PHASE3_CATEGORIES)
      .eq("is_active", true);
    if (critErr) throw critErr;
    const critByName = new Map<string, Criterion>(
      (criteria || []).map((c: any) => [c.name.toLowerCase().trim(), c]),
    );

    // 2. Load target markets
    let q = sb.from("market_research_markets").select("*").eq("phase", "shortlisted");
    if (body.market_ids && Array.isArray(body.market_ids) && body.market_ids.length > 0) {
      q = q.in("id", body.market_ids);
    } else if (body.tier_filter && Array.isArray(body.tier_filter) && body.tier_filter.length > 0) {
      q = q.in("tier", body.tier_filter);
    }
    if (skipDone) q = q.is("phase3_ran_at", null);
    q = q.order("score", { ascending: false, nullsFirst: false }).limit(limit);
    const { data: markets, error: mErr } = await q;
    if (mErr) throw mErr;

    // Count total remaining for the same filter (capacity planning)
    let countQ = sb.from("market_research_markets").select("id", { count: "exact", head: true }).eq("phase", "shortlisted");
    if (body.tier_filter && Array.isArray(body.tier_filter) && body.tier_filter.length > 0) {
      countQ = countQ.in("tier", body.tier_filter);
    }
    if (skipDone) countQ = countQ.is("phase3_ran_at", null);
    const { count: remainingInFilter } = await countQ;

    // 3. Process with controlled parallelism
    const system = buildSystemPrompt(criteria as Criterion[]);
    let totalCostUsd = 0;
    let totalScoreRows = 0;
    let processed = 0;
    const errors: any[] = [];
    const queue = [...(markets || [])];
    async function worker() {
      while (queue.length > 0) {
        const m = queue.shift();
        if (!m) break;
        if (totalCostUsd >= maxCostUsd) {
          errors.push({ market_id: m.id, name: m.name, error: "stopped: max_cost_usd reached" });
          continue;
        }
        try {
          const { scored, costUsd } = await processOne(sb, apiKey, system, m as Market, critByName);
          totalScoreRows += scored;
          totalCostUsd += costUsd;
          processed++;
        } catch (e) {
          errors.push({ market_id: m.id, name: (m as any).name, error: String(e).slice(0, 300) });
        }
      }
    }
    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    return new Response(JSON.stringify({
      ok: true,
      processed,
      score_rows_written: totalScoreRows,
      errors,
      cost_usd: Math.round(totalCostUsd * 10000) / 10000,
      remaining_in_filter: (remainingInFilter ?? 0) - processed,
      duration_ms: Date.now() - t0,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e), duration_ms: Date.now() - t0 }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
