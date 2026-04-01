
-- Drop all overly permissive "Public access" policies on all tables
DROP POLICY IF EXISTS "Public access" ON public.master_products;
DROP POLICY IF EXISTS "Public access" ON public.suppliers;
DROP POLICY IF EXISTS "Public access" ON public.supplier_products;
DROP POLICY IF EXISTS "Public access" ON public.price_settings;
DROP POLICY IF EXISTS "Public access" ON public.price_history;
DROP POLICY IF EXISTS "Public access" ON public.webhook_configs;
DROP POLICY IF EXISTS "Public access" ON public.product_analytics;
DROP POLICY IF EXISTS "Public access" ON public.product_recommendations;
DROP POLICY IF EXISTS "Public access" ON public.analytics_settings;

-- Drop existing product_change_log policies
DROP POLICY IF EXISTS "Public insert access" ON public.product_change_log;
DROP POLICY IF EXISTS "Public read access" ON public.product_change_log;

-- master_products: authenticated read/write
CREATE POLICY "Authenticated read" ON public.master_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.master_products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.master_products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.master_products FOR DELETE TO authenticated USING (true);
-- service_role full access for edge functions
CREATE POLICY "Service role access" ON public.master_products FOR ALL TO service_role USING (true) WITH CHECK (true);

-- suppliers
CREATE POLICY "Authenticated read" ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.suppliers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.suppliers FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role access" ON public.suppliers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- supplier_products
CREATE POLICY "Authenticated read" ON public.supplier_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.supplier_products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.supplier_products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.supplier_products FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role access" ON public.supplier_products FOR ALL TO service_role USING (true) WITH CHECK (true);

-- price_settings
CREATE POLICY "Authenticated read" ON public.price_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.price_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.price_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.price_settings FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role access" ON public.price_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- price_history
CREATE POLICY "Authenticated read" ON public.price_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.price_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.price_history FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.price_history FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role access" ON public.price_history FOR ALL TO service_role USING (true) WITH CHECK (true);

-- webhook_configs
CREATE POLICY "Authenticated read" ON public.webhook_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.webhook_configs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.webhook_configs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.webhook_configs FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role access" ON public.webhook_configs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- product_analytics
CREATE POLICY "Authenticated read" ON public.product_analytics FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.product_analytics FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.product_analytics FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.product_analytics FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role access" ON public.product_analytics FOR ALL TO service_role USING (true) WITH CHECK (true);

-- product_recommendations
CREATE POLICY "Authenticated read" ON public.product_recommendations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.product_recommendations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.product_recommendations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.product_recommendations FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role access" ON public.product_recommendations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- analytics_settings
CREATE POLICY "Authenticated read" ON public.analytics_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.analytics_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.analytics_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.analytics_settings FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role access" ON public.analytics_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- product_change_log
CREATE POLICY "Authenticated read" ON public.product_change_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.product_change_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Service role access" ON public.product_change_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- import_logs: keep existing service_role policy, add authenticated read
DROP POLICY IF EXISTS "Public read access" ON public.import_logs;
CREATE POLICY "Authenticated read" ON public.import_logs FOR SELECT TO authenticated USING (true);

-- Fix storage policies for supplier-feeds bucket
DROP POLICY IF EXISTS "Allow public upload to supplier-feeds" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read from supplier-feeds" ON storage.objects;
CREATE POLICY "Authenticated upload to supplier-feeds" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'supplier-feeds');
CREATE POLICY "Authenticated read from supplier-feeds" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'supplier-feeds');
CREATE POLICY "Service role storage access" ON storage.objects FOR ALL TO service_role USING (bucket_id = 'supplier-feeds') WITH CHECK (bucket_id = 'supplier-feeds');
