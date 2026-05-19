// supabase/functions/market-research-highway/index.ts
//
// Scores 'Proximity to Major Highway' for markets using OpenStreetMap
// Overpass API. For each market lat/lng, finds the nearest way tagged
// highway IN ('motorway', 'trunk', 'motorway_link') within ~12 miles,
// computes straight-line distance to the nearest node, converts to an
// estimated drive time, and scores 0-10 against target_max=5 min.
//
// Drive time estimate: distance × 2.0 min/mile (mixed local + ramp).
// (5min ≈ 2.5mi straight-line, 15min ≈ 7.5mi.)
//
// Score formula (target_max=5):
//   ≤5 min → 10
//   5-15 min → linear decay 10 → 0
//   ≥15 min → 0
//
// POST body: { batch_size: 50, market_ids?: [], tier_filter?: [1] }
// Returns: { ok, processed, score_rows_written, errors, duration_ms }
//
// Free — no API key. Overpass has soft rate limits (~10k/day per IP);
// edge function uses ~1 req per market.
//
// Deploy: supabase functions deploy market-research-highway --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TARGET_MAX_MIN = 5;
const MAX_MIN = 15;
const MIN_PER_MILE = 2.0;
const SEARCH_RADIUS_M = 20000; // 20km ~ 12.4mi

function roundTo(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function hav(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = p2 - p1, dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp/2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function scoreFromMinutes(min: number): number {
  if (min <= TARGET_MAX_MIN) return 10;
  if (min >= MAX_MIN) return 0;
  return roundTo(10 - ((min - TARGET_MAX_MIN) / (MAX_MIN - TARGET_MAX_MIN)) * 10, 1);
}

async function nearestHighwayDist(lat: number, lng: number): Promise<{ miles: number; type: string; debug?: string } | null> {
  // Overpass QL: split into explicit way[highway=motorway] + way[highway=trunk]
  // queries (regex form was returning empty). out geom returns each way's
  // node-by-node coordinates.
  const q = `[out:json][timeout:25];(way["highway"="motorway"](around:${SEARCH_RADIUS_M},${lat},${lng});way["highway"="trunk"](around:${SEARCH_RADIUS_M},${lat},${lng});way["highway"="motorway_link"](around:${SEARCH_RADIUS_M},${lat},${lng}););out geom 100;`;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "first-mile-market-research/1.0" },
        body: "data=" + encodeURIComponent(q),
      });
      if (!r.ok) continue;
      const json = await r.json();
      if (!json.elements || json.elements.length === 0) {
        // Try next endpoint
        continue;
      }
      let bestMi = Infinity;
      let bestType = "";
      for (const el of json.elements) {
        if (!el.geometry) continue;
        const tag = (el.tags && el.tags.highway) || "";
        for (const pt of el.geometry) {
          const d = hav(lat, lng, pt.lat, pt.lon);
          if (d < bestMi) { bestMi = d; bestType = tag; }
        }
      }
      if (isFinite(bestMi)) return { miles: bestMi, type: bestType };
    } catch (e) {
      console.error("Overpass error:", String(e).slice(0, 200));
    }
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();
  const body = await req.json().catch(() => ({} as any));
  const batchSize = Math.min(body.batch_size ?? 30, 100);
  const explicitIds: string[] | undefined = body.market_ids;
  const tierFilter: number[] = Array.isArray(body.tier_filter) ? body.tier_filter : [1];
  const concurrency = Math.min(body.concurrency ?? 4, 8);

  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // Fetch criterion ID
  const { data: crits } = await supa.from("market_research_criteria")
    .select("id,target_max,target_max_office")
    .eq("name", "Proximity to Major Highway").limit(1);
  const crit = crits && crits[0];
  if (!crit) {
    return new Response(JSON.stringify({ error: "Criterion 'Proximity to Major Highway' not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Find markets needing scoring
  let q = supa.from("market_research_markets")
    .select("id,name,latitude,longitude")
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .limit(batchSize);
  if (explicitIds && explicitIds.length > 0) {
    q = q.in("id", explicitIds);
  } else {
    q = q.in("tier", tierFilter);
  }
  const { data: markets, error: mErr } = await q;
  if (mErr) return new Response(JSON.stringify({ error: mErr.message }),
    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (!markets || markets.length === 0)
    return new Response(JSON.stringify({ ok: true, done: true, processed: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Score with concurrency control
  const scoresToInsert: any[] = [];
  const errors: any[] = [];
  const queue = [...markets];
  async function worker() {
    while (queue.length > 0) {
      const m = queue.shift() as any;
      if (!m) break;
      try {
        const res = await nearestHighwayDist(m.latitude, m.longitude);
        if (!res) {
          errors.push({ id: m.id, name: m.name, error: "no highway within radius" });
          // Still write a 0 score so we know we tried
          scoresToInsert.push({
            market_id: m.id, criterion_id: crit.id,
            value_numeric: 0, value_numeric_office: 0,
            raw_value: 99,
            value_text: ">20mi to motorway/trunk",
            source: "OpenStreetMap Overpass (highway=motorway/trunk within 12mi)",
            updated_by: "phase2_auto",
          });
          continue;
        }
        const driveMin = res.miles * MIN_PER_MILE;
        const sc = scoreFromMinutes(driveMin);
        scoresToInsert.push({
          market_id: m.id, criterion_id: crit.id,
          value_numeric: sc, value_numeric_office: sc,
          raw_value: roundTo(driveMin, 1),
          value_text: `${roundTo(res.miles, 1)}mi → ~${Math.round(driveMin)}min · nearest: ${res.type}`,
          source: "OpenStreetMap Overpass (highway=motorway/trunk)",
          updated_by: "phase2_auto",
        });
      } catch (e) {
        errors.push({ id: m.id, name: m.name, error: String(e).slice(0, 200) });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Wipe existing scores for these markets on this criterion, then insert
  const marketIds = markets.map((m: any) => m.id);
  await supa.from("market_research_scores").delete()
    .in("market_id", marketIds).eq("criterion_id", crit.id);
  let inserted = 0;
  for (let i = 0; i < scoresToInsert.length; i += 500) {
    const chunk = scoresToInsert.slice(i, i + 500);
    const { error } = await supa.from("market_research_scores").insert(chunk);
    if (!error) inserted += chunk.length;
    else console.error("insert:", error.message);
  }

  return new Response(JSON.stringify({
    ok: true, processed: markets.length, score_rows_written: inserted,
    errors: errors.slice(0, 10), error_count: errors.length,
    duration_ms: Date.now() - t0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
