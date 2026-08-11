-- Owner-only access helper (single-tenant system)
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', '')) = 'mail@sunemoldt.dk'
$$;

REVOKE EXECUTE ON FUNCTION public.is_owner() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated, service_role;

-- Tighten every permissive "authenticated = true" policy to the owner account only.
DO $do$
DECLARE
  r record;
  has_qual boolean;
  has_check boolean;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles::text[] @> ARRAY['authenticated']
      AND NOT (roles::text[] @> ARRAY['service_role'])
      AND (qual = 'true' OR with_check = 'true')
  LOOP
    has_qual := r.qual IS NOT NULL;
    has_check := r.with_check IS NOT NULL;
    IF has_qual AND has_check THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (public.is_owner()) WITH CHECK (public.is_owner())',
                     r.policyname, r.schemaname, r.tablename);
    ELSIF has_qual THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (public.is_owner())',
                     r.policyname, r.schemaname, r.tablename);
    ELSIF has_check THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (public.is_owner())',
                     r.policyname, r.schemaname, r.tablename);
    END IF;
  END LOOP;
END
$do$;