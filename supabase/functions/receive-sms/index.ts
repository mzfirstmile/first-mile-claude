// supabase/functions/receive-sms/index.ts
// Twilio webhook — receives inbound SMS and stores in Supabase
// Deploy: supabase functions deploy receive-sms
// Then configure Twilio webhook URL: https://qrtleqasnhbnruodlgpt.supabase.co/functions/v1/receive-sms
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
    // Twilio sends webhook as application/x-www-form-urlencoded
    const formData = await req.formData();
    const messageSid = formData.get("MessageSid") as string;
    const from = formData.get("From") as string;
    const to = formData.get("To") as string;
    const body = formData.get("Body") as string;
    const numSegments = parseInt(formData.get("NumSegments") as string || "1");

    if (!messageSid || !from || !body) {
      return new Response(
        "<Response><Message>Error: missing fields</Message></Response>",
        { status: 400, headers: { "Content-Type": "text/xml" } }
      );
    }

    // Store in Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SB_SERVICE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    await sb.from("sms_messages").upsert(
      {
        twilio_sid: messageSid,
        direction: "inbound",
        from_number: from,
        to_number: to,
        body: body,
        status: "received",
        num_segments: numSegments,
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
      { onConflict: "twilio_sid" }
    );

    // Respond with empty TwiML (no auto-reply)
    return new Response(
      "<Response></Response>",
      { headers: { "Content-Type": "text/xml" } }
    );
  } catch (err) {
    console.error("receive-sms error:", err);
    return new Response(
      "<Response><Message>Internal error</Message></Response>",
      { status: 500, headers: { "Content-Type": "text/xml" } }
    );
  }
});
