-- New table for skipped orders (kept separate from processed_orders so replays after cutoff config are not blocked)
CREATE TABLE IF NOT EXISTS public.shopify_skipped_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id bigint NOT NULL,
  shopify_order_number text,
  skipped_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb
);

GRANT SELECT ON public.shopify_skipped_orders TO authenticated;
GRANT ALL ON public.shopify_skipped_orders TO service_role;

ALTER TABLE public.shopify_skipped_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read skipped orders" ON public.shopify_skipped_orders
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_skipped_orders_order_id ON public.shopify_skipped_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_skipped_orders_created_at ON public.shopify_skipped_orders(created_at DESC);

-- Atomic decrement function: sets GUC + updates row in same transaction so auto_enqueue_shopify_update skip-list works
CREATE OR REPLACE FUNCTION public.decrement_stock_from_shopify_order(
  p_master_product_id uuid,
  p_qty integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old integer;
  v_new integer;
  v_auto boolean;
  v_lifecycle text;
BEGIN
  SELECT stock_quantity, auto_stock_sync, lifecycle_status
  INTO v_old, v_auto, v_lifecycle
  FROM public.master_products
  WHERE id = p_master_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped','not_found');
  END IF;
  IF v_auto THEN
    RETURN jsonb_build_object('skipped','auto_stock_sync_managed');
  END IF;
  IF v_lifecycle = 'draft' THEN
    RETURN jsonb_build_object('skipped','draft');
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('skipped','invalid_qty');
  END IF;

  v_new := GREATEST(COALESCE(v_old, 0) - p_qty, 0);

  PERFORM set_config('app.change_source', 'shopify-order', true);

  UPDATE public.master_products
  SET stock_quantity = v_new,
      stock_status = CASE WHEN v_new > 0 THEN 'instock' ELSE 'outofstock' END,
      updated_at = now()
  WHERE id = p_master_product_id;

  RETURN jsonb_build_object('decremented', p_qty, 'old', v_old, 'new', v_new);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decrement_stock_from_shopify_order(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrement_stock_from_shopify_order(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_stock_from_shopify_order(uuid, integer) TO service_role;