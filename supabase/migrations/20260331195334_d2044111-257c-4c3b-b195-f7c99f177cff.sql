CREATE TABLE public.product_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  change_type text NOT NULL,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  source text DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_change_log_product ON public.product_change_log(master_product_id, created_at DESC);

ALTER TABLE public.product_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.product_change_log FOR SELECT TO public USING (true);
CREATE POLICY "Public insert access" ON public.product_change_log FOR INSERT TO public WITH CHECK (true);