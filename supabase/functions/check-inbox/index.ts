// supabase/functions/check-inbox/index.ts
// Syncs inbox, forwards new emails to Morris, and triggers auto-reply via Claude
// Skips emails FROM Morris or FROM the AI assistant itself
// Deploy: supabase functions deploy check-inbox
// Schedule via pg_cron every 5 minutes
// Secrets: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, SB_SERVICE_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAILBOX = "aiassistant@firstmilecap.com";
const FORWARD_TO = "mz@firstmilecap.com";
// SKIP_FORWARD: don't forward these senders' emails (prevents loops)
// SKIP_REPLY: don't auto-reply to these (the AI itself)
const SKIP_FORWARD = ["mz@firstmilecap.com", "aiassistant@firstmilecap.com"];
const SKIP_REPLY = ["aiassistant@firstmilecap.com"];

const GRAPH_BASE = `https://graph.microsoft.com/v1.0/users/${MAILBOX}`;
const GRAPH_SEND_URL = `${GRAPH_BASE}/sendMail`;
const TOKEN_URL = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

const SIGNATURE = `
<p>Thank you,<br>First Mile AI Assistant</p>
<p>362 Fifth Avenue, 9th Floor<br>New York, NY 10001<br>(201) 549-9232 (text enabled)<br><a href="https://firstmilecap.com">FirstMileCap.com</a></p>
<img src="https://admin.firstmilecap.com/assets/First_Mile_Capital_Logo_RGB.png" alt="First Mile Capital" style="width:200px;margin-top:8px;">
`;


// Trusted external senders (colleagues' non-firstmilecap addresses, e.g. Crown aliases) live in
// table ai_trusted_senders(email). Anyone @firstmilecap.com is always trusted.
async function isTrustedSender(sb: any, fromAddr: string): Promise<boolean> {
  const addr = (fromAddr || "").toLowerCase();
  if (!addr) return false;
  if (addr.split("@")[1] === "firstmilecap.com") return true;
  try {
    const { data } = await sb.from("ai_trusted_senders").select("email").eq("email", addr).limit(1);
    return !!(data && data.length);
  } catch (_) { return false; }
}

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

async function sendForward(token: string, original: any): Promise<void> {
  const fromName = original.from_name || original.from_address;
  const receivedAt = new Date(original.received_at).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const forwardBody = `
<p><strong>New email received at aiassistant@firstmilecap.com</strong></p>
<hr style="border:none;border-top:1px solid #ccc;margin:12px 0;">
<p><strong>From:</strong> ${fromName} &lt;${original.from_address}&gt;<br>
<strong>Date:</strong> ${receivedAt}<br>
<strong>Subject:</strong> ${original.subject}</p>
<hr style="border:none;border-top:1px solid #ccc;margin:12px 0;">
${original.body_html || `<p>${original.body_text || original.body_preview || "(empty)"}</p>`}
<hr style="border:none;border-top:1px solid #ccc;margin:12px 0;">
${SIGNATURE}
`;

  const message = {
    subject: `FWD: ${original.subject}`,
    body: { contentType: "HTML", content: forwardBody },
    toRecipients: [{ emailAddress: { address: FORWARD_TO } }],
  };

  const res = await fetch(GRAPH_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: false }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Forward send error: ${res.status} ${err}`);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SB_SERVICE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // ── Step 1: Sync inbox (call our own sync-inbox function logic inline) ──
    const token = await getGraphToken();

    // Get last sync time
    const { data: latest } = await sb
      .from("emails")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1)
      .single();

    const since = latest?.synced_at
      ? new Date(new Date(latest.synced_at).getTime() - 5 * 60000).toISOString()
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Fetch inbox messages from Graph
    let url = `${GRAPH_BASE}/mailFolders/inbox/messages?$top=50&$orderby=receivedDateTime desc`;
    url += "&$select=id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,hasAttachments,isRead,importance,categories,receivedDateTime,sentDateTime";
    url += `&$filter=receivedDateTime ge ${since}`;

    const graphRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!graphRes.ok) throw new Error(`Graph error: ${graphRes.status} ${await graphRes.text()}`);
    const messages = (await graphRes.json()).value || [];

    // Upsert into DB
    const rows = messages.map((msg: any) => ({
      graph_id: msg.id,
      conversation_id: msg.conversationId || null,
      folder: "inbox",
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
      body_text: msg.body?.contentType === "text" ? msg.body.content
        : (msg.body?.content || "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      has_attachments: msg.hasAttachments || false,
      is_read: msg.isRead || false,
      importance: msg.importance || "normal",
      categories: msg.categories || [],
      received_at: msg.receivedDateTime,
      sent_at: msg.sentDateTime || null,
      synced_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error } = await sb
        .from("emails")
        .upsert(rows, { onConflict: "graph_id", ignoreDuplicates: false });
      if (error) throw new Error(`Upsert error: ${JSON.stringify(error)}`);
    }

    // ── Step 2: Find unread emails not yet forwarded ──
    const { data: unread, error: queryErr } = await sb
      .from("emails")
      .select("*")
      .eq("folder", "inbox")
      .eq("is_read", false)
      .is("forwarded_at", null)
      .order("received_at", { ascending: false })
      .limit(20);

    if (queryErr) throw new Error(`Query error: ${JSON.stringify(queryErr)}`);

    // Filter out the AI assistant's own emails (always skip those)
    const toProcess = (unread || []).filter(
      (e: any) => (e.from_address || "").toLowerCase() !== "aiassistant@firstmilecap.com"
    );

    // ── Step 3: Auto-reply and mark as processed ──
    let forwarded = 0;
    let replied = 0;
    const autoReplyUrl = `${supabaseUrl}/functions/v1/auto-reply`;

    for (const email of toProcess) {
      const fromAddr = (email.from_address || "").toLowerCase();
      try {
        // Email forwarding to Morris disabled per Morris's request
        // if (!SKIP_FORWARD.includes(fromAddr)) { await sendForward(token, email); }

        // Trigger auto-reply via Claude — @firstmilecap.com senders (including Morris) + trusted external aliases
        if (!SKIP_REPLY.includes(fromAddr) && await isTrustedSender(sb, fromAddr)) {
          try {
            console.log(`Triggering auto-reply for email ${email.id} from ${fromAddr}`);
            const replyRes = await fetch(autoReplyUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ emailId: email.id }),
            });
            if (replyRes.ok) {
              console.log(`Auto-reply succeeded for ${email.id}`);
              replied++;
            } else {
              console.error(`Auto-reply failed for ${email.id}: ${await replyRes.text()}`);
            }
          } catch (replyErr) {
            console.error(`Auto-reply error for ${email.id}:`, replyErr);
          }
        }

        // Mark as processed
        await sb
          .from("emails")
          .update({ forwarded_at: new Date().toISOString() })
          .eq("id", email.id);
        forwarded++;
      } catch (fwdErr) {
        console.error(`Failed to process email ${email.id}:`, fwdErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, synced: rows.length, forwarded, replied, since }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("check-inbox error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
