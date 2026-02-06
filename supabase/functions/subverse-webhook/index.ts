import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// All possible event types from Subverse
const TRANSCRIPT_EVENTS = [
  "call.transcript",
  "call.transcript.partial",
  "transcript.partial",
  "transcript",
];

const COMPLETION_EVENTS = [
  "call.completed",
  "call.ended",
  "call_finished",
];

const FAILURE_EVENTS = [
  "call.failed",
  "call.no_answer",
  "call.busy",
  "call.canceled",
];

const TERMINAL_STATUSES = ["completed", "failed", "canceled"];

interface SubverseWebhookPayload {
  event: string;
  callId?: string;
  callSid?: string;
  call_id?: string;
  status?: string;
  duration?: number;
  recordingUrl?: string;
  recording_url?: string;
  transcript?: string;
  text?: string;
  content?: string;
  refinedTranscript?: string;
  refined_transcript?: string;
  data?: {
    transcript?: string;
    text?: string;
    content?: string;
  };
  metadata?: {
    call_id?: string;
    dataset_id?: string;
    driver_name?: string;
    reg_no?: string;
  };
}

/**
 * Extract call identifier from payload with fallbacks
 * Priority: metadata.call_id > callId > callSid > call_id
 */
function extractCallId(payload: SubverseWebhookPayload): string | null {
  return (
    payload.metadata?.call_id ||
    payload.callId ||
    payload.callSid ||
    payload.call_id ||
    null
  );
}

/**
 * Extract transcript text from various payload shapes
 */
function extractTranscript(payload: SubverseWebhookPayload): string | null {
  // Direct fields first
  if (payload.transcript) return payload.transcript;
  if (payload.text) return payload.text;
  if (payload.content) return payload.content;
  
  // Nested in data object
  if (payload.data) {
    if (payload.data.transcript) return payload.data.transcript;
    if (payload.data.text) return payload.data.text;
    if (payload.data.content) return payload.data.content;
  }
  
  return null;
}

/**
 * Extract refined transcript with fallbacks
 */
function extractRefinedTranscript(payload: SubverseWebhookPayload): string | null {
  return payload.refinedTranscript || payload.refined_transcript || null;
}

/**
 * Extract recording URL with fallbacks
 */
function extractRecordingUrl(payload: SubverseWebhookPayload): string | null {
  return payload.recordingUrl || payload.recording_url || null;
}

/**
 * Find call by ID - attempts match on internal id first, then call_sid
 */
async function findCall(
  supabase: ReturnType<typeof createClient>,
  callId: string
): Promise<{ id: string; dataset_id: string; status: string } | null> {
  // Try matching internal UUID first (if it looks like a UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (uuidRegex.test(callId)) {
    const { data: callById } = await supabase
      .from("calls")
      .select("id, dataset_id, status")
      .eq("id", callId)
      .single();
    
    if (callById) return callById;
  }
  
  // Fallback to matching on call_sid (Subverse's external ID)
  const { data: callBySid } = await supabase
    .from("calls")
    .select("id, dataset_id, status")
    .eq("call_sid", callId)
    .single();
  
  return callBySid || null;
}

/**
 * Check if all calls for a dataset are in terminal status and update dataset accordingly
 */
async function checkAndUpdateDatasetCompletion(
  supabase: ReturnType<typeof createClient>,
  datasetId: string
): Promise<void> {
  const { data: remaining } = await supabase
    .from("calls")
    .select("id")
    .eq("dataset_id", datasetId)
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`);

  if (!remaining || remaining.length === 0) {
    console.log(`[Webhook] All calls complete for dataset ${datasetId}`);
    await supabase
      .from("datasets")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", datasetId);
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: SubverseWebhookPayload = await req.json();
    console.log("[Webhook] Received event:", payload.event, "payload:", JSON.stringify(payload));

    // Extract call identifier with fallbacks
    const callId = extractCallId(payload);
    const datasetId = payload.metadata?.dataset_id;

    if (!callId) {
      console.error("[Webhook] No call identifier found in payload");
      return new Response(
        JSON.stringify({ error: "Missing call identifier" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find the call in database
    const call = await findCall(supabase, callId);
    
    if (!call) {
      console.error(`[Webhook] Call not found for id: ${callId}`);
      return new Response(
        JSON.stringify({ error: "Call not found", callId }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const eventType = payload.event?.toLowerCase() || "";
    const resolvedDatasetId = datasetId || call.dataset_id;

    // Handle transcript events (including partials)
    if (TRANSCRIPT_EVENTS.some(e => eventType.includes(e.replace("call.", "")))) {
      const transcript = extractTranscript(payload);
      
      if (transcript) {
        console.log(`[Webhook] Updating live_transcript for call ${call.id}`);
        
        // For partial transcripts, we could append, but Subverse typically sends cumulative
        // So we update with the latest transcript
        await supabase
          .from("calls")
          .update({ 
            live_transcript: transcript,
            status: "active" // Ensure status reflects active call
          })
          .eq("id", call.id);
      }
    }

    // Handle call ringing/answered events
    if (eventType === "call.ringing") {
      console.log(`[Webhook] Call ${call.id} is ringing`);
      await supabase
        .from("calls")
        .update({ status: "ringing" })
        .eq("id", call.id);
    }

    if (eventType === "call.answered" || eventType === "call.active") {
      console.log(`[Webhook] Call ${call.id} is active`);
      await supabase
        .from("calls")
        .update({ status: "active" })
        .eq("id", call.id);
    }

    // Handle completion events (idempotent - don't regress terminal status)
    if (COMPLETION_EVENTS.some(e => eventType.includes(e.replace("call.", "")))) {
      // Only update if not already in terminal status
      if (!TERMINAL_STATUSES.includes(call.status)) {
        console.log(`[Webhook] Call ${call.id} completed`);
        
        const updateData: Record<string, unknown> = {
          status: "completed",
          completed_at: new Date().toISOString(),
        };

        if (payload.duration) {
          updateData.call_duration = payload.duration;
        }

        const recordingUrl = extractRecordingUrl(payload);
        if (recordingUrl) {
          updateData.recording_url = recordingUrl;
        }

        const refinedTranscript = extractRefinedTranscript(payload);
        const rawTranscript = extractTranscript(payload);
        
        if (refinedTranscript) {
          updateData.refined_transcript = refinedTranscript;
        } else if (rawTranscript) {
          updateData.refined_transcript = rawTranscript;
        }

        await supabase
          .from("calls")
          .update(updateData)
          .eq("id", call.id);

        // Increment successful count (only on transition to completed)
        await supabase.rpc("increment_dataset_counts", {
          p_dataset_id: resolvedDatasetId,
          p_successful: 1,
          p_failed: 0,
        });

        // Check if dataset is complete
        await checkAndUpdateDatasetCompletion(supabase, resolvedDatasetId);
      } else {
        console.log(`[Webhook] Call ${call.id} already in terminal status: ${call.status}, skipping`);
      }
    }

    // Handle failure events (idempotent)
    if (FAILURE_EVENTS.some(e => eventType.includes(e.replace("call.", "")))) {
      // Only update if not already in terminal status
      if (!TERMINAL_STATUSES.includes(call.status)) {
        console.log(`[Webhook] Call ${call.id} failed with event: ${payload.event}`);
        
        const failureReason = payload.event?.replace("call.", "").replace("_", " ") || "unknown";
        
        await supabase
          .from("calls")
          .update({
            status: "failed",
            error_message: `Call ${failureReason}`,
            completed_at: new Date().toISOString(),
          })
          .eq("id", call.id);

        // Increment failed count (only on transition to failed)
        await supabase.rpc("increment_dataset_counts", {
          p_dataset_id: resolvedDatasetId,
          p_successful: 0,
          p_failed: 1,
        });

        // Check if dataset is complete
        await checkAndUpdateDatasetCompletion(supabase, resolvedDatasetId);
      } else {
        console.log(`[Webhook] Call ${call.id} already in terminal status: ${call.status}, skipping`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, event: payload.event, callId: call.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Webhook] Error processing webhook:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
