
-- Fix RLS on calls table
DROP POLICY IF EXISTS "Allow all access to calls" ON public.calls;

CREATE POLICY "authenticated_users_full_access_calls" ON public.calls
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Fix RLS on datasets table
DROP POLICY IF EXISTS "Allow all access to datasets" ON public.datasets;

CREATE POLICY "authenticated_users_full_access_datasets" ON public.datasets
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Service role (used by edge functions) bypasses RLS automatically
