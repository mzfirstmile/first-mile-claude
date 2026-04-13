// supabase/functions/send-email/index.ts
// Sends email via Microsoft Graph API on behalf of aiassistant@firstmilecap.com
// Deploy: supabase functions deploy send-email
// Secrets needed: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, SUPABASE_SERVICE_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH_SEND_URL = "https://graph.microsoft.com/v1.0/users/aiassistant@firstmilecap.com/sendMail";
const TOKEN_URL = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Get Graph API access token (client credentials flow) ──
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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, cc, bcc, subject, body, bodyType, sentBy, attachments, replyToGraphId } = await req.json();

    // Validate required fields
    if (!to || !subject || !body) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, subject, body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize recipients to array of {email, name?}
    const toRecipients = (Array.isArray(to) ? to : [to]).map((r: any) =>
      typeof r === "string"
        ? { emailAddress: { address: r } }
        : { emailAddress: { address: r.email, name: r.name } }
    );

    const ccRecipients = cc
      ? (Array.isArray(cc) ? cc : [cc]).map((r: any) =>
          typeof r === "string"
            ? { emailAddress: { address: r } }
            : { emailAddress: { address: r.email, name: r.name } }
        )
      : [];

    const bccRecipients = bcc
      ? (Array.isArray(bcc) ? bcc : [bcc]).map((r: any) =>
          typeof r === "string"
            ? { emailAddress: { address: r } }
            : { emailAddress: { address: r.email, name: r.name } }
        )
      : [];

    const token = await getGraphToken();

    // If replyToGraphId is provided, use Graph /reply endpoint for proper threading
    if (replyToGraphId) {
      const replyPayload: any = {
        message: {
          body: {
            contentType: bodyType === "text" ? "Text" : "HTML",
            content: body,
          },
        },
      };
      if (ccRecipients.length > 0) replyPayload.message.ccRecipients = ccRecipients;
      if (bccRecipients.length > 0) replyPayload.message.bccRecipients = bccRecipients;
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        replyPayload.message.attachments = attachments.map((a: any) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: a.name,
          contentType: a.contentType || "application/octet-stream",
          contentBytes: a.contentBytes,
        }));
      }

      const replyUrl = `https://graph.microsoft.com/v1.0/users/aiassistant@firstmilecap.com/messages/${replyToGraphId}/reply`;
      const graphRes = await fetch(replyUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(replyPayload),
      });

      if (!graphRes.ok) {
        const err = await graphRes.text();
        throw new Error(`Graph reply error: ${graphRes.status} ${err}`);
      }

      // Log and return (skip sendMail path)
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SB_SERVICE_KEY")!;
      const sb = createClient(supabaseUrl, supabaseKey);
      await sb.from("email_sent_log").insert({
        to_addresses: toRecipients.map((r: any) => ({ email: r.emailAddress.address, name: r.emailAddress.name || null })),
        cc_addresses: ccRecipients.map((r: any) => ({ email: r.emailAddress.address, name: r.emailAddress.name || null })),
        subject,
        body_html: bodyType === "text" ? null : body,
        sent_by: sentBy || "ai-assistant",
      });

      return new Response(
        JSON.stringify({ success: true, message: `Reply sent in-thread to ${toRecipients.map((r: any) => r.emailAddress.address).join(", ")}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Standard sendMail path (new email, not a reply)
    // Build Graph API payload
    const message: any = {
      subject,
      body: {
        contentType: bodyType === "text" ? "Text" : "HTML",
        content: body,
      },
      toRecipients,
      ccRecipients,
    };

    if (bccRecipients.length > 0) {
      message.bccRecipients = bccRecipients;
    }

    // Add attachments if provided
    // Each attachment: { name: "file.pdf", contentType: "application/pdf", contentBytes: "<base64>" }
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      message.attachments = attachments.map((a: any) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: a.name,
        contentType: a.contentType || "application/octet-stream",
        contentBytes: a.contentBytes,
      }));
    }

    const graphRes = await fetch(GRAPH_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });

    if (!graphRes.ok) {
      const err = await graphRes.text();
      throw new Error(`Graph API error: ${graphRes.status} ${err}`);
    }

    // Log to Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SB_SERVICE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    await sb.from("email_sent_log").insert({
      to_addresses: toRecipients.map((r: any) => ({
        email: r.emailAddress.address,
        name: r.emailAddress.name || null,
      })),
      cc_addresses: ccRecipients.map((r: any) => ({
        email: r.emailAddress.address,
        name: r.emailAddress.name || null,
      })),
      subject,
      body_html: bodyType === "text" ? null : body,
      sent_by: sentBy || "ai-assistant",
    });

    return new Response(
      JSON.stringify({ success: true, message: `Email sent to ${toRecipients.map((r: any) => r.emailAddress.address).join(", ")}` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-email error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
