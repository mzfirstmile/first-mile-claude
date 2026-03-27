// supabase/functions/sync-inbox/index.ts
// Polls Microsoft Graph API for new emails and upserts into Supabase
// Deploy: supabase functions deploy sync-inbox
// Can be called manually or via pg_cron / external cron every 2-5 min
// Secrets: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, SUPABASE_SERVICE_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAILBOX = "aiassistant@firstmilecap.com";
const GRAPH_BASE = `https://graph.microsoft.com/v1.0/users/${MAILBOX}`;
const TOKEN_URL = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function getGraphToken(): Promise<string> {
  const tenantId = Deno.env.get("AZURE_TENANT_ID")!;
  const clientId = Deno.env.get("AZURE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("AZURE_CLIENT_SECRET")!;

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(TOKEN_URL(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`Token error: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

// Fetch messages from a Graph mail folder
async function fetchMessages(token: string, folder: string, since?: string): Promise<any[]> {
  let url = `${GRAPH_BASE}/mailFolders/${folder}/messages?$top=50&$orderby=receivedDateTime desc`;
  url += "&$select=id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,hasAttachments,isRead,importance,categories,receivedDateTime,sentDateTime";

  if (since) {
    url += `&$filter=receivedDateTime ge ${since}`;
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`Graph messages error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.value || [];
}

// Convert Graph message to our DB row
function mapMessage(msg: any, folder: string) {
  return {
    graph_id: msg.id,
    conversation_id: msg.conversationId || null,
    folder,
    from_address: msg.from?.emailAddress?.address || "",
    from_name: msg.from?.emailAddress?.name || null,
    to_addresses: (msg.toRecipients || []).map((r: any) => ({
      email: r.emailAddress?.address,
      name: r.emailAddress?.name,
    })),
    cc_addresses: (msg.ccRecipients || []).map((r: any) => ({
      email: r.emailAddress?.address,
      name: r.emailAddress?.name,
    })),
    subject: msg.subject || "(no subject)",
    body_preview: msg.bodyPreview || "",
    body_html: msg.body?.contentType === "html" ? msg.body.content : null,
    body_text: msg.body?.contentType === "text" ? msg.body.content : stripHtml(msg.body?.content || ""),
    has_attachments: msg.hasAttachments || false,
    is_read: msg.isRead || false,
    importance: msg.importance || "normal",
    categories: msg.categories || [],
    received_at: msg.receivedDateTime,
    sent_at: msg.sentDateTime || null,
    synced_at: new Date().toISOString(),
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SB_SERVICE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Determine how far back to sync — check last synced timestamp
    const { data: latest } = await sb
      .from("emails")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1)
      .single();

    // Default to last 24 hours if no prior sync
    const since = latest?.synced_at
      ? new Date(new Date(latest.synced_at).getTime() - 5 * 60000).toISOString() // 5 min overlap
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const token = await getGraphToken();

    // Sync inbox and sentItems
    const folders = ["inbox", "sentItems"];
    let totalSynced = 0;

    for (const folder of folders) {
      const messages = await fetchMessages(token, folder, since);
      if (messages.length === 0) continue;

      const rows = messages.map((m) => mapMessage(m, folder === "sentItems" ? "sent" : "inbox"));

      // Upsert by graph_id (skip duplicates, update read status etc.)
      const { error } = await sb
        .from("emails")
        .upsert(rows, { onConflict: "graph_id", ignoreDuplicates: false });

      if (error) throw new Error(`Supabase upsert error: ${JSON.stringify(error)}`);
      totalSynced += rows.length;
    }

    return new Response(
      JSON.stringify({ success: true, synced: totalSynced, since }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("sync-inbox error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
