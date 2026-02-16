import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Terminal statuses ──
const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "canceled",
  "expired",
  "errored",
]);

/**
 * IMPORTANT:
 * Do NOT treat "call.disconnected"/"call.hangup"/"call.dropped" as retryable.
 * Those often happen in normal call flows (answered calls, normal ends),
 * and will cause false retries + loops.
 */
const RETRYABLE_EVENTS = new Set([
  "call.failed",
  "call.no_answer",
  "call.busy",
  "call.rejected",
  "call.declined",
  "call.expired",
  "call.timeout",
  "call.errored",
  "call.could_not_connect",
]);

const SUBVERSE_API_URL = "https://api.subverseai.com/api/call/trigger";

// ── Payload types ──
interface SubverseWebhookPayload {
  eventType?: string;
  event?: string;
  createdAt?: string;
  data?: {
    callId?: string; // provider call id
    customerNumber?: string;
    duration?: number;
    recordingURL?: string;
    analysis?: {
      summary?: string;
      user_sentiment?: string;
      task_completion?: boolean;
    };
    transcript?: Array<Record<string, string>>;
    node?: {
      output?: {
        call_id?: string; // sometimes present
        call_status?: string;
        transcript?: unknown;
        call_recording_url?: string;
        analysis?: string;
      };
    };
  };
  metadata?: {
    call_id?: string;     // OUR UUID (most reliable)
    dataset_id?: string;
    reg_no?: string;
    attempt?: number;     // we send this from trigger-calls now
  };
}

// ── Helpers ──
function formatTranscript(transcriptData: unknown): string | null {
  if (!transcriptData) return null;
  if (typeof transcriptData === "string") return transcriptData;
  if (Array.isArray(transcriptData)) {
    return transcriptData
      .map((entry) => {
        const role = Object.keys(entry)[0];
        const text = (entry as any)[role];
        return `${role.charAt(0).toUpperCase() + role.slice(1)}: ${text}`;
      })
      .join("\n");
  }
  return null;
}

function extractEventType(payload: SubverseWebhookPayload): string {
  return (payload.eventType || payload.event || "").toLowerCase();
}

/**
 * ✅ CRITICAL FIX:
 * Always prefer OUR UUID from metadata.call_id.
 * Provider callId may arrive before we stored call_sid, causing "call not found"
 * and broken state transitions.
 */
function extractCallId(payload: SubverseWebhookPayload): string | null {
  return (
    payload.metadata?.call_id ||
    payload.data?.node?.output?.call_id ||
    payload.data?.callId ||
    null
  );
}

// deno-lint-ignore no-explicit-any
async function findCall(supabase: any, callId: string) {
  const uuidRegex = /^[0-9a-f-]{36}$/i;

  // If it’s our UUID, fetch directly
  if (uuidRegex.test(callId)) {
    const { data } = await supabase
      .from("calls")
      .select("*")
      .eq("id", callId)
      .maybeSingle();
    if (data) return data;
  }

  // Otherwise treat it as provider call_sid
  const { data: bySid } = await supabase
    .from("calls")
    .select("*")
    .eq("call_sid", callId)
    .maybeSingle();

  return bySid || null;
}

// ── Dispatch next queued call for a dataset ──
// deno-lint-ignore no-explicit-any
async function dispatchNextCall(supabase: any, datasetId: string) {
  const SUBVERSE_API_KEY = Deno.env.get("SUBVERSE_API_KEY");
  if (!SUBVERSE_API_KEY) {
    console.error("[Dispatch] No SUBVERSE_API_KEY configured");
    return;
  }

  const { data: claimed, error } = await supabase.rpc(
    "claim_next_queued_call",
    { p_dataset_id: datasetId }
  );

  if (error) {
    console.error("[Dispatch] claim_next_queued_call error:", error);
    return;
  }

  if (!claimed || claimed.length === 0) {
    console.log("[Dispatch] No dispatchable calls for dataset", datasetId);
    return;
  }

  const call = claimed[0];
  console.log(
    `[Dispatch] Placing call ${call.id} (attempt ${call.attempt}/${call.max_attempts})`
  );

  try {
    const response = await fetch(SUBVERSE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": SUBVERSE_API_KEY,
      },
      body: JSON.stringify({
        phoneNumber: call.phone_number,
        agentName: "sample_test_9",
        metadata: {
          call_id: call.id,
          dataset_id: datasetId,
          reg_no: call.reg_no,
          attempt: call.attempt, // ✅ keep consistent
          driver_name: call.driver_name,
          driver_phone: call.phone_number,
          message:
            call.message ||
            `Hello ${call.driver_name}, your vehicle ${call.reg_no} is ready for dispatch.`,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Subverse: ${response.status} - ${errText}`);
    }

    const result = await response.json();
    const callSid =
      result.data?.callId || result.data?.call_id || result.callId || result.callSid || null;

    await supabase
      .from("calls")
      .update({ status: "active", call_sid: callSid })
      .eq("id", call.id);

    console.log(`[Dispatch] Call ${call.id} active, sid: ${callSid}`);
  } catch (err) {
    console.error(`[Dispatch] Failed for ${call.id}:`, err);

    await supabase
      .from("calls")
      .update({
        status: "failed",
        error_message: err instanceof Error ? err.message : "Dispatch error",
        completed_at: new Date().toISOString(),
      })
      .eq("id", call.id);

    await supabase.rpc("increment_dataset_counts", {
      p_dataset_id: datasetId,
      p_successful: 0,
      p_failed: 1,
    });

    // Do NOT recurse
  }
}

// ── Check if all calls are terminal ──
// deno-lint-ignore no-explicit-any
async function checkDatasetCompletion(supabase: any, datasetId: string) {
  const terminalList = [...TERMINAL_STATUSES].map((s) => `'${s}'`).join(",");

  const { data: remaining } = await supabase
    .from("calls")
    .select("id")
    .eq("dataset_id", datasetId)
    .not("status", "in", `(${terminalList})`);

  if (!remaining || remaining.length === 0) {
    console.log(`[Dataset] All calls terminal. Closing dataset ${datasetId}`);
    await supabase
      .from("datasets")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", datasetId);
  }
}

// ── Main handler ──
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const payload: SubverseWebhookPayload = await req.json();
    const eventType = extractEventType(payload);
    const callId = extractCallId(payload);

    console.log(`[Webhook] Received ${eventType} for call ${callId}`);

    if (!callId) {
      return new Response(JSON.stringify({ success: true, message: "No callId" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const call = await findCall(supabase, callId);
    if (!call) {
      console.error(`[Webhook] Call not found in DB: ${callId}`);
      return new Response(JSON.stringify({ success: true, message: "Call not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Idempotency: skip events for terminal calls ──
    if (TERMINAL_STATUSES.has(call.status)) {
      console.log(
        `[Webhook] Call ${call.id} already terminal (${call.status}). Skipping ${eventType}.`
      );
      return new Response(JSON.stringify({ success: true, message: "Already terminal" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── STATUS TRANSITIONS ──

    if (eventType === "call.in_queue") {
      await supabase.from("calls").update({ status: "queued" }).eq("id", call.id);
    } else if (eventType === "call.placed" || eventType === "call.initiated") {
      await supabase
        .from("calls")
        .update({
          status: "active",
          started_at: call.started_at || new Date().toISOString(),
        })
        .eq("id", call.id);
    } else if (eventType === "call.completed") {
      // ── SUCCESS ──
      const transcriptStr = formatTranscript(
        payload.data?.transcript || payload.data?.node?.output?.transcript
      );
      const recordingUrl =
        payload.data?.recordingURL || payload.data?.node?.output?.call_recording_url;

      await supabase
        .from("calls")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          refined_transcript: transcriptStr || call.refined_transcript,
          recording_url: recordingUrl || call.recording_url,
          call_duration: payload.data?.duration || call.call_duration,
        })
        .eq("id", call.id);

      await supabase.rpc("increment_dataset_counts", {
        p_dataset_id: call.dataset_id,
        p_successful: 1,
        p_failed: 0,
      });

      await dispatchNextCall(supabase, call.dataset_id);
      await checkDatasetCompletion(supabase, call.dataset_id);
    } else if (RETRYABLE_EVENTS.has(eventType)) {
      // ── RETRYABLE FAILURE ──
      const currentAttempt = call.attempt || 1;
      const maxAttempts = call.max_attempts || 1;
      const retryMinutes = call.retry_after_minutes || 2;

      if (currentAttempt < maxAttempts) {
        const retryAt = new Date(Date.now() + retryMinutes * 60 * 1000).toISOString();
        const nextAttempt = currentAttempt + 1;

        console.log(
          `[Webhook] Re-queuing call ${call.id} for retry (attempt ${nextAttempt}/${maxAttempts}) at ${retryAt}`
        );

        await supabase
          .from("calls")
          .update({
            status: "queued",
            attempt: nextAttempt,
            retry_at: retryAt,
            error_message: `Retry scheduled: ${eventType}`,
            completed_at: null,
            started_at: null,
            call_sid: null,
          })
          .eq("id", call.id);

        // ✅ DO NOT dispatch next here.
        // claim_next_queued_call will only pick it up after retry_at.
      } else {
        console.log(
          `[Webhook] Permanently failing call ${call.id}: ${eventType} (attempt ${currentAttempt}/${maxAttempts})`
        );

        await supabase
          .from("calls")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: `Provider event: ${eventType} (after ${currentAttempt} attempts)`,
          })
          .eq("id", call.id);

        await supabase.rpc("increment_dataset_counts", {
          p_dataset_id: call.dataset_id,
          p_successful: 0,
          p_failed: 1,
        });

        await dispatchNextCall(supabase, call.dataset_id);
        await checkDatasetCompletion(supabase, call.dataset_id);
      }
    } else if (eventType === "call.canceled") {
      await supabase
        .from("calls")
        .update({
          status: "canceled",
          completed_at: new Date().toISOString(),
          error_message: `Provider event: ${eventType}`,
        })
        .eq("id", call.id);

      await supabase.rpc("increment_dataset_counts", {
        p_dataset_id: call.dataset_id,
        p_successful: 0,
        p_failed: 1,
      });

      await dispatchNextCall(supabase, call.dataset_id);
      await checkDatasetCompletion(supabase, call.dataset_id);
    } else {
      // Not handled. IMPORTANT: we no longer treat disconnected/hangup/dropped as retryable.
      console.log(`[Webhook] Unhandled event type: ${eventType} for call ${call.id}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("[Webhook Error]", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
