// supabase/functions/receive-sms/index.ts
// Telnyx webhook — receives inbound SMS and stores in Supabase
// Deploy: supabase functions deploy receive-sms
// Then configure Telnyx webhook URL: https://qrtleqasnhbnruodlgpt.supabase.co/functions/v1/receive-sms
// Secrets: SB_SERVICE_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Return 200 to acknowledge receipt (Telnyx requires 2xx within 2 seconds)
    return new Response(
      JSON.stringify({ ok: true }),
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
