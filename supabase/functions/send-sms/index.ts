// supabase/functions/send-sms/index.ts
// Sends SMS via Telnyx API from +18665684445
// Deploy: supabase functions deploy send-sms
// Secrets: TELNYX_API_KEY, SB_SERVICE_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELNYX_FROM = "+18665684445";

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

    const apiKey = Deno.env.get("TELNYX_API_KEY")!;

    // Telnyx v2 API — send SMS
    const telnyxRes = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: TELNYX_FROM,
        to: toNumber,
        text: body,
      }),
    });

    const telnyxData = await telnyxRes.json();

    if (!telnyxRes.ok) {
      const errMsg = telnyxData?.errors?.[0]?.detail || JSON.stringify(telnyxData);
      throw new Error(`Telnyx error: ${errMsg}`);
    }

    const messageId = telnyxData?.data?.id;

    // Log to Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SB_SERVICE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    await sb.from("sms_messages").insert({
      provider_id: messageId,
      direction: "outbound",
      from_number: TELNYX_FROM,
      to_number: toNumber,
      body: body,
      status: telnyxData?.data?.to?.[0]?.status || "queued",
      num_segments: telnyxData?.data?.parts || 1,
      sent_by: sentBy || "ai-assistant",
      created_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({ success: true, message: `SMS sent to ${toNumber}`, id: messageId }),
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
