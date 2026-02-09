// supabase/functions/stop-call/index.ts
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
    
    // 1. Get the Subverse Call SID from your DB
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: call } = await supabase.from("calls").select("call_sid").eq("id", call_id).single();

    if (!call?.call_sid) throw new Error("No active Subverse Call ID found");

    // 2. Hit Subverse API to Cancel
    // Note: Verify the endpoint in docs. Usually /api/direct-call/cancel or /api/call/{id}/stop
    const response = await fetch(`https://api.subverseai.com/api/direct-call/cancel`, {
      method: "PUT", // Check docs: Cancel is often PUT
      headers: {
        "x-api-key": SUBVERSE_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ callId: call.call_sid })
    });

    if (!response.ok) {
        const err = await response.text();
        console.error("Subverse Stop Failed:", err);
    }

    // 3. Force update DB status immediately (don't wait for webhook)
    await supabase.from("calls").update({ status: 'canceled' }).eq("id", call_id);

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
