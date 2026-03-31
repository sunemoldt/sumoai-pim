CREATE TABLE public.import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  total_fetched integer DEFAULT 0,
  imported integer DEFAULT 0,
  skipped integer DEFAULT 0,
  deduplicated integer DEFAULT 0,
  errors jsonb DEFAULT '[]',
  ean_snapshot jsonb DEFAULT '[]',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.import_logs FOR SELECT TO public USING (true);
CREATE POLICY "Service insert/update" ON public.import_logs FOR ALL TO service_role USING (true) WITH CHECK (true);