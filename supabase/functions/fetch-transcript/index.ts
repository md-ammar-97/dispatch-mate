import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface FetchTranscriptRequest {
  call_id: string;
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
    "canceled": "canceled",
  };
  return statusMap[subverseStatus.toLowerCase()] || subverseStatus;
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUBVERSE_API_KEY = Deno.env.get("SUBVERSE_API_KEY");
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    const bodyText = await req.text();
    if (bodyText.length > 10000) {
      return new Response(
        JSON.stringify({ error: "Payload too large" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { call_id }: FetchTranscriptRequest = JSON.parse(bodyText);
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!call_id || typeof call_id !== "string" || !uuidRegex.test(call_id)) {
      return new Response(
        JSON.stringify({ error: "call_id is required and must be a valid UUID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: call, error: callError } = await supabase
      .from("calls")
      .select("id, call_sid, refined_transcript, recording_url, status")
      .eq("id", call_id)
      .single();

    if (callError || !call) {
      return new Response(
        JSON.stringify({ error: "Call not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (call.refined_transcript) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          transcript: call.refined_transcript,
          recording_url: call.recording_url,
          source: "database"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!call.call_sid) {
      return new Response(
        JSON.stringify({ error: "No Subverse call ID available" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!SUBVERSE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "SUBVERSE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[FetchTranscript] Fetching from Subverse for call_sid: ${call.call_sid}`);
    
    const response = await fetch(
      `https://api.subverseai.com/api/call/details/${call.call_sid}`,
      {
        method: "GET",
        headers: {
          "x-api-key": SUBVERSE_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error(`[FetchTranscript] Subverse API error: ${response.status}`);
      return new Response(
        JSON.stringify({ error: `Subverse API error: ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    console.log(`[FetchTranscript] Subverse response:`, JSON.stringify(data));

    const transcript = data.refinedTranscript || data.refined_transcript || data.transcript || null;
    const recordingUrl = data.recordingUrl || data.recording_url || data.call_recording_url || null;
    const duration = data.duration || data.call_duration || null;
    
    const subverseStatus = data.status || data.call_status || null;
    const mappedStatus = subverseStatus ? mapSubverseStatus(subverseStatus) : null;

    const updateData: Record<string, unknown> = {};
    if (transcript) updateData.refined_transcript = transcript;
    if (recordingUrl) updateData.recording_url = recordingUrl;
    if (duration) updateData.call_duration = duration;
    
    if (mappedStatus && mappedStatus !== call.status) {
        updateData.status = mappedStatus;
        if (["completed", "failed", "canceled"].includes(mappedStatus)) {
            updateData.completed_at = new Date().toISOString();
        }
    }

    if (Object.keys(updateData).length > 0) {
      await supabase
        .from("calls")
        .update(updateData)
        .eq("id", call_id);
      
      console.log(`[FetchTranscript] Updated call ${call_id} with fetched data`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        transcript,
        recording_url: recordingUrl,
        duration,
        source: "subverse_api"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[FetchTranscript] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
