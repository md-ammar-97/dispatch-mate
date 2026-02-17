
-- Add user_id column to datasets
ALTER TABLE public.datasets ADD COLUMN user_id UUID REFERENCES auth.users(id);

-- Drop old overly permissive policies
DROP POLICY IF EXISTS "authenticated_users_full_access_datasets" ON public.datasets;
DROP POLICY IF EXISTS "authenticated_users_full_access_calls" ON public.calls;

-- Datasets: owner-only access for authenticated users
CREATE POLICY "users_own_datasets" ON public.datasets
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Calls: access via dataset ownership
CREATE POLICY "users_own_calls" ON public.calls
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.datasets
      WHERE datasets.id = calls.dataset_id
      AND datasets.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.datasets
      WHERE datasets.id = calls.dataset_id
      AND datasets.user_id = auth.uid()
    )
  );
