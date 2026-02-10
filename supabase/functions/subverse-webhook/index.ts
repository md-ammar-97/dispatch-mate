import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Updated payload structure based on observed API behavior
interface SubverseWebhookPayload {
  eventType?: string;
  event?: string;
  createdAt?: string;
  data?: {
    callId?: string;
    customerNumber?: string;
    duration?: number;
    recordingURL?: string; // Observed camelCase from API
    analysis?: {
      summary?: string;
      user_sentiment?: string;
      task_completion?: boolean;
    };
    transcript?: Array<Record<string, string>>; // Observed array of objects
    // Workflow structure support
    node?: {
      output?: {
        call_id?: string;
        call_status?: string;
        transcript?: any;
        call_recording_url?: string;
        analysis?: string;
      };
    };
  };
  metadata?: {
    call_id?: string;
    dataset_id?: string;
    reg_no?: string;
  };
}

/**
 * Helper to turn Subverse transcript array into readable string
 */
function formatTranscript(transcriptData: any): string | null {
  if (!transcriptData) return null;
  if (typeof transcriptData === "string") return transcriptData;
  
  if (Array.isArray(transcriptData)) {
    return transcriptData
      .map((entry) => {
        const role = Object.keys(entry)[0];
        const text = entry[role];
        return `${role.charAt(0).toUpperCase() + role.slice(1)}: ${text}`;
      })
      .join("\n");
  }
  return null;
}

function extractEventType(payload: SubverseWebhookPayload): string {
  return (payload.eventType || payload.event || "").toLowerCase();
}

function extractCallId(payload: SubverseWebhookPayload): string | null {
  return (
    payload.data?.callId || 
    payload.data?.node?.output?.call_id || 
    payload.metadata?.call_id || 
    null
  );
}

function extractAnalysis(payload: SubverseWebhookPayload): string | null {
  if (payload.data?.analysis?.summary) return payload.data.analysis.summary;
  if (payload.data?.node?.output?.analysis) return payload.data.node.output.analysis;
  return null;
}

async function findCall(supabase: any, callId: string, regNo?: string | null) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  // 1. Try internal UUID
  if (uuidRegex.test(callId)) {
    const { data } = await supabase.from("calls").select("*").eq("id", callId).single();
    if (data) return data;
  }
  
  // 2. Try call_sid (Subverse callId)
  const { data: bySid } = await supabase.from("calls").select("*").eq("call_sid", callId).single();
  if (bySid) return bySid;

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
      return new Response(JSON.stringify({ success: true, message: "No callId" }), { headers: corsHeaders });
    }

    const call = await findCall(supabase, callId);
    if (!call) {
      console.error(`[Webhook] Call not found in DB: ${callId}`);
      return new Response(JSON.stringify({ success: true, message: "Call not found" }), { headers: corsHeaders });
    }

    // ========== 1. STATUS EVOLUTION ==========
    if (eventType === "call.in_queue") {
      await supabase.from("calls").update({ status: "queued" }).eq("id", call.id);
    } 
    
    else if (eventType === "call.placed" || eventType === "call.initiated") {
      await supabase.from("calls").update({ 
        status: "active", 
        started_at: call.started_at || new Date().toISOString() 
      }).eq("id", call.id);
    }

    // ========== 2. TERMINAL COMPLETION ==========
    else if (eventType === "call.completed") {
      const transcriptStr = formatTranscript(payload.data?.transcript || payload.data?.node?.output?.transcript);
      const recordingUrl = payload.data?.recordingURL || payload.data?.node?.output?.call_recording_url;
      const summary = extractAnalysis(payload);

      await supabase.from("calls").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        refined_transcript: transcriptStr || call.refined_transcript,
        recording_url: recordingUrl || call.recording_url,
        call_duration: payload.data?.duration || call.call_duration
        // If your schema has a 'summary' column, add it here:
        // summary: summary 
      }).eq("id", call.id);

      // Update Dataset Progress
      await supabase.rpc("increment_dataset_counts", { 
        p_dataset_id: call.dataset_id, 
        p_successful: 1, 
        p_failed: 0 
      });
      
      // Auto-close dataset if all calls terminal
      const { data: remaining } = await supabase
        .from("calls")
        .select("id")
        .eq("dataset_id", call.dataset_id)
        .not("status", "in", "('completed','failed','canceled')");

      if (!remaining || remaining.length === 0) {
        await supabase.from("datasets")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", call.dataset_id);
      }
    }

    // ========== 3. FAILURE HANDLING ==========
    else if (["call.failed", "call.no_answer", "call.busy"].includes(eventType)) {
      await supabase.from("calls").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: `Provider event: ${eventType}`
      }).eq("id", call.id);

      await supabase.rpc("increment_dataset_counts", { 
        p_dataset_id: call.dataset_id, 
        p_successful: 0, 
        p_failed: 1 
      });
    }

    return new Response(JSON.stringify({ success: true }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (error: unknown) {
    console.error("[Webhook Error]", error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
