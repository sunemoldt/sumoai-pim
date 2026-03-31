INSERT INTO storage.buckets (id, name, public) VALUES ('supplier-feeds', 'supplier-feeds', false);

CREATE POLICY "Allow public upload to supplier-feeds" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'supplier-feeds');
CREATE POLICY "Allow public read from supplier-feeds" ON storage.objects FOR SELECT TO public USING (bucket_id = 'supplier-feeds');