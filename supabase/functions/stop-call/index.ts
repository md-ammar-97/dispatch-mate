import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { call_id } = await req.json();
    const SUBVERSE_API_KEY = Deno.env.get("SUBVERSE_API_KEY");
    
    // Create Supabase client
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    
    // Get call details
    const { data: call, error } = await supabase.from("calls").select("call_sid").eq("id", call_id).single();

    if (error || !call) {
        throw new Error("Call not found in database");
    }

    // 1. Try to cancel on Subverse IF we have a call_sid
    if (call.call_sid) {
        try {
            console.log(`[Stop Call] Attempting to cancel Subverse call: ${call.call_sid}`);
            // Use the correct endpoint for direct call cancellation
            const response = await fetch(`https://api.subverseai.com/api/direct-call/cancel`, {
              method: "PUT",
              headers: {
                "x-api-key": SUBVERSE_API_KEY!,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ callId: call.call_sid })
            });
            
            if (!response.ok) {
                const errText = await response.text();
                console.warn(`[Stop Call] Subverse API Cancel Warning: ${errText}`);
            } else {
                console.log(`[Stop Call] Subverse call cancelled successfully.`);
            }
        } catch (err) {
            console.error("[Stop Call] Network Error contacting Subverse:", err);
        }
    } else {
        console.warn("[Stop Call] No Subverse Call ID found. Forcing local status update only.");
    }

    // 2. Always force update DB status to 'failed' (or 'canceled') to stop UI spinner
    // This ensures the platform "stops running" even if the API call failed
    const { error: updateError } = await supabase
        .from("calls")
        .update({ 
            status: 'failed', 
            error_message: 'Emergency Stop by User',
            completed_at: new Date().toISOString()
        })
        .eq("id", call_id);

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (error) {
    console.error("[Stop Call] Fatal Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
