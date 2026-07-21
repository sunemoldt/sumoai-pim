-- Backfill: queue all Shopify-linked products with SEO data for re-push
INSERT INTO public.shopify_update_queue (master_product_id, payload, source, status, next_attempt_at)
SELECT mp.id,
       jsonb_build_object(
         'reason', 'seo-backfill',
         'changed_fields', jsonb_build_array('meta_title','meta_description'),
         'meta_title', mp.meta_title,
         'meta_description', mp.meta_description
       ),
       'seo-backfill',
       'pending',
       now()
FROM public.master_products mp
WHERE mp.shopify_product_id IS NOT NULL
  AND mp.shopify_sync_enabled = true
  AND mp.lifecycle_status IS DISTINCT FROM 'archived'
  AND (mp.meta_title IS NOT NULL OR mp.meta_description IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.shopify_update_queue q
    WHERE q.master_product_id = mp.id
      AND q.status IN ('pending','processing')
  );