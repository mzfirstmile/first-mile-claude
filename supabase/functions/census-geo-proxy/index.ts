// supabase/functions/census-geo-proxy/index.ts
//
// Server-side pass-through for Census cartographic-boundary GeoJSON files.
// The browser can't fetch raw.githubusercontent.com from admin.firstmilecap.com
// (CSP / CORS), and the sandbox proxy blocks github.com. Edge functions have
// full outbound network, so they're the natural place to relay these.
//
// GET /functions/v1/census-geo-proxy?layer=cbsa&resolution=20m
//
// Params:
//   layer       — cbsa | state | county   (default: cbsa)
//   resolution  — 20m | 5m | 500k         (default: 20m, smallest)
//
// Sources:
//   loganpowell/census-geojson on github — pre-converted Census 2023
//   cartographic boundary shapefiles to GeoJSON.
//
// Returns the GeoJSON unchanged with strong cache headers so the browser
// re-uses it across sessions.
//
// Deploy: supabase functions deploy census-geo-proxy --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const ALLOWED_LAYERS = new Set(["cbsa", "state", "county"]);
const ALLOWED_RES = new Set(["20m", "5m", "500k"]);

// Maps logical layer name → Census TIGERweb ArcGIS REST endpoint.
// Each endpoint serves GeoJSON when you append &f=geojson. Optional where=
// filters reduce payload (CBSA: LSAD='M1' → MSAs only, drops Micropolitan).
function buildSourceUrl(layer: string, _resolution: string): string {
  if (layer === "cbsa") {
    return "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/CBSA/MapServer/0/query" +
      "?where=" + encodeURIComponent("LSAD='M1'") +
      "&outFields=" + encodeURIComponent("NAME,GEOID,LSAD") +
      "&f=geojson&outSR=4326&returnGeometry=true&resultRecordCount=2000";
  }
  if (layer === "state") {
    return "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query" +
      "?where=1=1&outFields=NAME,STUSAB,GEOID&f=geojson&outSR=4326&returnGeometry=true&resultRecordCount=100";
  }
  if (layer === "county") {
    return "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query" +
      "?where=1=1&outFields=NAME,GEOID&f=geojson&outSR=4326&returnGeometry=true&resultRecordCount=5000";
  }
  return "";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const layer = (url.searchParams.get("layer") || "cbsa").toLowerCase();
  const resolution = (url.searchParams.get("resolution") || "20m").toLowerCase();

  if (!ALLOWED_LAYERS.has(layer)) {
    return new Response(
      JSON.stringify({ error: `unknown layer "${layer}". allowed: cbsa|state|county` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!ALLOWED_RES.has(resolution)) {
    return new Response(
      JSON.stringify({ error: `unknown resolution "${resolution}". allowed: 20m|5m|500k` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const src = buildSourceUrl(layer, resolution);
  try {
    const r = await fetch(src);
    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: `upstream ${r.status}: ${src}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const text = await r.text();
    return new Response(text, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/geo+json",
        // 30-day immutable cache — boundaries change rarely
        "Cache-Control": "public, max-age=2592000, immutable",
        "X-Source": src,
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e).slice(0, 300) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
