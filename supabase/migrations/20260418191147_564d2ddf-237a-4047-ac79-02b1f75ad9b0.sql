-- Translations table
CREATE TABLE public.product_translations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  master_product_id uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  language_code text NOT NULL,
  title text,
  short_description text,
  long_description text,
  meta_title text,
  meta_description text,
  attributes jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  source text NOT NULL DEFAULT 'manual',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (master_product_id, language_code)
);

CREATE INDEX idx_product_translations_product ON public.product_translations(master_product_id);
CREATE INDEX idx_product_translations_lang ON public.product_translations(language_code);

ALTER TABLE public.product_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read" ON public.product_translations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.product_translations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.product_translations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.product_translations FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role access" ON public.product_translations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_product_translations_updated_at
BEFORE UPDATE ON public.product_translations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Default supported languages setting (Danish always primary, plus initial extras)
INSERT INTO public.analytics_settings (setting_key, setting_value)
VALUES ('supported_languages', '["en","de","sv","no"]')
ON CONFLICT DO NOTHING;