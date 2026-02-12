-- Revoke execute permission on increment_dataset_counts from all non-service-role callers
-- This prevents authenticated users from calling it directly via RPC
REVOKE EXECUTE ON FUNCTION public.increment_dataset_counts(uuid, integer, integer) FROM public, anon, authenticated;
