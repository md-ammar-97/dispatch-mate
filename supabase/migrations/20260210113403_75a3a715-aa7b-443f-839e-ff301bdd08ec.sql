-- Add client_timestamp column to calls table
ALTER TABLE public.calls ADD COLUMN client_timestamp TIMESTAMP WITH TIME ZONE;