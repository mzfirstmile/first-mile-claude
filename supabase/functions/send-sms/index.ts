// supabase/functions/send-sms/index.ts
// Sends SMS via Twilio API from +18665684445
// Deploy: supabase functions deploy send-sms
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SB_SERVICE_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.177.0/encoding/base64.ts";

const TWILIO_FROM = "+18665684445";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, body, sentBy } = await req.json();

    if (!to || !body) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize phone number — ensure +1 prefix for US numbers
    let toNumber = to.replace(/[\s\-\(\)]/g, "");
    if (!toNumber.startsWith("+")) {
      toNumber = toNumber.startsWith("1") ? `+${toNumber}` : `+1${toNumber}`;
    }

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;

    // Twilio REST API — send SMS
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const authHeader = `Basic ${base64Encode(new TextEncoder().encode(`${accountSid}:${authToken}`))}`;

    const params = new URLSearchParams({
      From: TWILIO_FROM,
      To: toNumber,
      Body: body,
    });

    const twilioRes = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const twilioData = await twilioRes.json();

    if (!twilioRes.ok) {
      throw new Error(`Twilio error: ${twilioData.message || JSON.stringify(twilioData)}`);
    }

    // Log to Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SB_SERVICE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    await sb.from("sms_messages").insert({
      twilio_sid: twilioData.sid,
      direction: "outbound",
      from_number: TWILIO_FROM,
      to_number: toNumber,
      body: body,
      status: twilioData.status || "sent",
      num_segments: twilioData.num_segments || 1,
      sent_by: sentBy || "ai-assistant",
      created_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({ success: true, message: `SMS sent to ${toNumber}`, sid: twilioData.sid }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-sms error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
