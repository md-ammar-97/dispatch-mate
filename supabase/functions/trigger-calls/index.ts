import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUBVERSE_API_URL = "https://api.subverseai.com/api/call/trigger";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Authentication ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } =
      await authClient.auth.getClaims(token);

    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── API Key ──
    const SUBVERSE_API_KEY = Deno.env.get("SUBVERSE_API_KEY");
    if (!SUBVERSE_API_KEY) {
      throw new Error("SUBVERSE_API_KEY is not configured");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Input validation ──
    const bodyText = await req.text();
    if (bodyText.length > 10000) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { dataset_id } = JSON.parse(bodyText);

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!dataset_id || typeof dataset_id !== "string" || !uuidRegex.test(dataset_id)) {
      return new Response(
        JSON.stringify({ error: "dataset_id is required and must be a valid UUID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Atomic claim (now serialized by pg_advisory_xact_lock inside SQL fn) ──
    const { data: claimed, error: claimErr } = await supabase.rpc(
      "claim_next_queued_call",
      { p_dataset_id: dataset_id }
    );

    if (claimErr) {
      console.error("[Trigger] claim_next_queued_call error:", claimErr);
      throw claimErr;
    }

    if (!claimed || claimed.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No dispatchable calls (queue empty, retry_at not reached, or call in progress)",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const call = claimed[0];
    console.log(
      `[Trigger] Dispatching call ${call.id} (attempt ${call.attempt}/${call.max_attempts})`
    );

    // ── Place Subverse call ──
    try {
      const subversePayload = {
        phoneNumber: call.phone_number,
        agentName: "sample_test_9",
        metadata: {
          // ✅ Always include our UUID for webhook correlation
          call_id: call.id,
          dataset_id,
          reg_no: call.reg_no,
          driver_name: call.driver_name,
          driver_phone: call.phone_number,

          // ✅ Add attempt for debugging + safer correlation later
          attempt: call.attempt,

          message:
            call.message ||
            `Hello ${call.driver_name}, your vehicle ${call.reg_no} is ready for dispatch.`,
        },
      };

      const response = await fetch(SUBVERSE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": SUBVERSE_API_KEY,
        },
        body: JSON.stringify(subversePayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Subverse API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const callSid =
        result.data?.callId ||
        result.data?.call_id ||
        result.callId ||
        result.callSid ||
        null;

      await supabase
        .from("calls")
        .update({ status: "active", call_sid: callSid })
        .eq("id", call.id);

      console.log(`[Trigger] Call ${call.id} active, call_sid: ${callSid}`);

      return new Response(
        JSON.stringify({ success: true, call_id: call.id, call_sid: callSid }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error(`[Trigger] Subverse dispatch failed for ${call.id}:`, err);

      await supabase
        .from("calls")
        .update({
          status: "failed",
          error_message: err instanceof Error ? err.message : "Dispatch failed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", call.id);

      await supabase.rpc("increment_dataset_counts", {
        p_dataset_id: dataset_id,
        p_successful: 0,
        p_failed: 1,
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : "Dispatch failed",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("[Trigger] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
