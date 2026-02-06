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

interface SubverseCallDetails {
  transcript?: string;
  refinedTranscript?: string;
  recordingUrl?: string;
  duration?: number;
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
 * Extract the Subverse call ID for API fetching (callId or callSid)
 */
function extractSubverseCallId(payload: SubverseWebhookPayload): string | null {
  return payload.callId || payload.callSid || payload.call_id || null;
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
 * Fetch call details from Subverse API as fallback
 */
async function fetchSubverseCallDetails(subverseCallId: string): Promise<SubverseCallDetails | null> {
  const SUBVERSE_API_KEY = Deno.env.get("SUBVERSE_API_KEY");
  if (!SUBVERSE_API_KEY) {
    console.error("[Webhook] SUBVERSE_API_KEY not configured for fallback fetch");
    return null;
  }

  try {
    console.log(`[Webhook] Fetching call details from Subverse for: ${subverseCallId}`);
    
    const response = await fetch(
      `https://api.subverseai.com/api/call/details/${subverseCallId}`,
      {
        method: "GET",
        headers: {
          "x-api-key": SUBVERSE_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error(`[Webhook] Subverse API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[Webhook] Subverse API response:`, JSON.stringify(data));

    return {
      transcript: data.transcript || data.refinedTranscript || data.refined_transcript,
      refinedTranscript: data.refinedTranscript || data.refined_transcript || data.transcript,
      recordingUrl: data.recordingUrl || data.recording_url,
      duration: data.duration || data.call_duration,
    };
  } catch (error) {
    console.error(`[Webhook] Error fetching from Subverse API:`, error);
    return null;
  }
}

/**
 * Find call by ID - attempts match on internal id first, then call_sid
 */
async function findCall(
  supabase: ReturnType<typeof createClient>,
  callId: string
): Promise<{ id: string; dataset_id: string; status: string; call_sid: string | null } | null> {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (uuidRegex.test(callId)) {
    const { data: callById } = await supabase
      .from("calls")
      .select("id, dataset_id, status, call_sid")
      .eq("id", callId)
      .single();
    
    if (callById) return callById;
  }
  
  const { data: callBySid } = await supabase
    .from("calls")
    .select("id, dataset_id, status, call_sid")
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
    const subverseCallId = extractSubverseCallId(payload);
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

    // Only process terminal events for post-call review model
    if (eventType === "call.completed" || eventType === "call.ended" || eventType === "call_finished") {
      // Skip if already in terminal status (idempotent)
      if (["completed", "failed", "canceled"].includes(call.status)) {
        console.log(`[Webhook] Call ${call.id} already terminal: ${call.status}, skipping`);
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: "already_terminal" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[Webhook] Call ${call.id} completed - processing transcript`);
      
      const updateData: Record<string, unknown> = {
        status: "completed",
        completed_at: new Date().toISOString(),
      };

      if (payload.duration) {
        updateData.call_duration = payload.duration;
      }

      // Try to extract from payload first
      let recordingUrl = extractRecordingUrl(payload);
      let refinedTranscript = extractRefinedTranscript(payload);

      // FALLBACK: If no transcript in payload, fetch from Subverse API
      if (!refinedTranscript && subverseCallId) {
        console.log(`[Webhook] No transcript in payload, fetching from Subverse API...`);
        const details = await fetchSubverseCallDetails(subverseCallId);
        
        if (details) {
          refinedTranscript = details.refinedTranscript || details.transcript || null;
          recordingUrl = recordingUrl || details.recordingUrl || null;
          
          if (details.duration && !payload.duration) {
            updateData.call_duration = details.duration;
          }
        }
      }

      if (recordingUrl) {
        updateData.recording_url = recordingUrl;
      }

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
