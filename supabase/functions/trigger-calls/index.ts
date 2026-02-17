import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://axestrack.lovable.app",
  "https://id-preview--fef5f3e2-9d19-4c14-a323-cab361a02cc1.lovable.app",
  "http://localhost:5173",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

const SUBVERSE_API_URL = "https://api.subverseai.com/api/call/trigger";

// ── Backstop timeout ──
// Subverse does NOT send explicit failure webhooks for unanswered calls.
// If a call stays ringing/active beyond this, treat as "no answer".
// 1.2 minutes: long enough for legitimate calls to complete, short enough
// to not block the batch forever.
const BACKSTOP_TIMEOUT_SECONDS = 100;

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TERMINAL_STATUSES = new Set([
  "completed", "failed", "canceled", "expired", "errored",
]);

// deno-lint-ignore no-explicit-any
async function cleanupStaleInProgressCalls(supabase: any, datasetId: string) {
  const now = Date.now();

  // Find calls stuck in ringing or active beyond the backstop timeout
  const { data: stuckCalls, error } = await supabase
    .from("calls")
    .select("id, status, started_at, attempt, max_attempts, retry_after_minutes")
    .eq("dataset_id", datasetId)
    .in("status", ["ringing", "active"]);

  if (error) {
    console.error("[Trigger] cleanupStaleInProgressCalls select error:", error);
    return;
  }

  if (!stuckCalls || stuckCalls.length === 0) return;

  for (const call of stuckCalls) {
    if (!call.started_at) continue;

    const startedAtMs = new Date(call.started_at).getTime();
    if (Number.isNaN(startedAtMs)) continue;

    const ageSeconds = (now - startedAtMs) / 1000;

    // Only timeout after the full backstop period
    if (ageSeconds < BACKSTOP_TIMEOUT_SECONDS) continue;

    const currentAttempt = call.attempt || 1;
    const maxAttempts = call.max_attempts || 1;
    const retryMinutes = call.retry_after_minutes || 2;

    if (currentAttempt < maxAttempts) {
      const retryAt = new Date(Date.now() + retryMinutes * 60 * 1000).toISOString();
      const nextAttempt = currentAttempt + 1;

      console.log(
        `[Trigger] Backstop timeout (${BACKSTOP_TIMEOUT_SECONDS}s) -> requeue ${call.id} attempt ${nextAttempt}/${maxAttempts} at ${retryAt}`
      );

      await supabase
        .from("calls")
        .update({
          status: "queued",
          attempt: nextAttempt,
          retry_at: retryAt,
          error_message: `No answer (backstop timeout ${BACKSTOP_TIMEOUT_SECONDS}s). Retry scheduled.`,
          started_at: null,
          completed_at: null,
          call_sid: null,
        })
        .eq("id", call.id)
        .in("status", ["ringing", "active"]); // safe: only update if still in-progress
    } else {
      console.log(
        `[Trigger] Backstop timeout -> permanent fail ${call.id} after ${currentAttempt}/${maxAttempts}`
      );

      await supabase
        .from("calls")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: `No answer (backstop timeout ${BACKSTOP_TIMEOUT_SECONDS}s) after ${currentAttempt} attempts`,
        })
        .eq("id", call.id)
        .in("status", ["ringing", "active"]); // safe: only update if still in-progress

      await supabase.rpc("increment_dataset_counts", {
        p_dataset_id: datasetId,
        p_successful: 0,
        p_failed: 1,
      });
    }
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

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

    const { data: { user }, error: userError } = await authClient.auth.getUser();

    if (userError || !user) {
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

    if (!dataset_id || typeof dataset_id !== "string" || !uuidRegex.test(dataset_id)) {
      return new Response(
        JSON.stringify({ error: "dataset_id is required and must be a valid UUID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Cleanup calls that exceeded the backstop timeout ──
    // This handles the case where Subverse never sent a completion/failure webhook
    await cleanupStaleInProgressCalls(supabase, dataset_id);

    // ── Check dataset completion after cleanup ──
    const terminalList = [...TERMINAL_STATUSES].map((s) => `'${s}'`).join(",");
    const { data: remaining } = await supabase
      .from("calls")
      .select("id")
      .eq("dataset_id", dataset_id)
      .not("status", "in", `(${terminalList})`);

    if (!remaining || remaining.length === 0) {
      // All calls done — mark dataset completed
      await supabase
        .from("datasets")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", dataset_id);

      return new Response(
        JSON.stringify({ message: "All calls completed. Dataset finalized." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Atomic claim ──
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
          message:
            "No dispatchable calls (queue empty, retry_at not reached, or call in progress)",
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
          call_id: call.id,
          dataset_id,
          reg_no: call.reg_no,
          driver_name: call.driver_name,
          driver_phone: call.phone_number,
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

      // Keep as ringing until webhook says initiated
      await supabase
        .from("calls")
        .update({ status: "ringing", call_sid: callSid })
        .eq("id", call.id);

      console.log(`[Trigger] Call ${call.id} ringing, call_sid: ${callSid}`);

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
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
