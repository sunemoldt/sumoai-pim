-- Composite index for the EAN lookup path (WHERE ean IN (...) then filter by price/in_stock).
CREATE INDEX IF NOT EXISTS supplier_feed_cache_ean_price_idx
  ON public.supplier_feed_cache (ean)
  WHERE purchase_price IS NOT NULL;

-- Index to make the per-supplier prune (delete WHERE supplier_id = ? AND last_seen_at < ?) cheap.
CREATE INDEX IF NOT EXISTS supplier_feed_cache_supplier_last_seen_idx
  ON public.supplier_feed_cache (supplier_id, last_seen_at);
