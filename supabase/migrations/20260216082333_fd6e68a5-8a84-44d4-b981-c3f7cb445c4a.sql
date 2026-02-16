
-- Add retry columns to calls table
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS retry_after_minutes integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS retry_at timestamp with time zone;

-- Create atomic claim function for sequential dispatch
-- Concurrency guard: only dispatches if no call is ringing/active for the dataset
-- Atomic: uses FOR UPDATE SKIP LOCKED to prevent race conditions
CREATE OR REPLACE FUNCTION public.claim_next_queued_call(p_dataset_id uuid)
RETURNS SETOF public.calls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_active_count int;
BEGIN
  -- Concurrency guard: block dispatch if any call is already ringing or active
  SELECT count(*) INTO v_active_count
  FROM calls
  WHERE dataset_id = p_dataset_id
    AND status IN ('ringing', 'active');

  IF v_active_count > 0 THEN
    RETURN; -- empty result set, caller should not place a new call
  END IF;

  -- Atomic claim: pick the oldest queued call that is eligible (retry_at respected)
  RETURN QUERY
  UPDATE calls
  SET status = 'ringing', started_at = now(), retry_at = NULL
  WHERE id = (
    SELECT c.id FROM calls c
    WHERE c.dataset_id = p_dataset_id
      AND c.status = 'queued'
      AND (c.retry_at IS NULL OR c.retry_at <= now())
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- Restrict claim function to service-role only (edge functions)
REVOKE EXECUTE ON FUNCTION public.claim_next_queued_call(uuid) FROM public, anon, authenticated;
