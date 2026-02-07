import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Standard webhook payload structure
interface SubverseWebhookPayload {
  event?: string;
  eventType?: string;
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
  chunk?: string;
  segment?: string;
  metadata?: {
    call_id?: string;
    dataset_id?: string;
    driver_name?: string;
    reg_no?: string;
  };
  // Workflow event structure
  data?: {
    node?: {
      type?: string;
      output?: {
        call_id?: string;
        call_status?: string;
        call_duration?: number;
        transcript?: string;
        call_recording_url?: string;
        analysis?: string;
        customer_number?: string;
        customer_details?: {
          regNo?: string;
        };
      };
    };
    workflowExecutionId?: string;
  };
}

interface SubverseCallDetails {
  transcript?: string;
  refinedTranscript?: string;
  recordingUrl?: string;
  duration?: number;
  status?: string;
}

/**
 * Extract event type from payload (handles both formats)
 */
function extractEventType(payload: SubverseWebhookPayload): string {
  return (payload.event || payload.eventType || "").toLowerCase();
}

/**
 * Extract call identifier from payload with fallbacks
 */
function extractCallId(payload: SubverseWebhookPayload): string | null {
  // Check workflow output first
  if (payload.data?.node?.output?.call_id) {
    return payload.data.node.output.call_id;
  }
  
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
  // Check workflow output first
  if (payload.data?.node?.output?.call_id) {
    return payload.data.node.output.call_id;
  }
  return payload.callId || payload.callSid || payload.call_id || null;
}

/**
 * Extract refined transcript with fallbacks
 */
function extractRefinedTranscript(payload: SubverseWebhookPayload): string | null {
  // Check workflow output
  if (payload.data?.node?.output?.transcript) {
    return payload.data.node.output.transcript;
  }
  return payload.refinedTranscript || payload.refined_transcript || payload.transcript || null;
}

/**
 * Extract recording URL with fallbacks
 */
function extractRecordingUrl(payload: SubverseWebhookPayload): string | null {
  // Check workflow output
  if (payload.data?.node?.output?.call_recording_url) {
    return payload.data.node.output.call_recording_url;
  }
  return payload.recordingUrl || payload.recording_url || null;
}

/**
 * Extract call duration with fallbacks
 */
function extractDuration(payload: SubverseWebhookPayload): number | null {
  if (payload.data?.node?.output?.call_duration) {
    return payload.data.node.output.call_duration;
  }
  return payload.duration || null;
}

/**
 * Extract call status with fallbacks
 */
function extractCallStatus(payload: SubverseWebhookPayload): string | null {
  if (payload.data?.node?.output?.call_status) {
    return payload.data.node.output.call_status;
  }
  return payload.status || null;
}

/**
 * Extract transcript chunk for live streaming
 */
function extractTranscriptChunk(payload: SubverseWebhookPayload): string | null {
  return payload.chunk || payload.segment || payload.transcript || null;
}

/**
 * Extract reg_no from workflow payload
 */
function extractRegNo(payload: SubverseWebhookPayload): string | null {
  if (payload.data?.node?.output?.customer_details?.regNo) {
    return payload.data.node.output.customer_details.regNo;
  }
  return payload.metadata?.reg_no || null;
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
      recordingUrl: data.recordingUrl || data.recording_url || data.call_recording_url,
      duration: data.duration || data.call_duration,
      status: data.status || data.call_status,
    };
  } catch (error) {
    console.error(`[Webhook] Error fetching from Subverse API:`, error);
    return null;
  }
}

/**
 * Find call by ID - attempts match on internal id, call_sid, or reg_no
 */
async function findCall(
  supabase: ReturnType<typeof createClient>,
  callId: string,
  regNo?: string | null
): Promise<{ id: string; dataset_id: string; status: string; call_sid: string | null; live_transcript: string | null } | null> {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  // Try by UUID id first
  if (uuidRegex.test(callId)) {
    const { data: callById } = await supabase
      .from("calls")
      .select("id, dataset_id, status, call_sid, live_transcript")
      .eq("id", callId)
      .single();
    
    if (callById) return callById;
  }
  
  // Try by call_sid
  const { data: callBySid } = await supabase
    .from("calls")
    .select("id, dataset_id, status, call_sid, live_transcript")
    .eq("call_sid", callId)
    .single();
  
  if (callBySid) return callBySid;

  // Fallback: Try by reg_no if provided (for workflow events that don't have our call_id)
  if (regNo) {
    console.log(`[Webhook] Attempting to find call by reg_no: ${regNo}`);
    const { data: callByReg } = await supabase
      .from("calls")
      .select("id, dataset_id, status, call_sid, live_transcript")
      .eq("reg_no", regNo)
      .in("status", ["queued", "ringing", "active"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    
    if (callByReg) {
      console.log(`[Webhook] Found call by reg_no: ${callByReg.id}`);
      return callByReg;
    }
  }
  
  return null;
}

/**
 * Map Subverse status to our internal status
 */
function mapSubverseStatus(subverseStatus: string): string {
  const statusMap: Record<string, string> = {
    "ringing": "ringing",
    "in_progress": "active",
    "in-progress": "active",
    "active": "active",
    "connected": "active",
    "completed": "completed",
    "ended": "completed",
    "call_finished": "completed",
    "failed": "failed",
    "no_answer": "failed",
    "busy": "failed",
    "canceled": "failed",
    "could_not_connect": "failed",
  };
  
  return statusMap[subverseStatus.toLowerCase()] || subverseStatus;
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
    const eventType = extractEventType(payload);
    console.log("[Webhook] Received event:", eventType, "payload:", JSON.stringify(payload));

    const callId = extractCallId(payload);
    const subverseCallId = extractSubverseCallId(payload);
    const regNo = extractRegNo(payload);
    const callStatus = extractCallStatus(payload);

    // Handle workflow events that may not have our call_id
    if (!callId && !regNo) {
      console.log("[Webhook] No call identifier or reg_no found, acknowledging workflow event");
      return new Response(
        JSON.stringify({ success: true, message: "Workflow event acknowledged" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const call = await findCall(supabase, callId || "", regNo);
    
    if (!call) {
      console.log(`[Webhook] Call not found for id: ${callId}, reg_no: ${regNo}`);
      return new Response(
        JSON.stringify({ success: true, message: "Call not found, event acknowledged" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resolvedDatasetId = payload.metadata?.dataset_id || call.dataset_id;

    // Store call_sid if we matched by reg_no and don't have it yet
    if (!call.call_sid && subverseCallId) {
      await supabase
        .from("calls")
        .update({ call_sid: subverseCallId })
        .eq("id", call.id);
    }

    // ========== Handle Live Transcript Events ==========
    if (eventType === "call.transcript" || eventType === "call.partial_transcript" || eventType === "call.segment") {
      const chunk = extractTranscriptChunk(payload);
      if (chunk) {
        console.log(`[Webhook] Appending transcript chunk to call ${call.id}`);
        const currentTranscript = call.live_transcript || "";
        await supabase
          .from("calls")
          .update({ 
            live_transcript: currentTranscript + (currentTranscript ? " " : "") + chunk 
          })
          .eq("id", call.id);
      }
      return new Response(
        JSON.stringify({ success: true, event: eventType, callId: call.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========== Handle Status Evolution Events ==========
    if (eventType === "call.ringing" || eventType === "call.initiated") {
      if (call.status === "queued") {
        console.log(`[Webhook] Call ${call.id} now ringing`);
        await supabase
          .from("calls")
          .update({ status: "ringing", started_at: new Date().toISOString() })
          .eq("id", call.id);
      }
      return new Response(
        JSON.stringify({ success: true, event: eventType, callId: call.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (eventType === "call.in_progress" || eventType === "call.connected" || eventType === "call.answered") {
      if (["queued", "ringing"].includes(call.status)) {
        console.log(`[Webhook] Call ${call.id} now active`);
        await supabase
          .from("calls")
          .update({ status: "active", started_at: call.started_at || new Date().toISOString() })
          .eq("id", call.id);
      }
      return new Response(
        JSON.stringify({ success: true, event: eventType, callId: call.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========== Handle Workflow Node Execution (contains call result) ==========
    if (eventType === "workflow.node_execution" && payload.data?.node?.type === "voiceAgentNode") {
      const output = payload.data.node.output;
      if (!output) {
        return new Response(
          JSON.stringify({ success: true, message: "No output in workflow node" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const status = output.call_status ? mapSubverseStatus(output.call_status) : null;
      
      // Skip if already in terminal status (idempotent)
      if (["completed", "failed", "canceled"].includes(call.status)) {
        console.log(`[Webhook] Call ${call.id} already terminal: ${call.status}, skipping`);
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: "already_terminal" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[Webhook] Processing workflow node for call ${call.id}, status: ${status}`);

      const updateData: Record<string, unknown> = {
        completed_at: new Date().toISOString(),
      };

      if (status) {
        updateData.status = status;
      }

      if (output.call_duration) {
        updateData.call_duration = output.call_duration;
      }

      if (output.call_recording_url) {
        updateData.recording_url = output.call_recording_url;
      }

      if (output.transcript) {
        updateData.refined_transcript = output.transcript;
      }

      if (output.call_id && !call.call_sid) {
        updateData.call_sid = output.call_id;
      }

      // If completed but no transcript, try to fetch from API
      if (status === "completed" && !output.transcript && output.call_id) {
        console.log(`[Webhook] No transcript in workflow output, fetching from API...`);
        const details = await fetchSubverseCallDetails(output.call_id);
        if (details?.refinedTranscript) {
          updateData.refined_transcript = details.refinedTranscript;
        }
        if (details?.recordingUrl && !updateData.recording_url) {
          updateData.recording_url = details.recordingUrl;
        }
      }

      await supabase
        .from("calls")
        .update(updateData)
        .eq("id", call.id);

      // Update dataset counts
      if (status === "completed") {
        await supabase.rpc("increment_dataset_counts", {
          p_dataset_id: resolvedDatasetId,
          p_successful: 1,
          p_failed: 0,
        });
      } else if (status === "failed") {
        await supabase.rpc("increment_dataset_counts", {
          p_dataset_id: resolvedDatasetId,
          p_successful: 0,
          p_failed: 1,
        });
      }

      await checkAndUpdateDatasetCompletion(supabase, resolvedDatasetId);

      return new Response(
        JSON.stringify({ success: true, event: eventType, callId: call.id, status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========== Handle Terminal Events (legacy format) ==========
    if (eventType === "call.completed" || eventType === "call.ended" || eventType === "call_finished") {
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

      const duration = extractDuration(payload);
      if (duration) {
        updateData.call_duration = duration;
      }

      let recordingUrl = extractRecordingUrl(payload);
      let refinedTranscript = extractRefinedTranscript(payload);

      // FALLBACK: If no transcript in payload, fetch from Subverse API
      if (!refinedTranscript && subverseCallId) {
        console.log(`[Webhook] No transcript in payload, fetching from Subverse API...`);
        const details = await fetchSubverseCallDetails(subverseCallId);
        
        if (details) {
          refinedTranscript = details.refinedTranscript || details.transcript || null;
          recordingUrl = recordingUrl || details.recordingUrl || null;
          
          if (details.duration && !duration) {
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

      await supabase.rpc("increment_dataset_counts", {
        p_dataset_id: resolvedDatasetId,
        p_successful: 1,
        p_failed: 0,
      });

      await checkAndUpdateDatasetCompletion(supabase, resolvedDatasetId);
    }

    // ========== Handle Failure Events ==========
    if (eventType === "call.failed" || eventType === "call.no_answer" || eventType === "call.busy" || eventType === "call.canceled") {
      if (["completed", "failed", "canceled"].includes(call.status)) {
        console.log(`[Webhook] Call ${call.id} already terminal: ${call.status}, skipping`);
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: "already_terminal" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[Webhook] Call ${call.id} failed: ${eventType}`);
      
      const failureReason = eventType.replace("call.", "").replace("_", " ") || "unknown";
      
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
      JSON.stringify({ success: true, event: eventType, callId: call.id }),
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
