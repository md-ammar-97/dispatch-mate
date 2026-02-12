import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    const { call_id } = await req.json();
    const SUBVERSE_API_KEY = Deno.env.get("SUBVERSE_API_KEY");
    
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    
    const { data: call, error } = await supabase.from("calls").select("call_sid").eq("id", call_id).single();

    if (error || !call) {
        throw new Error("Call not found in database");
    }

    if (call.call_sid) {
        try {
            console.log(`[Stop Call] Attempting to cancel Subverse call: ${call.call_sid}`);
            
            const response = await fetch(`https://api.subverseai.com/api/call/cancel/${call.call_sid}`, {
              method: "PUT",
              headers: {
                "x-api-key": SUBVERSE_API_KEY!,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({})
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

    const { error: updateError } = await supabase
        .from("calls")
        .update({ 
            status: 'failed', 
            error_message: 'Stopped by System (Timeout)',
            completed_at: new Date().toISOString()
        })
        .eq("id", call_id);

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    console.error("[Stop Call] Fatal Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
