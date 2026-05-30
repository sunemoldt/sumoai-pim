ALTER TABLE public.shopify_connection
ADD COLUMN IF NOT EXISTS requested_shop_domain text,
ADD COLUMN IF NOT EXISTS primary_domain_url text,
ADD COLUMN IF NOT EXISTS shop_name text;

UPDATE public.shopify_connection
SET requested_shop_domain = COALESCE(requested_shop_domain, shop_domain),
    primary_domain_url = COALESCE(primary_domain_url, CASE WHEN shop_domain IS NOT NULL THEN 'https://' || shop_domain ELSE NULL END),
    shop_name = COALESCE(shop_name, shop_domain)
WHERE requested_shop_domain IS NULL
   OR primary_domain_url IS NULL
   OR shop_name IS NULL;