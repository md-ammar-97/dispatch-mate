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
  message: string | null;
  status: string;
}

const SUBVERSE_API_URL = "https://api.subverseai.com/api/call/trigger";
const CALL_DELAY_MS = 2000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Authentication Check ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // --- End Authentication Check ---

    const SUBVERSE_API_KEY = Deno.env.get("SUBVERSE_API_KEY");
    if (!SUBVERSE_API_KEY) {
      throw new Error("SUBVERSE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.text();
    if (body.length > 10000) {
      return new Response(
        JSON.stringify({ error: "Payload too large" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { dataset_id } = JSON.parse(body);

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!dataset_id || typeof dataset_id !== "string" || !uuidRegex.test(dataset_id)) {
      return new Response(
        JSON.stringify({ error: "dataset_id is required and must be a valid UUID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Trigger] Starting batch for dataset ${dataset_id}`);

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

    console.log(`[Trigger] Found ${calls.length} queued calls`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i] as CallRecord;

      try {
        await supabase
          .from("calls")
          .update({ 
            status: "ringing", 
            started_at: new Date().toISOString() 
          })
          .eq("id", call.id);

        console.log(`[Call ${call.id}] Status set to ringing`);

        const subversePayload = {
          phoneNumber: call.phone_number,
          agentName: "sample_test_9",
          metadata: {
            call_id: call.id,
            dataset_id: dataset_id,
            driver_name: call.driver_name,
            driver_phone: call.phone_number,
            reg_no: call.reg_no,
            message: call.message || `Hello ${call.driver_name}, your vehicle ${call.reg_no} is ready for dispatch.`,
          },
        };

        const response = await fetch(SUBVERSE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": SUBVERSE_API_KEY,
          },
          body: JSON.stringify(subversePayload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Subverse API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log(`[Call ${call.id}] Subverse response:`, JSON.stringify(result));

        const subverseCallId = result.data?.callId || result.data?.call_id || result.callId || result.callSid || result.call_id || null;
        
        if (!subverseCallId) {
            console.warn(`[Call ${call.id}] Warning: Could not extract Subverse Call ID.`);
        }

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

        await supabase
          .from("calls")
          .update({
            status: "failed",
            error_message: error instanceof Error ? error.message : "Unknown error",
            completed_at: new Date().toISOString(),
          })
          .eq("id", call.id);

        await supabase.rpc("increment_dataset_counts", {
          p_dataset_id: dataset_id,
          p_successful: 0,
          p_failed: 1,
        });

        failCount++;
      }

      if (i < calls.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, CALL_DELAY_MS));
      }
    }

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
    console.error("[Trigger] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
