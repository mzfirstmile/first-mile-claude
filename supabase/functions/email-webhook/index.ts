// supabase/functions/email-webhook/index.ts
// Microsoft Graph webhook endpoint — receives push notifications when new email arrives
// Then syncs the new message and forwards to Morris immediately
// Deploy: supabase functions deploy email-webhook
// Secrets: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, SB_SERVICE_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAILBOX = "aiassistant@firstmilecap.com";
const FORWARD_TO = "mz@firstmilecap.com";
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

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // ── Step 1: Handle Microsoft validation handshake ──
  // When you create a subscription, Graph sends a GET with ?validationToken=xxx
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) {
    console.log("Webhook validation request received");
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // ── Step 2: Handle actual notification ──
  try {
    const body = await req.json();
    const notifications = body.value || [];
    console.log(`Received ${notifications.length} notification(s)`);

    if (notifications.length === 0) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await getGraphToken();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SB_SERVICE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    let forwarded = 0;

    for (const notification of notifications) {
      // Each notification has resource like "Users/xxx/Messages/yyy"
      const resource = notification.resource;
      if (!resource) continue;

      // Fetch the full message from Graph
      const msgUrl = `https://graph.microsoft.com/v1.0/${resource}?$select=id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,hasAttachments,isRead,importance,categories,receivedDateTime,sentDateTime`;
      const msgRes = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!msgRes.ok) {
        console.error(`Failed to fetch message: ${msgRes.status}`);
        continue;
      }

      const msg = await msgRes.json();
      const fromAddr = (msg.from?.emailAddress?.address || "").toLowerCase();

      // Upsert into emails table
      const row = {
        graph_id: msg.id,
        conversation_id: msg.conversationId || null,
        folder: "inbox",
        from_address: fromAddr,
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
        body_text:
          msg.body?.contentType === "text"
            ? msg.body.content
            : stripHtml(msg.body?.content || ""),
        has_attachments: msg.hasAttachments || false,
        is_read: msg.isRead || false,
        importance: msg.importance || "normal",
        categories: msg.categories || [],
        received_at: msg.receivedDateTime,
        sent_at: msg.sentDateTime || null,
        synced_at: new Date().toISOString(),
      };

      await sb
        .from("emails")
        .upsert([row], { onConflict: "graph_id", ignoreDuplicates: false });

      // Trigger auto-reply for @firstmilecap.com senders (including Morris) + trusted external aliases
      if (!SKIP_REPLY.includes(fromAddr) && await isTrustedSender(sb, fromAddr)) {
        try {
          const autoReplyUrl = `${supabaseUrl}/functions/v1/auto-reply`;
          // Get the email ID from the upserted row
          const { data: upsertedEmail } = await sb
            .from("emails")
            .select("id")
            .eq("graph_id", msg.id)
            .single();

          if (upsertedEmail) {
            const replyRes = await fetch(autoReplyUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ emailId: upsertedEmail.id }),
            });
            if (replyRes.ok) {
              console.log(`Auto-replied to ${fromAddr}`);
            } else {
              console.error(`Auto-reply failed: ${await replyRes.text()}`);
            }
          }
        } catch (replyErr) {
          console.error(`Auto-reply error:`, replyErr);
        }
      }

      // Email forwarding to Morris disabled per Morris's request
      // To re-enable, uncomment the forwarding block below
      // if (!SKIP_FROM.includes(fromAddr)) { ... }

      // Mark as processed
      if (!SKIP_REPLY.includes(fromAddr)) {
        await sb
          .from("emails")
          .update({ forwarded_at: new Date().toISOString() })
          .eq("graph_id", msg.id);
        forwarded++;
      }
    }

    console.log(`Processed: ${notifications.length} notifications, forwarded: ${forwarded}`);

    // Must return 202 quickly so Graph doesn't retry
    return new Response(
      JSON.stringify({ ok: true, processed: notifications.length, forwarded }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("email-webhook error:", err);
    // Still return 202 to prevent Graph from retrying
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
