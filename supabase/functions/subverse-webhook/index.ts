import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// No CORS headers - this is a server-to-server webhook endpoint

// ── Terminal statuses (never change after reaching these) ──
const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "canceled",
  "expired",
  "errored",
]);

// ── In-progress events ──
const IN_QUEUE_EVENTS = new Set(["call.in_queue"]);
const RINGING_EVENTS = new Set(["call.placed"]);
const ACTIVE_EVENTS = new Set(["call.initiated"]);

// Retryable failures (kept for future-proofing, but Subverse currently
// does NOT send these — failure is detected via backstop timeout instead)
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
    status?: string;
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
        call_status?: string;
        transcript?: unknown;
        call_recording_url?: string;
        analysis?: string;
      };
    };
  };
  metadata?: {
    call_id?: string;
    dataset_id?: string;
    reg_no?: string;
    attempt?: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeProviderStatus(status: string | null | undefined): string | null {
  if (!status) return null;

  const normalized = status
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (["call_in_queue", "in_queue", "queued"].includes(normalized)) return "call.in_queue";
  if (["placed", "call_placed"].includes(normalized)) return "call.placed";
  if (["initiated", "call_initiated", "connected"].includes(normalized)) return "call.initiated";

  return normalized;
}

function formatTranscript(transcriptData: unknown): string | null {
  if (!transcriptData) return null;
  if (typeof transcriptData === "string") return transcriptData;

  if (Array.isArray(transcriptData)) {
    return transcriptData
      .map((entry) => {
        const role = Object.keys(entry)[0];
        const text = (entry as Record<string, string>)[role];
        return `${role.charAt(0).toUpperCase() + role.slice(1)}: ${text}`;
      })
      .join("\n");
  }
  return null;
}

function extractEventType(payload: SubverseWebhookPayload): string {
  return (payload.eventType || payload.event || "").toLowerCase();
}

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

// Find call by:
// 1) our UUID (metadata.call_id) if present
// 2) provider callId (data.callId) mapped to calls.call_sid
// deno-lint-ignore no-explicit-any
async function findCall(
  supabase: any,
  ourCallId: string | null,
  providerCallId: string | null
): Promise<{ call: any; matchedBy: string | null }> {
  const uuidRegex = /^[0-9a-f-]{36}$/i;

  // 1) Our UUID (best)
  if (ourCallId && uuidRegex.test(ourCallId)) {
    const { data } = await supabase
      .from("calls")
      .select("*")
      .eq("id", ourCallId)
      .maybeSingle();
    if (data) return { call: data, matchedBy: "id" };
  }

  // 2) Provider callId -> call_sid (critical fallback for payloads without metadata)
  if (providerCallId) {
    const { data: bySid } = await supabase
      .from("calls")
      .select("*")
      .eq("call_sid", providerCallId)
      .maybeSingle();
    if (bySid) return { call: bySid, matchedBy: "call_sid" };
  }

  return { call: null, matchedBy: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch next queued call for a dataset
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
        agentNumber: "+919228055503",
        agentName: "sample_test_9",
        metadata: {
          call_id: call.id,
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
  }
}

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
const jsonHeaders = { "Content-Type": "application/json" };

serve(async (req) => {
  // Reject browser preflight — this is a server-to-server endpoint
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 405 });
  }

  // Reject requests with an Origin header (browsers only)
  if (req.headers.get("origin")) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: jsonHeaders,
    });
  }

  try {
    // ── Webhook Authentication ──
    const WEBHOOK_SECRET = Deno.env.get("SUBVERSE_WEBHOOK_SECRET");
    if (WEBHOOK_SECRET) {
      const providedSecret =
        req.headers.get("SUBVERSE_WEBHOOK_SECRET") ||
        req.headers.get("x-webhook-secret") ||
        req.headers.get("x-subverse-secret") ||
        new URL(req.url).searchParams.get("secret");

      if (providedSecret !== WEBHOOK_SECRET) {
        console.warn("[Webhook] Invalid or missing webhook secret");
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: jsonHeaders,
        });
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const payload: SubverseWebhookPayload = await req.json();

    const eventType = extractEventType(payload);
    const providerStatus = extractProviderStatus(payload);

    const ourCallId = extractOurCallId(payload);
    const providerCallId = extractProviderCallId(payload);

    // Route in_queue safely even if eventType is generic
    const routedEventType =
      providerStatus === "call.in_queue" ? "call.in_queue" : eventType;

    console.log(
      `[Webhook] Received ${eventType} (routed=${routedEventType}, providerStatus=${providerStatus}) ourCallId=${ourCallId} providerCallId=${providerCallId}`
    );

    // If both identifiers are missing, nothing we can do
    if (!ourCallId && !providerCallId) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Missing both metadata.call_id and data.callId; ignoring",
        }),
        { headers: jsonHeaders }
      );
    }

    const { call, matchedBy } = await findCall(supabase, ourCallId, providerCallId);

    if (!call) {
      console.error(
        `[Webhook] Call not found in DB: ourCallId=${ourCallId} providerCallId=${providerCallId}`
      );
      return new Response(JSON.stringify({ success: true, message: "Call not found" }), {
        headers: jsonHeaders,
      });
    }

    // If we matched by id but call_sid is missing, store providerCallId
    if (providerCallId && !call.call_sid) {
      await supabase.from("calls").update({ call_sid: providerCallId }).eq("id", call.id);
    }

    // Idempotency: never regress from terminal status
    if (TERMINAL_STATUSES.has(call.status)) {
      console.log(
        `[Webhook] Call ${call.id} already terminal (${call.status}). Skipping ${routedEventType}. matchedBy=${matchedBy}`
      );
      return new Response(JSON.stringify({ success: true, message: "Already terminal" }), {
        headers: jsonHeaders,
      });
    }

    // ── In progress events ──
    if (
      IN_QUEUE_EVENTS.has(routedEventType) ||
      RINGING_EVENTS.has(routedEventType) ||
      ACTIVE_EVENTS.has(routedEventType)
    ) {
      const nextStatus = ACTIVE_EVENTS.has(routedEventType) ? "active" : "ringing";

      await supabase
        .from("calls")
        .update({
          status: nextStatus,
          started_at: call.started_at || new Date().toISOString(),
          call_sid: call.call_sid || providerCallId || null,
        })
        .eq("id", call.id);

      return new Response(JSON.stringify({ success: true, matchedBy }), {
        headers: jsonHeaders,
      });
    }

    // ── Success: call.completed ──
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

      return new Response(JSON.stringify({ success: true, matchedBy }), {
        headers: jsonHeaders,
      });
    }

    // ── Retryable failure events (future-proofing; Subverse currently
    //    does not send these for unanswered calls) ──
    if (RETRYABLE_EVENTS.has(routedEventType)) {
      const currentAttempt = call.attempt || 1;
      const maxAttempts = call.max_attempts || 1;
      const retryMinutes = call.retry_after_minutes || 2;

      if (currentAttempt < maxAttempts) {
        const retryAt = new Date(Date.now() + retryMinutes * 60 * 1000).toISOString();
        const nextAttempt = currentAttempt + 1;

        await supabase
          .from("calls")
          .update({
            status: "queued",
            attempt: nextAttempt,
            retry_at: retryAt,
            error_message: `Retry scheduled: ${routedEventType}`,
            completed_at: null,
            started_at: null,
            call_sid: null,
          })
          .eq("id", call.id);

        return new Response(JSON.stringify({ success: true, matchedBy }), {
          headers: jsonHeaders,
        });
      }

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

      return new Response(JSON.stringify({ success: true, matchedBy }), {
        headers: jsonHeaders,
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

      return new Response(JSON.stringify({ success: true, matchedBy }), {
        headers: jsonHeaders,
      });
    }

    console.log(`[Webhook] Unhandled event type: ${routedEventType} for call ${call.id}`);
    return new Response(JSON.stringify({ success: true, matchedBy }), {
      headers: jsonHeaders,
    });
  } catch (error: unknown) {
    console.error("[Webhook Error]", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: jsonHeaders }
    );
  }
});
