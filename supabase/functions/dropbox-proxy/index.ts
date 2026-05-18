// supabase/functions/dropbox-proxy/index.ts
//
// Generic Dropbox API proxy with a path allowlist. Lets the sandbox / dashboard /
// Claude call Dropbox without exposing the access token client-side, and gates
// every request to a configurable set of folder prefixes so the proxy only
// touches folders Morris has explicitly approved.
//
// Request format (POST JSON):
//   {
//     "action": "list_folder" | "list_folder_continue" | "get_metadata"
//             | "search" | "get_temporary_link" | "download" | "download_text"
//             | "list_revisions" | "get_current_account" | "raw",
//     "args":   { ...Dropbox API args, passed straight through },
//     "endpoint": "/2/files/whatever"   // raw action only
//     "host":     "api" | "content"     // raw action only, default "api"
//   }
//
// Auth: Bearer = Supabase anon key (verify_jwt on).
//
// Token resolution (in priority order):
//   1. DROPBOX_REFRESH_TOKEN + DROPBOX_APP_KEY + DROPBOX_APP_SECRET → exchange on each call
//      (recommended — refresh tokens don't expire)
//   2. DROPBOX_ACCESS_TOKEN → use directly (short-lived, ~4hr)
//
// Path allowlist:
//   DROPBOX_ALLOWED_PATHS — pipe-separated list of allowed prefixes. Default:
//                          "/1.4 Special Projects".
//   Rules:
//   - Read-style ops (download, get_metadata, list_revisions, get_temporary_link)
//     require the target path to be == or inside an allowed prefix.
//   - list_folder: if path is allowed → pass through; if path is an ANCESTOR of
//     some allowed prefix (incl. root "") → pass through but filter entries to
//     only show allowed prefixes / their ancestors; otherwise 403.
//   - Recursive listing is denied on non-allowed paths.
//   - search: requires options.path to be an allowed prefix.
//   - list_folder_continue / search_continue: cursors are opaque; trust them
//     since they were issued by a previously authorized request.
//   - raw: requires args.path; same rule as read-style ops.
//   - get_current_account: always allowed.
//
// Deploy: supabase functions deploy dropbox-proxy

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_HOST = "https://api.dropboxapi.com";
const CONTENT_HOST = "https://content.dropboxapi.com";

const DEFAULT_ALLOWLIST = ["/1.4 Special Projects"];

// Team root for "First Mile Prop". All paths in the allowlist are resolved
// relative to this namespace — without it, Dropbox looks at the user's
// personal home (which doesn't contain the firm's shared folders).
// Override via DROPBOX_TEAM_ROOT_NAMESPACE_ID secret if needed; set to "0" to disable.
const DEFAULT_TEAM_ROOT_NAMESPACE_ID = "2581504355";

function pathRootHeader(): Record<string, string> {
  const ns = (Deno.env.get("DROPBOX_TEAM_ROOT_NAMESPACE_ID") ?? DEFAULT_TEAM_ROOT_NAMESPACE_ID).trim();
  if (!ns || ns === "0") return {};
  return { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "root", "root": ns }) };
}

const ACTION_ENDPOINTS: Record<string, string> = {
  list_folder: "/2/files/list_folder",
  list_folder_continue: "/2/files/list_folder/continue",
  get_metadata: "/2/files/get_metadata",
  search: "/2/files/search_v2",
  search_continue: "/2/files/search/continue_v2",
  get_temporary_link: "/2/files/get_temporary_link",
  list_revisions: "/2/files/list_revisions",
  get_current_account: "/2/users/get_current_account",
};

// ---------- token resolution ----------

let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;
let cachedRefreshTokenFingerprint: string | null = null;

async function resolveAccessToken(): Promise<string> {
  const refresh = Deno.env.get("DROPBOX_REFRESH_TOKEN");
  const appKey = Deno.env.get("DROPBOX_APP_KEY");
  const appSecret = Deno.env.get("DROPBOX_APP_SECRET");
  if (refresh && appKey && appSecret) {
    const now = Math.floor(Date.now() / 1000);
    // Fingerprint = first 16 chars; rotating the refresh token in secrets
    // invalidates the cache automatically.
    const fp = refresh.slice(0, 16);
    if (
      cachedAccessToken &&
      cachedAccessTokenExpiresAt > now + 60 &&
      cachedRefreshTokenFingerprint === fp
    ) {
      return cachedAccessToken;
    }
    cachedRefreshTokenFingerprint = fp;
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
    if (!r.ok) {
      throw new Error(`Dropbox refresh failed ${r.status}: ${await r.text()}`);
    }
    const j = await r.json();
    cachedAccessToken = j.access_token;
    cachedAccessTokenExpiresAt = now + (j.expires_in || 14400);
    return cachedAccessToken!;
  }
  const flat = Deno.env.get("DROPBOX_ACCESS_TOKEN");
  if (flat) return flat;
  throw new Error(
    "No Dropbox credentials configured. Set DROPBOX_REFRESH_TOKEN+DROPBOX_APP_KEY+DROPBOX_APP_SECRET, or DROPBOX_ACCESS_TOKEN.",
  );
}

// ---------- allowlist helpers ----------

function getAllowlist(): string[] {
  const raw = Deno.env.get("DROPBOX_ALLOWED_PATHS");
  if (!raw) return [...DEFAULT_ALLOWLIST];
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.startsWith("/") ? s : "/" + s));
}

function lower(p: string): string {
  return (p || "").toLowerCase();
}

// Is `path` allowed for reads (== or inside an allowed prefix)?
function pathAllowedForRead(path: string, allowlist: string[]): boolean {
  const p = lower(path);
  if (!p) return false; // never allow reading root directly
  return allowlist.some((a) => {
    const an = lower(a);
    return p === an || p.startsWith(an + "/");
  });
}

// Can we LIST `path`? Allowed if path itself is allowed, OR path is an ancestor of
// some allowed prefix (so we can drill down). Root "" is always considered an ancestor.
function pathAllowedForList(path: string, allowlist: string[]): boolean {
  const p = lower(path);
  if (p === "") return allowlist.length > 0;
  if (pathAllowedForRead(path, allowlist)) return true;
  return allowlist.some((a) => lower(a).startsWith(p + "/"));
}

// Filter a list_folder response so non-allowed entries are dropped. Used when
// the listed path is an ancestor of allowed prefixes (not itself allowed).
function filterEntries(entries: any[], allowlist: string[]): any[] {
  return entries.filter((e: any) => {
    const ep = lower(e.path_lower || e.path_display || "");
    if (!ep) return false;
    return allowlist.some((a) => {
      const an = lower(a);
      return ep === an || ep.startsWith(an + "/") || an.startsWith(ep + "/");
    });
  });
}

function deny(reason: string, allowlist: string[]) {
  return {
    status: 403,
    ok: false,
    data: {
      error: "Path not allowed by proxy allowlist",
      detail: reason,
      allowlist,
    },
  };
}

// ---------- Dropbox calls ----------

async function dropboxJson(token: string, endpoint: string, args: unknown) {
  const isNoArg = args === undefined || args === null;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...pathRootHeader(),
  };
  if (!isNoArg) headers["Content-Type"] = "application/json";
  const r = await fetch(`${API_HOST}${endpoint}`, {
    method: "POST",
    headers,
    body: isNoArg ? undefined : JSON.stringify(args),
  });
  const text = await r.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: r.status, ok: r.ok, data: parsed };
}

async function dropboxDownload(token: string, args: unknown) {
  const r = await fetch(`${CONTENT_HOST}/2/files/download`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify(args ?? {}),
      ...pathRootHeader(),
    },
  });
  if (!r.ok) {
    const text = await r.text();
    return { status: r.status, ok: false, data: { error: text } };
  }
  const metaHeader = r.headers.get("Dropbox-API-Result");
  let metadata: unknown = null;
  try { metadata = metaHeader ? JSON.parse(metaHeader) : null; } catch { metadata = { raw: metaHeader }; }
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  const b64 = btoa(bin);
  return {
    status: r.status,
    ok: true,
    data: { metadata, content_base64: b64, bytes: buf.length },
  };
}

async function dropboxDownloadText(token: string, args: unknown) {
  const r = await fetch(`${CONTENT_HOST}/2/files/download`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify(args ?? {}),
      ...pathRootHeader(),
    },
  });
  if (!r.ok) {
    const text = await r.text();
    return { status: r.status, ok: false, data: { error: text } };
  }
  const metaHeader = r.headers.get("Dropbox-API-Result");
  let metadata: unknown = null;
  try { metadata = metaHeader ? JSON.parse(metaHeader) : null; } catch { metadata = { raw: metaHeader }; }
  const text = await r.text();
  return { status: r.status, ok: true, data: { metadata, content: text } };
}

// ---------- request handler ----------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "POST only" });
  }

  let body: any = {};
  try {
    const txt = await req.text();
    body = txt ? JSON.parse(txt) : {};
  } catch (e) {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body", detail: String(e) });
  }

  const action = String(body.action || "").trim();
  const args = body.args;
  const allowlist = getAllowlist();

  // Gate before we even talk to Dropbox.
  const gate = checkAllowlist(action, args, body, allowlist);
  if (gate) return jsonResponse(gate.status, { ok: false, action, ...gate.body });

  let token: string;
  try {
    token = await resolveAccessToken();
  } catch (e) {
    return jsonResponse(500, { ok: false, action, error: String(e) });
  }

  try {
    let result: { status: number; ok: boolean; data: any };
    if (action === "download") {
      result = await dropboxDownload(token, args);
    } else if (action === "download_text") {
      result = await dropboxDownloadText(token, args);
    } else if (action === "raw") {
      const endpoint = String(body.endpoint || "");
      if (!endpoint.startsWith("/")) {
        return jsonResponse(400, {
          ok: false, action,
          error: "raw action requires endpoint starting with /",
        });
      }
      const host = body.host === "content" ? CONTENT_HOST : API_HOST;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        ...pathRootHeader(),
      };
      let fetchBody: BodyInit | undefined;
      if (host === CONTENT_HOST) {
        headers["Dropbox-API-Arg"] = JSON.stringify(args ?? {});
      } else {
        headers["Content-Type"] = "application/json";
        fetchBody = JSON.stringify(args ?? {});
      }
      const r = await fetch(`${host}${endpoint}`, { method: "POST", headers, body: fetchBody });
      const text = await r.text();
      let parsed: unknown = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
      result = { status: r.status, ok: r.ok, data: parsed };
    } else {
      const endpoint = ACTION_ENDPOINTS[action];
      if (!endpoint) {
        return jsonResponse(400, {
          ok: false, action,
          error: `Unknown action "${action}"`,
          actions: [...Object.keys(ACTION_ENDPOINTS), "download", "download_text", "raw"],
        });
      }
      result = await dropboxJson(token, endpoint, args);
    }

    // If list_folder was on an ancestor path (not a fully-allowed path), filter entries.
    if (
      result.ok &&
      (action === "list_folder" || action === "list_folder_continue") &&
      result.data && Array.isArray(result.data.entries)
    ) {
      const listedPath = action === "list_folder" ? String((args as any)?.path ?? "") : "";
      const isFullyAllowed = listedPath && pathAllowedForRead(listedPath, allowlist);
      if (!isFullyAllowed) {
        result.data.entries = filterEntries(result.data.entries, allowlist);
      }
    }

    return jsonResponse(result.ok ? 200 : (result.status || 500), {
      ok: result.ok,
      action,
      status: result.status,
      allowlist,
      data: result.data,
    });
  } catch (e) {
    console.error("dropbox-proxy error:", e);
    return jsonResponse(500, { ok: false, action, error: String(e) });
  }
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Returns null if request passes the gate; otherwise a deny payload.
function checkAllowlist(
  action: string,
  args: any,
  body: any,
  allowlist: string[],
): { status: number; body: any } | null {
  if (!allowlist || allowlist.length === 0) {
    return {
      status: 500,
      body: {
        error: "DROPBOX_ALLOWED_PATHS is empty; refusing all requests",
        hint: "supabase secrets set DROPBOX_ALLOWED_PATHS=\"/1.4 Special Projects\"",
      },
    };
  }

  // Always allow account-info + opaque cursor continuations.
  if (action === "get_current_account") return null;
  if (action === "list_folder_continue" || action === "search_continue") return null;

  if (action === "list_folder") {
    const p = String(args?.path ?? "");
    const recursive = !!args?.recursive;
    if (!pathAllowedForList(p, allowlist)) {
      return { status: 403, body: deny(`list_folder path "${p}" not in allowlist`, allowlist).data };
    }
    if (recursive && !pathAllowedForRead(p, allowlist)) {
      return {
        status: 403,
        body: deny(`recursive list_folder requires an allowed path; "${p}" is only an ancestor`, allowlist).data,
      };
    }
    return null;
  }

  if (action === "search") {
    const sp = String(args?.options?.path ?? "");
    if (!pathAllowedForRead(sp, allowlist)) {
      return { status: 403, body: deny(`search must scope options.path to an allowed prefix; got "${sp}"`, allowlist).data };
    }
    return null;
  }

  if (
    action === "get_metadata" ||
    action === "get_temporary_link" ||
    action === "list_revisions" ||
    action === "download" ||
    action === "download_text"
  ) {
    const p = String(args?.path ?? "");
    if (!pathAllowedForRead(p, allowlist)) {
      return { status: 403, body: deny(`${action} path "${p}" not in allowlist`, allowlist).data };
    }
    return null;
  }

  if (action === "raw") {
    const p = String(args?.path ?? "");
    if (!pathAllowedForRead(p, allowlist)) {
      return { status: 403, body: deny(`raw call must pass args.path inside an allowed prefix; got "${p}"`, allowlist).data };
    }
    return null;
  }

  // Unknown action — let the main handler return a "no such action" error.
  return null;
}
