import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SubverseWebhookPayload {
  event: string;
  callId: string;
  callSid?: string;
  status?: string;
  duration?: number;
  recordingUrl?: string;
  transcript?: string;
  refinedTranscript?: string;
  metadata?: {
    call_id?: string;
    dataset_id?: string;
    driver_name?: string;
    reg_no?: string;
  };
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
    console.log("[Webhook] Received payload:", JSON.stringify(payload));

    // Extract the internal call_id from metadata
    const callId = payload.metadata?.call_id;
    const datasetId = payload.metadata?.dataset_id;

    if (!callId) {
      console.error("[Webhook] No call_id in metadata");
      return new Response(
        JSON.stringify({ error: "Missing call_id in metadata" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle different event types
    switch (payload.event) {
      case "call.ringing":
        console.log(`[Webhook] Call ${callId} is ringing`);
        await supabase
          .from("calls")
          .update({ status: "ringing" })
          .eq("id", callId);
        break;

      case "call.answered":
      case "call.active":
        console.log(`[Webhook] Call ${callId} is active`);
        await supabase
          .from("calls")
          .update({ status: "active" })
          .eq("id", callId);
        break;

      case "call.transcript":
        // Live transcript update during the call
        if (payload.transcript) {
          console.log(`[Webhook] Call ${callId} transcript update`);
          await supabase
            .from("calls")
            .update({ live_transcript: payload.transcript })
            .eq("id", callId);
        }
        break;

      case "call.completed":
      case "call.ended":
        console.log(`[Webhook] Call ${callId} completed`);
        
        // Update call with final data
        const updateData: Record<string, unknown> = {
          status: "completed",
          completed_at: new Date().toISOString(),
        };

        if (payload.duration) {
          updateData.call_duration = payload.duration;
        }

        if (payload.recordingUrl) {
          updateData.recording_url = payload.recordingUrl;
        }

        if (payload.refinedTranscript) {
          updateData.refined_transcript = payload.refinedTranscript;
        } else if (payload.transcript) {
          updateData.refined_transcript = payload.transcript;
        }

        await supabase
          .from("calls")
          .update(updateData)
          .eq("id", callId);

        // Increment successful count in dataset
        if (datasetId) {
          await supabase.rpc("increment_dataset_counts", {
            p_dataset_id: datasetId,
            p_successful: 1,
            p_failed: 0,
          });

          // Check if all calls are complete and update dataset status
          const { data: remaining } = await supabase
            .from("calls")
            .select("id")
            .eq("dataset_id", datasetId)
            .in("status", ["queued", "ringing", "active"]);

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
        break;

      case "call.failed":
      case "call.no_answer":
      case "call.busy":
        console.log(`[Webhook] Call ${callId} failed with event: ${payload.event}`);
        
        await supabase
          .from("calls")
          .update({
            status: "failed",
            error_message: `Call ${payload.event.replace("call.", "")}`,
            completed_at: new Date().toISOString(),
          })
          .eq("id", callId);

        // Increment failed count in dataset
        if (datasetId) {
          await supabase.rpc("increment_dataset_counts", {
            p_dataset_id: datasetId,
            p_successful: 0,
            p_failed: 1,
          });

          // Check if all calls are complete
          const { data: remaining } = await supabase
            .from("calls")
            .select("id")
            .eq("dataset_id", datasetId)
            .in("status", ["queued", "ringing", "active"]);

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
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${payload.event}`);
    }

    return new Response(
      JSON.stringify({ success: true, event: payload.event }),
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
