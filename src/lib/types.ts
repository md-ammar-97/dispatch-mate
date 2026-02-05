 // Database types
 export interface Dataset {
   id: string;
   name: string;
   status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed';
   total_calls: number;
   successful_calls: number;
   failed_calls: number;
   created_at: string;
   approved_at: string | null;
   completed_at: string | null;
 }
 
 export interface Call {
   id: string;
   dataset_id: string;
   driver_name: string;
   phone_number: string;
   reg_no: string;
   status: 'queued' | 'ringing' | 'active' | 'completed' | 'failed';
   live_transcript: string;
   refined_transcript: string | null;
   recording_url: string | null;
   call_sid: string | null;
   call_duration: number | null;
   error_message: string | null;
   created_at: string;
   started_at: string | null;
   completed_at: string | null;
 }
 
 export interface CSVRow {
   driver_name: string;
   phone_number: string;
   reg_no: string;
 }
 
 export interface ValidationError {
   row: number;
   field: string;
   message: string;
 }