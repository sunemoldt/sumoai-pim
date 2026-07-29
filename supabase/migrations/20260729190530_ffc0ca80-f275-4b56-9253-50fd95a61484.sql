
DROP POLICY IF EXISTS restock_signups_authenticated_all ON public.restock_signups;

CREATE POLICY "restock_signups_owner_only"
ON public.restock_signups
FOR ALL
TO authenticated
USING (lower(coalesce(auth.jwt() ->> 'email', '')) = 'mail@sunemoldt.dk')
WITH CHECK (lower(coalesce(auth.jwt() ->> 'email', '')) = 'mail@sunemoldt.dk');

REVOKE ALL ON public.restock_signups FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restock_signups TO authenticated;
GRANT ALL ON public.restock_signups TO service_role;
