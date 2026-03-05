import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ✅ UPDATED: Dynamic CORS handling for Lovable preview domains
function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  
  // Define base allowed origins
  const allowedOrigins = [
    "https://axestrack.lovable.app",
    "http://localhost:5173"
  ];

  // Dynamically allow any Lovable preview or project domain
  const isLovableDomain = origin.endsWith(".lovableproject.com") || 
                          origin.endsWith(".lovable.app") ||
                          allowedOrigins.includes(origin);

  return {
    "Access-Control-Allow-Origin": isLovableDomain ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const SUBVERSE_API_URL = "https://api.subverseai.com/api/call/trigger";

// ✅ UPDATED: 120s Backstop to align with 2-minute retry cycle
const BACKSTOP_TIMEOUT_SECONDS = 120;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TERMINAL_STATUSES = new Set([
  "completed", "failed", "canceled", "expired", "errored",
]);

async function cleanupStaleInProgressCalls(supabase: any, datasetId: string) {
  const now = Date.now();
  const { data: stuckCalls, error } = await supabase
    .from("calls")
    .select("id, status, started_at, attempt, max_attempts, retry_after_minutes")
    .eq("dataset_id", datasetId)
    .in("status", ["ringing", "active"]);

  if (error) {
    console.error("[Trigger] cleanupStaleInProgressCalls error:", error);
    return;
  }

  if (!stuckCalls || stuckCalls.length === 0) return;

  for (const call of stuckCalls) {
    if (!call.started_at) continue;
    const ageSeconds = (now - new Date(call.started_at).getTime()) / 1000;

    if (ageSeconds < BACKSTOP_TIMEOUT_SECONDS) continue;

    const currentAttempt = call.attempt || 1;
    const maxAttempts = call.max_attempts || 1;
    const retryMinutes = call.retry_after_minutes || 2;

    if (currentAttempt < maxAttempts) {
      const retryAt = new Date(Date.now() + retryMinutes * 60 * 1000).toISOString();
      await supabase.from("calls").update({
        status: "queued",
        attempt: currentAttempt + 1,
        retry_at: retryAt,
        error_message: `No answer (backstop ${BACKSTOP_TIMEOUT_SECONDS}s).`,
        started_at: null,
        call_sid: null,
      }).eq("id", call.id).in("status", ["ringing", "active"]);
    } else {
      await supabase.from("calls").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: `No answer after ${currentAttempt} attempts.`,
      }).eq("id", call.id).in("status", ["ringing", "active"]);

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const bodyText = await req.text();
    const { dataset_id } = JSON.parse(bodyText);

    if (!dataset_id || !uuidRegex.test(dataset_id)) {
      return new Response(JSON.stringify({ error: "Invalid dataset_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await cleanupStaleInProgressCalls(supabase, dataset_id);

    const terminalList = [...TERMINAL_STATUSES].map((s) => `'${s}'`).join(",");
    const { data: remaining } = await supabase
      .from("calls")
      .select("id")
      .eq("dataset_id", dataset_id)
      .not("status", "in", `(${terminalList})`);

    if (!remaining || remaining.length === 0) {
      await supabase.from("datasets").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", dataset_id);
      return new Response(JSON.stringify({ message: "Completed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: claimed, error: claimErr } = await supabase.rpc("claim_next_queued_call", { p_dataset_id: dataset_id });

    if (claimErr || !claimed || claimed.length === 0) {
      return new Response(JSON.stringify({ message: "No calls ready" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const call = claimed[0];
    const SUBVERSE_API_KEY = Deno.env.get("SUBVERSE_API_KEY");

    const response = await fetch(SUBVERSE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": SUBVERSE_API_KEY! },
      body: JSON.stringify({
        phoneNumber: call.phone_number,
        agentName: "sample_test_9",
        agentNumber: "+919228055503",
        metadata: { call_id: call.id, dataset_id, reg_no: call.reg_no, driver_name: call.driver_name, attempt: call.attempt },
      }),
    });

    const result = await response.json();
    const callSid = result.data?.callId || result.callId || null;

    await supabase.from("calls").update({ status: "ringing", call_sid: callSid }).eq("id", call.id);

    return new Response(JSON.stringify({ success: true, call_id: call.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
