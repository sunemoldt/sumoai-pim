
CREATE OR REPLACE FUNCTION public.sync_meta_to_siblings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source text;
BEGIN
  v_source := coalesce(nullif(current_setting('app.change_source', true), ''), 'manual');
  IF v_source = 'sibling-shared-sync' THEN
    RETURN NEW;
  END IF;
  IF NEW.shopify_product_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.meta_title        IS NOT DISTINCT FROM OLD.meta_title
     AND NEW.meta_description IS NOT DISTINCT FROM OLD.meta_description
     AND NEW.short_description IS NOT DISTINCT FROM OLD.short_description
     AND NEW.long_description  IS NOT DISTINCT FROM OLD.long_description
     AND NEW.brand             IS NOT DISTINCT FROM OLD.brand
     AND NEW.category          IS NOT DISTINCT FROM OLD.category THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.change_source', 'sibling-shared-sync', true);

  UPDATE public.master_products
  SET meta_title        = NEW.meta_title,
      meta_description  = NEW.meta_description,
      short_description = NEW.short_description,
      long_description  = NEW.long_description,
      brand             = NEW.brand,
      category          = NEW.category,
      updated_at        = now()
  WHERE shopify_product_id = NEW.shopify_product_id
    AND id <> NEW.id
    AND ( meta_title        IS DISTINCT FROM NEW.meta_title
       OR meta_description  IS DISTINCT FROM NEW.meta_description
       OR short_description IS DISTINCT FROM NEW.short_description
       OR long_description  IS DISTINCT FROM NEW.long_description
       OR brand             IS DISTINCT FROM NEW.brand
       OR category          IS DISTINCT FROM NEW.category );

  PERFORM set_config('app.change_source', v_source, true);
  RETURN NEW;
END;
$function$;
