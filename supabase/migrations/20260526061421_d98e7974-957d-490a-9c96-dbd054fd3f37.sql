-- Mark all Shopify-linked products as sync-enabled so PIM edits flow to Shopify.
-- Use 'manual' source so the auto-enqueue trigger does NOT fire on this bulk flag flip.
SELECT public.set_change_source('shopify-pull');

UPDATE public.master_products
SET shopify_sync_enabled = true,
    updated_at = now()
WHERE shopify_product_id IS NOT NULL
  AND shopify_sync_enabled = false;
