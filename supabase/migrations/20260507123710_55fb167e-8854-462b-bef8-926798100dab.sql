
CREATE TABLE public.quotes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  quote_number serial NOT NULL,
  quote_date date NOT NULL DEFAULT current_date,
  valid_days integer NOT NULL DEFAULT 30,
  customer_name text NOT NULL DEFAULT '',
  dinero_contact_guid text,
  dinero_voucher_guid text,
  status text NOT NULL DEFAULT 'draft',
  note_customer text,
  note_internal text,
  total_excl_vat numeric NOT NULL DEFAULT 0,
  total_purchase_price numeric NOT NULL DEFAULT 0
);

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read quotes" ON public.quotes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert quotes" ON public.quotes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update quotes" ON public.quotes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete quotes" ON public.quotes FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role quotes" ON public.quotes FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER quotes_updated_at BEFORE UPDATE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.quote_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  pim_product_id uuid,
  product_name text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 1,
  purchase_price numeric NOT NULL DEFAULT 0,
  list_price numeric NOT NULL DEFAULT 0,
  quote_price numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quote_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read quote_lines" ON public.quote_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert quote_lines" ON public.quote_lines FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update quote_lines" ON public.quote_lines FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete quote_lines" ON public.quote_lines FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role quote_lines" ON public.quote_lines FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_quote_lines_quote_id ON public.quote_lines(quote_id);
