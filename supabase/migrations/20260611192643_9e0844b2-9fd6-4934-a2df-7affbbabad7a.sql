-- Normaliser eksisterende EANs i master_products og product_variants ved at fjerne leading zeros.
-- Springer fallback-EAN'er over ('wc-' prefix). Bevarer mindst ét ciffer.
UPDATE public.master_products
SET ean = regexp_replace(ean, '^0+', ''),
    updated_at = now()
WHERE ean ~ '^0+\d'
  AND ean NOT LIKE 'wc-%';

UPDATE public.product_variants
SET ean = regexp_replace(ean, '^0+', ''),
    updated_at = now()
WHERE ean ~ '^0+\d'
  AND ean NOT LIKE 'wc-%';