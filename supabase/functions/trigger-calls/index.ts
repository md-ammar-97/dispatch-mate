import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CallRecord {
  id: string;
  driver_name: string;
  phone_number: string;
  reg_no: string;
  status: string;
}

const SUBVERSE_API_URL = "https://api.subverseai.com/api/call/trigger";
const CALL_DELAY_MS = 2000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUBVERSE_API_KEY = Deno.env.get("SUBVERSE_API_KEY");
    if (!SUBVERSE_API_KEY) {
      throw new Error("SUBVERSE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { dataset_id } = await req.json();

    if (!dataset_id) {
      return new Response(
        JSON.stringify({ error: "dataset_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch all queued calls for this dataset
    const { data: calls, error: fetchError } = await supabase
      .from("calls")
      .select("*")
      .eq("dataset_id", dataset_id)
      .eq("status", "queued")
      .order("created_at", { ascending: true });

    if (fetchError) throw fetchError;

    if (!calls || calls.length === 0) {
      return new Response(
        JSON.stringify({ message: "No queued calls found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Process calls sequentially with delay
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i] as CallRecord;

      try {
        // Update status to ringing BEFORE making the API call
        await supabase
          .from("calls")
          .update({ status: "ringing", started_at: new Date().toISOString() })
          .eq("id", call.id);

        console.log(`[Call ${call.id}] Status set to ringing, triggering Subverse API...`);

        // Trigger Subverse call with proper metadata mapping
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
              dataset_id: dataset_id,
              driver_name: call.driver_name,
              reg_no: call.reg_no,
              message: `Hello ${call.driver_name}, this is an automated dispatch call. Your vehicle registration number ${call.reg_no} has been confirmed for today's route. Please proceed to the dispatch point.`,
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Subverse API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log(`[Call ${call.id}] Subverse response:`, JSON.stringify(result));

        // Update call with active status and store the Subverse callId
        const subverseCallId = result.callId || result.callSid || result.call_id || null;
        
        await supabase
          .from("calls")
          .update({
            status: "active",
            call_sid: subverseCallId,
          })
          .eq("id", call.id);

        console.log(`[Call ${call.id}] Status set to active, call_sid: ${subverseCallId}`);
        successCount++;

      } catch (error) {
        console.error(`[Call ${call.id}] Error:`, error);

        // Update call as failed
        await supabase
          .from("calls")
          .update({
            status: "failed",
            error_message: error instanceof Error ? error.message : "Unknown error",
            completed_at: new Date().toISOString(),
          })
          .eq("id", call.id);

        // Increment failed count in dataset
        await supabase.rpc("increment_dataset_counts", {
          p_dataset_id: dataset_id,
          p_successful: 0,
          p_failed: 1,
        });

        failCount++;
      }

      // Delay between calls to respect concurrency limits (except for last call)
      if (i < calls.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, CALL_DELAY_MS));
      }
    }

    console.log(`[Dataset ${dataset_id}] Batch trigger complete. Success: ${successCount}, Failed: ${failCount}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processing ${calls.length} calls`,
        initiated: successCount,
        failed: failCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in trigger-calls:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
