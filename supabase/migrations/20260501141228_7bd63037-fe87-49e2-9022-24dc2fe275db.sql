-- 1. Tilføj is_active kolonne
ALTER TABLE public.shopify_connection
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;

-- 2. Sikr at højst én forbindelse er aktiv ad gangen
CREATE UNIQUE INDEX IF NOT EXISTS shopify_connection_only_one_active
  ON public.shopify_connection (is_active)
  WHERE is_active = true;

-- 3. Markér den nyest installerede som aktiv så systemet ikke bryder
UPDATE public.shopify_connection
   SET is_active = true
 WHERE id = (
   SELECT id FROM public.shopify_connection
   ORDER BY installed_at DESC
   LIMIT 1
 )
 AND NOT EXISTS (SELECT 1 FROM public.shopify_connection WHERE is_active = true);