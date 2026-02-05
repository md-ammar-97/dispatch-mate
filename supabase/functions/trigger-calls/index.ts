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
 const MAX_CONCURRENT = 10;
 
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
 
     // Process calls in batches with delay
     let successCount = 0;
     let failCount = 0;
 
     for (let i = 0; i < calls.length; i++) {
       const call = calls[i] as CallRecord;
 
       try {
         // Update status to ringing
         await supabase
           .from("calls")
           .update({ status: "ringing", started_at: new Date().toISOString() })
           .eq("id", call.id);
 
         // Trigger Subverse call
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
               driver_name: call.driver_name,
               reg_no: call.reg_no,
             },
           }),
         });
 
         if (!response.ok) {
           const errorText = await response.text();
           throw new Error(`Subverse API error: ${response.status} - ${errorText}`);
         }
 
         const result = await response.json();
 
         // Update call with active status and call_sid
         await supabase
           .from("calls")
           .update({
             status: "active",
             call_sid: result.callSid || result.call_id || null,
           })
           .eq("id", call.id);
 
         successCount++;
 
         // Simulate call completion after delay (for demo purposes)
         // In production, this would be handled by webhooks
         setTimeout(async () => {
           await supabase
             .from("calls")
             .update({
               status: "completed",
               completed_at: new Date().toISOString(),
               live_transcript: `Hello ${call.driver_name}, this is an automated dispatch call. Your registration number ${call.reg_no} has been confirmed for today's route. Please proceed to the dispatch point. Thank you.`,
               call_duration: Math.floor(Math.random() * 60) + 15,
             })
             .eq("id", call.id);
 
           // Update dataset counts
           await supabase.rpc("increment_dataset_counts", {
             p_dataset_id: dataset_id,
             p_successful: 1,
             p_failed: 0,
           });
         }, 5000 + Math.random() * 5000);
 
       } catch (error) {
         console.error(`Error processing call ${call.id}:`, error);
 
         // Update call as failed
         await supabase
           .from("calls")
           .update({
             status: "failed",
             error_message: error instanceof Error ? error.message : "Unknown error",
             completed_at: new Date().toISOString(),
           })
           .eq("id", call.id);
 
         failCount++;
       }
 
       // Delay between calls (except for last call)
       if (i < calls.length - 1) {
         await new Promise((resolve) => setTimeout(resolve, CALL_DELAY_MS));
       }
     }
 
     // Mark dataset as completed if all calls processed
     setTimeout(async () => {
       await supabase
         .from("datasets")
         .update({
           status: "completed",
           completed_at: new Date().toISOString(),
           successful_calls: successCount,
           failed_calls: failCount,
         })
         .eq("id", dataset_id);
     }, 15000);
 
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