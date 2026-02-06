-- Create function to increment dataset counts atomically
CREATE OR REPLACE FUNCTION public.increment_dataset_counts(
  p_dataset_id UUID,
  p_successful INTEGER DEFAULT 0,
  p_failed INTEGER DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.datasets
  SET 
    successful_calls = successful_calls + p_successful,
    failed_calls = failed_calls + p_failed
  WHERE id = p_dataset_id;
END;
$$;