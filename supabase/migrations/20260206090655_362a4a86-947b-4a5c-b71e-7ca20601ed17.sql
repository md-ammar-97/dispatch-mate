-- Add message column to calls table for custom dispatch messages
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS message text;