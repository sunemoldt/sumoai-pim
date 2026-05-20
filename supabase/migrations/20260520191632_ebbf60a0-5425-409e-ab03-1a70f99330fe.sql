
-- Delete duplicate master_products: for each webshop_product_id with multiple rows,
-- keep the one with shopify_product_id or supplier_products, delete empty ghosts.
WITH grouped AS (
  SELECT mp.id, mp.webshop_product_id, mp.shopify_product_id,
         (SELECT count(*) FROM supplier_products sp WHERE sp.master_product_id = mp.id) AS sp_count,
         mp.updated_at
  FROM master_products mp
  WHERE mp.webshop_platform = 'woocommerce'
    AND mp.webshop_product_id IS NOT NULL
),
dups AS (
  SELECT webshop_product_id
  FROM grouped
  GROUP BY webshop_product_id
  HAVING count(*) > 1
),
ranked AS (
  SELECT g.*,
    ROW_NUMBER() OVER (
      PARTITION BY g.webshop_product_id
      ORDER BY (CASE WHEN g.shopify_product_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
               g.sp_count DESC,
               g.updated_at DESC
    ) AS rn
  FROM grouped g
  WHERE g.webshop_product_id IN (SELECT webshop_product_id FROM dups)
)
DELETE FROM master_products
WHERE id IN (
  SELECT id FROM ranked
  WHERE rn > 1
    AND shopify_product_id IS NULL
    AND sp_count = 0
);
