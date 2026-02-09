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
  data?: {
    node?: {
      type?: string;
      output?: {
        call_id?: string;
        call_status?: string;
        call_duration?: number;
        transcript?: string;
        call_recording_url?: string;
        analysis?: string; // AI Summary usually appears here
        summary?: string;
        customer_number?: string;
        customer_details?: {
          regNo?: string;
        };
      };
    };
    workflowExecutionId?: string;
    analysis?: string; // Fallback location
  };
}

interface SubverseCallDetails {
  transcript?: string;
  refinedTranscript?: string;
  recordingUrl?: string;
  duration?: number;
  status?: string;
  summary?: string; // Added summary to details interface
}

function extractEventType(payload: SubverseWebhookPayload): string {
  return (payload.event || payload.eventType || "").toLowerCase();
}

function extractCallId(payload: SubverseWebhookPayload): string | null {
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

function extractSubverseCallId(payload: SubverseWebhookPayload): string | null {
  if (payload.data?.node?.output?.call_id) {
    return payload.data.node.output.call_id;
  }
  return payload.callId || payload.callSid || payload.call_id || null;
}

function extractRefinedTranscript(payload: SubverseWebhookPayload): string | null {
  if (payload.data?.node?.output?.transcript) {
    return payload.data.node.output.transcript;
  }
  return payload.refinedTranscript || payload.refined_transcript || payload.transcript || null;
}

function extractRecordingUrl(payload: SubverseWebhookPayload): string | null {
  if (payload.data?.node?.output?.call_recording_url) {
    return payload.data.node.output.call_recording_url;
  }
  return payload.recordingUrl || payload.recording_url || null;
}

function extractDuration(payload: SubverseWebhookPayload): number | null {
  if (payload.data?.node?.output?.call_duration) {
    return payload.data.node.output.call_duration;
  }
  return payload.duration || null;
}

function extractCallStatus(payload: SubverseWebhookPayload): string | null {
  if (payload.data?.node?.output?.call_status) {
    return payload.data.node.output.call_status;
  }
  return payload.status || null;
}

function extractTranscriptChunk(payload: SubverseWebhookPayload): string | null {
  return payload.chunk || payload.segment || payload.transcript || null;
}

function extractRegNo(payload: SubverseWebhookPayload): string | null {
  if (payload.data?.node?.output?.customer_details?.regNo) {
    return payload.data.node.output.customer_details.regNo;
  }
  return payload.metadata?.reg_no || null;
}

// NEW: Extract Analysis/Summary
function extractAnalysis(payload: SubverseWebhookPayload): string | null {
  if (payload.data?.node?.output?.analysis) {
    return payload.data.node.output.analysis;
  }
  if (payload.data?.node?.output?.summary) {
    return payload.data.node.output.summary;
  }
  return payload.data?.analysis || null;
}

async function fetchSubverseCallDetails(subverseCallId: string): Promise<SubverseCallDetails | null> {
  const SUBVERSE_API_KEY = Deno.env.get("SUBVERSE_API_KEY");
  if (!SUBVERSE_API_KEY) return null;

  try {
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

    if (!response.ok) return null;

    const data = await response.json();
    return {
      transcript: data.transcript || data.refinedTranscript || data.refined_transcript,
      refinedTranscript: data.refinedTranscript || data.refined_transcript || data.transcript,
      recordingUrl: data.recordingUrl || data.recording_url || data.call_recording_url,
      duration: data.duration || data.call_duration,
      status: data.status || data.call_status,
      summary: data.analysis || data.summary || data.call_analysis, // Capture summary from fetch
    };
  } catch (error) {
    console.error(`[Webhook] API Fetch error:`, error);
    return null;
  }
}

async function findCall(
  supabase: any,
  callId: string,
  regNo?: string | null
) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (uuidRegex.test(callId)) {
    const { data } = await supabase.from("calls").select("*").eq("id", callId).single();
    if (data) return data;
  }
  
  const { data: bySid } = await supabase.from("calls").select("*").eq("call_sid", callId).single();
  if (bySid) return bySid;

  if (regNo) {
    const { data: byReg } = await supabase
      .from("calls")
      .select("*")
      .eq("reg_no", regNo)
      .in("status", ["queued", "ringing", "active"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (byReg) return byReg;
  }
  return null;
}

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
  };
  return statusMap[subverseStatus.toLowerCase()] || subverseStatus;
}

async function checkAndUpdateDatasetCompletion(supabase: any, datasetId: string) {
  const { data: remaining } = await supabase
    .from("calls")
    .select("id")
    .eq("dataset_id", datasetId)
    .not("status", "in", "('completed','failed','canceled')");

  if (!remaining || remaining.length === 0) {
    await supabase.from("datasets")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", datasetId);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const payload: SubverseWebhookPayload = await req.json();
    const eventType = extractEventType(payload);
    
    // DEBUG LOGGING: This will help you see exactly what Subverse sends
    console.log(`[Webhook Event Received]: ${eventType}`, JSON.stringify(payload).substring(0, 500));

    const callId = extractCallId(payload);
    const subverseCallId = extractSubverseCallId(payload);
    const regNo = extractRegNo(payload);

    if (!callId && !regNo) {
      return new Response(JSON.stringify({ success: true, message: "Acknowledge workflow" }), { headers: corsHeaders });
    }

    const call = await findCall(supabase, callId || "", regNo);
    if (!call) return new Response(JSON.stringify({ success: true, message: "Call not found" }), { headers: corsHeaders });

    // Prevent updates to already terminal calls
    if (["completed", "failed", "canceled"].includes(call.status) && !["call.transcript", "call.segment"].includes(eventType)) {
       return new Response(JSON.stringify({ success: true, message: "Call already terminal" }), { headers: corsHeaders });
    }

    const resolvedDatasetId = payload.metadata?.dataset_id || call.dataset_id;

    // Update Subverse ID if missing
    if (!call.call_sid && subverseCallId) {
      await supabase.from("calls").update({ call_sid: subverseCallId }).eq("id", call.id);
    }

    // ========== 1. LIVE TRANSCRIPT EVENTS ==========
    if (["call.transcript", "call.partial_transcript", "call.segment"].includes(eventType)) {
      const chunk = extractTranscriptChunk(payload);
      if (chunk) {
        const current = call.live_transcript || "";
        await supabase.from("calls")
          .update({ live_transcript: current + (current ? " " : "") + chunk })
          .eq("id", call.id);
      }
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    // ========== 2. STATUS EVOLUTION ==========
    if (["call.ringing", "call.initiated"].includes(eventType)) {
      await supabase.from("calls").update({ status: "ringing", started_at: new Date().toISOString() }).eq("id", call.id);
    }

    if (["call.in_progress", "call.connected", "call.answered"].includes(eventType)) {
      await supabase.from("calls").update({ status: "active", started_at: call.started_at || new Date().toISOString() }).eq("id", call.id);
    }

    // ========== 3. TERMINAL EVENTS & WORKFLOW RESULTS ==========
    const isTerminal = ["call.completed", "call.ended", "call_finished", "call.failed", "call.canceled"].includes(eventType) || 
                       (eventType === "workflow.node_execution" && payload.data?.node?.type === "voiceAgentNode");

    if (isTerminal) {
      const subStatus = extractCallStatus(payload) || (eventType.includes("failed") ? "failed" : "completed");
      const mappedStatus = mapSubverseStatus(subStatus);
      
      const updateData: any = {
        status: mappedStatus,
        completed_at: new Date().toISOString(),
        call_duration: extractDuration(payload),
        recording_url: extractRecordingUrl(payload),
        refined_transcript: extractRefinedTranscript(payload),
        summary: extractAnalysis(payload) // Capture summary here
      };

      // Fallback Fetch
      if (mappedStatus === "completed" && (!updateData.refined_transcript || !updateData.summary) && subverseCallId) {
        const details = await fetchSubverseCallDetails(subverseCallId);
        if (details) {
          updateData.refined_transcript = updateData.refined_transcript || details.refinedTranscript;
          updateData.recording_url = updateData.recording_url || details.recordingUrl;
          updateData.summary = updateData.summary || details.summary; // Fallback summary
        }
      }

      await supabase.from("calls").update(updateData).eq("id", call.id);

      // RPC Counts
      const rpcParams = mappedStatus === "completed" 
        ? { p_dataset_id: resolvedDatasetId, p_successful: 1, p_failed: 0 }
        : { p_dataset_id: resolvedDatasetId, p_successful: 0, p_failed: 1 };
      
      await supabase.rpc("increment_dataset_counts", rpcParams);
      await checkAndUpdateDatasetCompletion(supabase, resolvedDatasetId);
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (error) {
    // Better Error Logging
    console.error(`[Webhook Error]: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
