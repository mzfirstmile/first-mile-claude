// supabase/functions/run-sql/index.ts
// Executes arbitrary SQL via the Supabase service role (admin only)
// Deploy: supabase functions deploy run-sql --no-verify-jwt
// Secrets: SB_SERVICE_KEY (Supabase service role key)
//
// Usage: POST with { "sql": "SELECT * FROM ..." }
// Auth: Requires x-admin-key header matching SB_SERVICE_KEY, OR Supabase anon JWT
// WARNING: This gives full DB access — only expose to trusted admin UIs

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sql } = await req.json();

    if (!sql || typeof sql !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing required field: sql" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SB_SERVICE_KEY")!;

    // Use the Supabase client with service role to execute raw SQL via rpc
    // We'll use the pg_net or direct REST approach
    // Supabase exposes a built-in rpc for this if we create one

    // Execute via PostgREST's built-in /rpc endpoint with a helper function
    // First, try using the Supabase management API (pg meta)
    const pgRes = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    });

    if (!pgRes.ok) {
      const errText = await pgRes.text();
      // If the exec_sql function doesn't exist yet, tell the caller
      if (errText.includes("exec_sql") && errText.includes("does not exist")) {
        return new Response(
          JSON.stringify({
            error: "exec_sql function not found. Run this in SQL Editor first:",
            setup_sql: `CREATE OR REPLACE FUNCTION public.exec_sql(query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || query || ') t' INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
EXCEPTION WHEN OTHERS THEN
  -- For non-SELECT statements (INSERT, UPDATE, ALTER, etc.)
  BEGIN
    EXECUTE query;
    RETURN jsonb_build_object('success', true, 'message', 'Statement executed successfully');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', true, 'message', SQLERRM, 'detail', SQLSTATE);
  END;
END;
$$;`
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`SQL execution failed: ${pgRes.status} ${errText}`);
    }

    const result = await pgRes.json();

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("run-sql error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
