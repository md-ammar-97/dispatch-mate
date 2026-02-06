import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
  refinedTranscript?: string;
  refined_transcript?: string;
  metadata?: {
    call_id?: string;
    dataset_id?: string;
    driver_name?: string;
    reg_no?: string;
  };
}

/**
 * Extract call identifier from payload with fallbacks
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
 * Extract refined transcript with fallbacks
 */
function extractRefinedTranscript(payload: SubverseWebhookPayload): string | null {
  return payload.refinedTranscript || payload.refined_transcript || payload.transcript || null;
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
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (uuidRegex.test(callId)) {
    const { data: callById } = await supabase
      .from("calls")
      .select("id, dataset_id, status")
      .eq("id", callId)
      .single();
    
    if (callById) return callById;
  }
  
  const { data: callBySid } = await supabase
    .from("calls")
    .select("id, dataset_id, status")
    .eq("call_sid", callId)
    .single();
  
  return callBySid || null;
}

/**
 * Check if all calls for a dataset are terminal and update dataset accordingly
 */
async function checkAndUpdateDatasetCompletion(
  supabase: ReturnType<typeof createClient>,
  datasetId: string
): Promise<void> {
  const { data: remaining } = await supabase
    .from("calls")
    .select("id")
    .eq("dataset_id", datasetId)
    .not("status", "in", "(completed,failed,canceled)");

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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const callId = extractCallId(payload);
    const datasetId = payload.metadata?.dataset_id;

    if (!callId) {
      console.error("[Webhook] No call identifier found in payload");
      return new Response(
        JSON.stringify({ error: "Missing call identifier" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Only process call.completed events for post-call review model
    if (eventType === "call.completed" || eventType === "call.ended" || eventType === "call_finished") {
      // Skip if already in terminal status (idempotent)
      if (["completed", "failed", "canceled"].includes(call.status)) {
        console.log(`[Webhook] Call ${call.id} already terminal: ${call.status}, skipping`);
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: "already_terminal" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[Webhook] Call ${call.id} completed - updating refined_transcript`);
      
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
      if (refinedTranscript) {
        updateData.refined_transcript = refinedTranscript;
      }

      await supabase
        .from("calls")
        .update(updateData)
        .eq("id", call.id);

      // Increment successful count
      await supabase.rpc("increment_dataset_counts", {
        p_dataset_id: resolvedDatasetId,
        p_successful: 1,
        p_failed: 0,
      });

      await checkAndUpdateDatasetCompletion(supabase, resolvedDatasetId);
    }

    // Handle failure events
    if (eventType === "call.failed" || eventType === "call.no_answer" || eventType === "call.busy" || eventType === "call.canceled") {
      if (["completed", "failed", "canceled"].includes(call.status)) {
        console.log(`[Webhook] Call ${call.id} already terminal: ${call.status}, skipping`);
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: "already_terminal" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[Webhook] Call ${call.id} failed: ${payload.event}`);
      
      const failureReason = payload.event?.replace("call.", "").replace("_", " ") || "unknown";
      
      await supabase
        .from("calls")
        .update({
          status: "failed",
          error_message: `Call ${failureReason}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", call.id);

      await supabase.rpc("increment_dataset_counts", {
        p_dataset_id: resolvedDatasetId,
        p_successful: 0,
        p_failed: 1,
      });

      await checkAndUpdateDatasetCompletion(supabase, resolvedDatasetId);
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
