
-- Pilot master_product_ids: 9 kontrolgruppe-cases (matcher alle varianter i PIM)
WITH pilot_masters AS (
  SELECT id FROM public.master_products
  WHERE shopify_product_id IS NOT NULL
    AND lifecycle_status IS DISTINCT FROM 'archived'
    AND (
         title ILIKE 'Ubiquiti UniFi AP AC Pro%'
      OR title = 'Jabra Engage 75 Mono'
      OR title ILIKE 'Cat 7 S/FTP Netværkskabel i Hvid%'
      OR title ILIKE 'Cat 6 U/UTP Netværkskabel i Sort%'
      OR title ILIKE 'Linksys USB 3.0%'
      OR title ILIKE 'Ubiquiti UniFi Switch 8-60W%'
      OR title ILIKE 'CAT 6A Fladt Patchkabel - Hvid%'
      OR title ILIKE 'Cat 6 S/FTP Netværkskabel i Hvid%'
      OR title ILIKE 'TP-LINK TL-SG1008%'
    )
),
pilot_update AS (
  UPDATE public.shopify_update_queue q
  SET next_attempt_at = now() - interval '60 minutes',
      updated_at = now()
  WHERE q.status = 'pending'
    AND q.master_product_id IN (SELECT id FROM pilot_masters)
  RETURNING q.id
),
-- BF master_product_ids: 10 unikke shopify_product_ids fra BF-oprydningen
bf_shopify_ids(spid) AS (
  VALUES
    ('10464787661139'), -- Ajax KeyPad Outdoor (3 rows)
    ('10464782352723'), -- Apple Watch oplader USB
    ('10464782254419'), -- Apple Watch oplader USB-C
    ('10464776290643'), -- USB-Lightning M7 (4 rows)
    ('10464782385491'), -- 11-i-1 dock M7
    ('10464782156115'), -- 33W Nano M7
    ('10464782418259'), -- HDMI dock M7
    ('10464778846547'), -- PD Nylon sort M7
    ('10464782090579'), -- PD Nylon hvid M7 (2 rows)
    ('10464776388947')  -- MFi kabel M7
),
bf_masters AS (
  SELECT mp.id, mp.short_description, mp.long_description
  FROM public.master_products mp
  JOIN bf_shopify_ids b ON b.spid = mp.shopify_product_id
  WHERE mp.lifecycle_status IS DISTINCT FROM 'archived'
),
bf_update AS (
  UPDATE public.shopify_update_queue q
  SET payload = jsonb_set(
        jsonb_set(
          COALESCE(q.payload, '{}'::jsonb)
            || jsonb_build_object(
                 'long_description', bm.long_description,
                 'short_description', bm.short_description,
                 'reason', 'seo-bf-merge'
               ),
          '{changed_fields}',
          (
            SELECT jsonb_agg(DISTINCT value ORDER BY value)
            FROM jsonb_array_elements_text(
              COALESCE(q.payload->'changed_fields', '[]'::jsonb)
              || '["long_description","short_description"]'::jsonb
            ) AS fields(value)
          ),
          true
        ),
        '{merged_from}',
        COALESCE(q.payload->'source', to_jsonb(q.source)),
        true
      ),
      source = 'seo-bf-merge',
      next_attempt_at = now() - interval '55 minutes',
      updated_at = now()
  FROM bf_masters bm
  WHERE q.master_product_id = bm.id
    AND q.status = 'pending'
  RETURNING q.id, q.master_product_id
),
-- Log BF-masters som mangler pending-række (INSERT'es ikke — håndteres separat hvis nødvendigt)
bf_missing AS (
  SELECT bm.id
  FROM bf_masters bm
  WHERE NOT EXISTS (
    SELECT 1 FROM public.shopify_update_queue q
    WHERE q.master_product_id = bm.id AND q.status = 'pending'
  )
)
INSERT INTO public.product_change_log (master_product_id, field_name, change_type, old_value, new_value, source)
SELECT id, '__migration_note__', 'update', 'seo-bf-merge', 'no_pending_queue_row', 'seo-bf-merge'
FROM bf_missing;
