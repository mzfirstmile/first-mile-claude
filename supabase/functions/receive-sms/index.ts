// supabase/functions/receive-sms/index.ts
// Telnyx webhook — receives inbound SMS, stores in Supabase, and auto-replies via Claude
// Deploy: supabase functions deploy receive-sms
// Then configure Telnyx webhook URL: https://qrtleqasnhbnruodlgpt.supabase.co/functions/v1/receive-sms
// Secrets: SB_SERVICE_KEY, CLAUDE_API_KEY, TELNYX_API_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELNYX_FROM = "+12015499232";
const FORWARD_TO = "mz@firstmilecap.com"; // Forward SMS notifications to Morris via email

const SMS_SYSTEM_PROMPT = `You are the AI assistant for First Mile Capital, a real estate investment firm based at 362 Fifth Avenue, 9th Floor, New York, NY 10001.

You are responding to a text message (SMS) sent to (201) 549-9232.

## About First Mile Capital
First Mile Capital is a real estate investment firm. The managing partner is Morris Zeitouni.

## Key People
- Morris Zeitouni — Managing Partner
- Richard "Ricky" Chera — Executive
- Toby Yedid — Executive
- Stanley Chera — Executive
- Rasheq Zarif — Executive

## Your Capabilities
- You have access to property-level financials (actuals vs. budget) across the portfolio
- You have access to executive-level business financials
- A strategic forecasting module is being built
- You can also be reached via email at aiassistant@firstmilecap.com or the chat widget at admin.firstmilecap.com

## How to Respond
- Keep replies SHORT — this is SMS, aim for 1-3 sentences max
- Be professional but conversational (it's a text, not an email)
- If the question requires detailed data, suggest they email or use the chat widget instead
- If it's something you can't handle, say you'll have someone from the team follow up
- Do NOT include a signature — it's a text message
- Do NOT use HTML — plain text only`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function generateSmsReply(inboundBody: string, fromNumber: string): Promise<string> {
  const claudeKey = Deno.env.get("CLAUDE_API_KEY")!;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
      "anthropic-workspace-id": Deno.env.get("ANTHROPIC_WORKSPACE_ID") || "wrkspc_01KFMjdE8FRViEkxanZET8rH",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: SMS_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Text message from ${fromNumber}:\n\n${inboundBody}\n\nWrite a brief SMS reply (plain text, 1-3 sentences).`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.content[0]?.text || "Thanks for your message! Someone from our team will get back to you shortly.";
}

async function sendSms(to: string, body: string): Promise<string> {
  const apiKey = Deno.env.get("TELNYX_API_KEY")!;

  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: TELNYX_FROM,
      to,
      text: body,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const errMsg = data?.errors?.[0]?.detail || JSON.stringify(data);
    throw new Error(`Telnyx error: ${errMsg}`);
  }

  return data?.data?.id || "";
}

async function forwardSmsToMorris(from: string, body: string, supabaseUrl: string, supabaseKey: string): Promise<void> {
  // Send email notification to Morris about the incoming text
  const emailBody = `
<p><strong>New text message received at (201) 549-9232</strong></p>
<hr style="border:none;border-top:1px solid #ccc;margin:12px 0;">
<p><strong>From:</strong> ${from}<br>
<strong>Message:</strong> ${body}</p>
<hr style="border:none;border-top:1px solid #ccc;margin:12px 0;">
<p>Thank you,<br>First Mile AI Assistant</p>
<p>362 Fifth Avenue, 9th Floor<br>New York, NY 10001<br>(201) 549-9232 (text enabled)<br><a href="https://firstmilecap.com">FirstMileCap.com</a></p>
<img src="https://admin.firstmilecap.com/assets/First_Mile_Capital_Logo_RGB.png" alt="First Mile Capital" style="width:200px;margin-top:8px;">
`;

  await fetch(`${supabaseUrl}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: FORWARD_TO,
      subject: `SMS from ${from}`,
      body: emailBody,
      sentBy: "sms-forward",
    }),
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Telnyx sends webhook as JSON
    const json = await req.json();

    // Telnyx webhook structure: { data: { event_type, payload: { ... } } }
    const eventType = json?.data?.event_type;

    // Only process inbound messages
    if (eventType !== "message.received") {
      return new Response(
        JSON.stringify({ ok: true, skipped: eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = json.data.payload;
    const messageId = payload.id;
    const from = payload.from?.phone_number;
    const to = payload.to?.[0]?.phone_number || payload.to?.phone_number || "";
    const body = payload.text || "";
    const parts = payload.parts || 1;
    const receivedAt = payload.received_at || new Date().toISOString();

    if (!messageId || !from || !body) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Store in Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SB_SERVICE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    await sb.from("sms_messages").upsert(
      {
        provider_id: messageId,
        direction: "inbound",
        from_number: from,
        to_number: to,
        body: body,
        status: "received",
        num_segments: parts,
        received_at: receivedAt,
        created_at: new Date().toISOString(),
      },
      { onConflict: "provider_id" }
    );

    // Do auto-reply and forwarding synchronously before returning
    // Telnyx is tolerant of slower responses and will retry on timeout anyway
    let replyText = "";
    let replied = false;

    try {
      replyText = await generateSmsReply(body, from);
      const replyMsgId = await sendSms(from, replyText);

      await sb.from("sms_messages").insert({
        provider_id: replyMsgId,
        direction: "outbound",
        from_number: TELNYX_FROM,
        to_number: from,
        body: replyText,
        status: "sent",
        sent_by: "ai-auto-reply",
        created_at: new Date().toISOString(),
      });

      replied = true;
      console.log(`Auto-replied to ${from}: ${replyText.substring(0, 50)}...`);
    } catch (replyErr) {
      console.error(`SMS auto-reply error:`, replyErr);
    }

    // SMS forwarding to Morris via email disabled per Morris's request
    // To re-enable, uncomment:
    // try {
    //   await forwardSmsToMorris(from, body, supabaseUrl, supabaseKey);
    // } catch (fwdErr) {
    //   console.error(`SMS forward error:`, fwdErr);
    // }

    return new Response(
      JSON.stringify({ ok: true, replied }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("receive-sms error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
