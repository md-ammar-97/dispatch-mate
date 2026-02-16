import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Terminal statuses (never change after reaching these) ──
const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "canceled",
  "expired",
  "errored",
]);

// ── In-progress events ──
// IMPORTANT: call.in_queue MUST be treated as in-progress.
// It should NOT set DB status to "queued" (otherwise trigger-calls will re-dispatch).
const IN_PROGRESS_EVENTS = new Set([
  "call.in_queue",
  "call.placed",
  "call.initiated",
]);

// Retryable failures ONLY (do NOT include call.in_queue)
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
    callId?: string;
    status?: string; // <-- added: provider status sometimes comes here
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
        call_id?: string;
        call_status?: string; // provider status sometimes comes here
        transcript?: unknown;
        call_recording_url?: string;
        analysis?: string;
      };
    };
  };
  metadata?: {
    call_id?: string; // our UUID
    dataset_id?: string;
    reg_no?: string;
    attempt?: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeProviderStatus(
  status: string | null | undefined
): string | null {
  if (!status) return null;

  // Normalize things like:
  // "Call In Queue" -> "call_in_queue"
  // "in-queue" -> "in_queue"
  const normalized = status
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  // Map common provider variants to our routed event
  if (["call_in_queue", "in_queue", "queued"].includes(normalized)) {
    return "call.in_queue";
  }

  return normalized;
}

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

// Prefer OUR UUID from metadata whenever available.
// This avoids wrong matching when Subverse callIds are reused/queued/etc.
function extractOurCallId(payload: SubverseWebhookPayload): string | null {
  return payload.metadata?.call_id || null;
}

function extractProviderCallId(payload: SubverseWebhookPayload): string | null {
  return payload.data?.callId || payload.data?.node?.output?.call_id || null;
}

function extractProviderStatus(payload: SubverseWebhookPayload): string | null {
  return normalizeProviderStatus(
    payload.data?.node?.output?.call_status || payload.data?.status || null
  );
}

// deno-lint-ignore no-explicit-any
async function findCall(
  supabase: any,
  ourCallId: string,
  providerCallId: string | null
) {
  // 1) Our UUID (primary)
  const uuidRegex = /^[0-9a-f-]{36}$/i;
  if (uuidRegex.test(ourCallId)) {
    const { data } = await supabase
      .from("calls")
      .select("*")
      .eq("id", ourCallId)
      .maybeSingle();
    if (data) return data;
  }

  // 2) Fallback: provider call id mapped to call_sid (only if given)
  if (providerCallId) {
    const { data: bySid } = await supabase
      .from("calls")
      .select("*")
      .eq("call_sid", providerCallId)
      .maybeSingle();
    return bySid || null;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch next queued call for a dataset (non-recursive)
// Called after a call reaches a terminal state to advance the queue.
// ─────────────────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function dispatchNextCall(supabase: any, datasetId: string) {
  const SUBVERSE_API_KEY = Deno.env.get("SUBVERSE_API_KEY");
  if (!SUBVERSE_API_KEY) {
    console.error("[Dispatch] No SUBVERSE_API_KEY configured");
    return;
  }

  const { data: claimed, error } = await supabase.rpc("claim_next_queued_call", {
    p_dataset_id: datasetId,
  });

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
          call_id: call.id, // <-- CRITICAL: our UUID for correlation
          dataset_id: datasetId,
          reg_no: call.reg_no,
          driver_name: call.driver_name,
          driver_phone: call.phone_number,
          attempt: call.attempt,
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
      result.data?.callId || result.data?.call_id || result.callId || null;

    // NOTE:
    // We keep "ringing" until webhook says call.placed / call.initiated.
    // But some teams still set active here; leaving as "active" can be OK too
    // as claim_next_queued_call blocks on ringing/active.
    await supabase
      .from("calls")
      .update({ status: "ringing", call_sid: callSid })
      .eq("id", call.id);

    console.log(`[Dispatch] Call ${call.id} ringing, sid: ${callSid}`);
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

    // Do NOT recurse here — let the next poll/webhook handle it
  }
}

// ── Check if all calls in dataset are terminal → auto-close dataset ──
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

// ─────────────────────────────────────────────────────────────────────────────
// Main webhook handler
// ─────────────────────────────────────────────────────────────────────────────

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
    const providerStatus = extractProviderStatus(payload);

    const ourCallId = extractOurCallId(payload);
    const providerCallId = extractProviderCallId(payload);

    // Some Subverse payloads include "Call In Queue" in status fields while
    // emitting a generic/non-actionable eventType. Force in-progress handling.
    const routedEventType =
      providerStatus === "call.in_queue" ? "call.in_queue" : eventType;

    console.log(
      `[Webhook] Received ${eventType} (routed=${routedEventType}, providerStatus=${providerStatus}) ourCallId=${ourCallId} providerCallId=${providerCallId}`
    );

    if (!ourCallId) {
      // If Subverse webhook doesn’t include our metadata, we can’t safely correlate.
      return new Response(
        JSON.stringify({
          success: true,
          message: "Missing metadata.call_id; ignoring",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const call = await findCall(supabase, ourCallId, providerCallId);
    if (!call) {
      console.error(
        `[Webhook] Call not found in DB: ourCallId=${ourCallId} providerCallId=${providerCallId}`
      );
      return new Response(
        JSON.stringify({ success: true, message: "Call not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotency: terminal calls never change
    if (TERMINAL_STATUSES.has(call.status)) {
      console.log(
        `[Webhook] Call ${call.id} already terminal (${call.status}). Skipping ${routedEventType}.`
      );
      return new Response(
        JSON.stringify({ success: true, message: "Already terminal" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── In-progress events ──
    if (IN_PROGRESS_EVENTS.has(routedEventType)) {
      // ✅ CRITICAL:
      // If provider says "call.in_queue", DO NOT change DB to "queued".
      // Keep it "ringing" so claim_next_queued_call blocks new dispatch.
      const nextStatus =
        routedEventType === "call.placed" || routedEventType === "call.initiated"
          ? "active"
          : "ringing";

      await supabase
        .from("calls")
        .update({
          status: nextStatus,
          started_at: call.started_at || new Date().toISOString(),
          // keep call_sid if we have it
          call_sid: call.call_sid || providerCallId || call.call_sid,
        })
        .eq("id", call.id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Success ──
    if (routedEventType === "call.completed") {
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

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Retryable failure ──
    if (RETRYABLE_EVENTS.has(routedEventType)) {
      const currentAttempt = call.attempt || 1;
      const maxAttempts = call.max_attempts || 1;
      const retryMinutes = call.retry_after_minutes || 2;

      if (currentAttempt < maxAttempts) {
        const retryAt = new Date(
          Date.now() + retryMinutes * 60 * 1000
        ).toISOString();
        const nextAttempt = currentAttempt + 1;

        console.log(
          `[Webhook] Scheduling retry for ${call.id} attempt ${nextAttempt}/${maxAttempts} at ${retryAt}`
        );

        await supabase
          .from("calls")
          .update({
            status: "queued",
            attempt: nextAttempt,
            retry_at: retryAt,
            error_message: `Retry scheduled: ${routedEventType}`,
            completed_at: null,
            started_at: null,
            // Keep call_sid as-is; we correlate by metadata.call_id anyway
          })
          .eq("id", call.id);

        // ✅ DO NOT dispatch next immediately here.
        // Dataset is sequential and this call is pending (delayed retry).
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Permanent failure
      await supabase
        .from("calls")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: `Provider event: ${routedEventType} (after ${currentAttempt} attempts)`,
        })
        .eq("id", call.id);

      await supabase.rpc("increment_dataset_counts", {
        p_dataset_id: call.dataset_id,
        p_successful: 0,
        p_failed: 1,
      });

      await dispatchNextCall(supabase, call.dataset_id);
      await checkDatasetCompletion(supabase, call.dataset_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Canceled ──
    if (routedEventType === "call.canceled") {
      await supabase
        .from("calls")
        .update({
          status: "canceled",
          completed_at: new Date().toISOString(),
          error_message: `Provider event: ${routedEventType}`,
        })
        .eq("id", call.id);

      await supabase.rpc("increment_dataset_counts", {
        p_dataset_id: call.dataset_id,
        p_successful: 0,
        p_failed: 1,
      });

      await dispatchNextCall(supabase, call.dataset_id);
      await checkDatasetCompletion(supabase, call.dataset_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(
      `[Webhook] Unhandled event type: ${routedEventType} for call ${call.id}`
    );

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error(
      "[Webhook Error]",
      error instanceof Error ? error.message : error
    );
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
