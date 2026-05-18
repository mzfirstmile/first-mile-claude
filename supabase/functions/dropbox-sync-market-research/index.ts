// supabase/functions/dropbox-sync-market-research/index.ts
//
// Pulls files from the configured Dropbox folder
// (1.4 Special Projects/Market Research-Claude) and registers each one in
// the market_research_sources table. New / changed files are flagged as
// status='pending' so a downstream step (manual review, or a follow-up
// Claude-API parsing function) can turn them into updates to criteria,
// markets, and scores.
//
// Triggered by:
//   1. The "Update Rankings" button on the dashboard (POST, anon key)
//   2. A pg_cron job (optional, hourly polling)
//
// Required env vars on the Supabase function:
//   DROPBOX_ACCESS_TOKEN  — long-lived Dropbox app access token (scoped to
//                          files.metadata.read + files.content.read at minimum)
//   DROPBOX_FOLDER_PATH   — defaults to "/1.4 Special Projects/Market Research-Claude"
//                          (Dropbox API expects path starting with /)
//   SUPABASE_URL          — auto-populated
//   SUPABASE_SERVICE_ROLE_KEY — auto-populated, needed for table writes
//
// Deploy: supabase functions deploy dropbox-sync-market-research --no-verify-jwt
//   (no-verify-jwt because the frontend may call it with anon key, and pg_cron
//    can call it without auth header. Function does its own gate via env vars.)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_FOLDER = "/1.4 Special Projects/Market Research - Claude";
const TEAM_ROOT_NAMESPACE_ID = "2581504355"; // First Mile Prop team root

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface DropboxFileEntry {
  ".tag": string;
  id: string;
  name: string;
  path_display: string;
  path_lower: string;
  size?: number;
  client_modified?: string;
  server_modified?: string;
  content_hash?: string;
}

// Mint a short-lived access token using the refresh-token + app creds set on the
// dropbox-proxy function. Falls back to DROPBOX_ACCESS_TOKEN if those aren't set.
async function getDropboxAccessToken(): Promise<string> {
  const refresh = Deno.env.get("DROPBOX_REFRESH_TOKEN");
  const appKey = Deno.env.get("DROPBOX_APP_KEY");
  const appSecret = Deno.env.get("DROPBOX_APP_SECRET");
  if (refresh && appKey && appSecret) {
    const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: appKey,
        client_secret: appSecret,
      }).toString(),
    });
    if (!r.ok) throw new Error(`Dropbox refresh failed ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return j.access_token as string;
  }
  const flat = Deno.env.get("DROPBOX_ACCESS_TOKEN");
  if (!flat) throw new Error("No Dropbox credentials configured (need DROPBOX_REFRESH_TOKEN+APP_KEY+APP_SECRET or DROPBOX_ACCESS_TOKEN).");
  return flat;
}

function pathRootHeader(): Record<string, string> {
  const ns = (Deno.env.get("DROPBOX_TEAM_ROOT_NAMESPACE_ID") ?? TEAM_ROOT_NAMESPACE_ID).trim();
  if (!ns || ns === "0") return {};
  return { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "root", "root": ns }) };
}

async function listDropboxFolder(token: string, folderPath: string): Promise<DropboxFileEntry[]> {
  const entries: DropboxFileEntry[] = [];
  let cursor: string | null = null;

  do {
    const url = cursor
      ? "https://api.dropboxapi.com/2/files/list_folder/continue"
      : "https://api.dropboxapi.com/2/files/list_folder";
    const body = cursor ? { cursor } : { path: folderPath, recursive: true, include_non_downloadable_files: false };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...pathRootHeader(),
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      throw new Error(`Dropbox list_folder ${r.status}: ${await r.text()}`);
    }
    const data = await r.json();
    for (const e of data.entries || []) {
      if (e[".tag"] === "file") entries.push(e);
    }
    cursor = data.has_more ? data.cursor : null;
  } while (cursor);

  return entries;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let token: string;
    try {
      token = await getDropboxAccessToken();
    } catch (e) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Dropbox not configured",
          detail: String(e),
          synced: 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const folder = Deno.env.get("DROPBOX_FOLDER_PATH") || DEFAULT_FOLDER;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // 1. List the Dropbox folder
    const files = await listDropboxFolder(token, folder);

    // 2. Look up what we already have
    const { data: existing, error: selErr } = await sb
      .from("market_research_sources")
      .select("dropbox_path, content_hash");
    if (selErr) throw selErr;
    const existingByPath = new Map((existing || []).map((r: any) => [r.dropbox_path, r.content_hash]));

    // 3. Upsert any new / changed file
    let synced = 0;
    let unchanged = 0;
    const upserts: any[] = [];
    for (const f of files) {
      const prevHash = existingByPath.get(f.path_display);
      if (prevHash === f.content_hash) { unchanged++; continue; }
      upserts.push({
        dropbox_path: f.path_display,
        file_name: f.name,
        size_bytes: f.size || null,
        content_hash: f.content_hash || null,
        dropbox_modified: f.server_modified || f.client_modified || null,
        pulled_at: new Date().toISOString(),
        status: "pending",
      });
      synced++;
    }
    if (upserts.length > 0) {
      const { error: upsertErr } = await sb
        .from("market_research_sources")
        .upsert(upserts, { onConflict: "dropbox_path" });
      if (upsertErr) throw upsertErr;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        folder,
        total_files: files.length,
        synced,
        unchanged,
        note: synced > 0
          ? `${synced} new or changed file(s) registered in market_research_sources (status=pending). Parsing → criteria/score updates is a follow-up step.`
          : "No changes detected.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("dropbox-sync-market-research error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e), synced: 0 }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
