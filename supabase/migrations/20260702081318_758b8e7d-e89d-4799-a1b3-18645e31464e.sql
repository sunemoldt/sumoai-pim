-- Deactivate WooCommerce trigger belt-and-suspenders (setting kill-switch is already off).
-- We keep the trigger + function so it can be re-enabled later with a single ALTER.
ALTER TABLE public.master_products DISABLE TRIGGER trg_auto_push_wc_update;

-- Ensure the runtime setting is also off (idempotent).
INSERT INTO public.analytics_settings (setting_key, setting_value)
VALUES ('woocommerce_enabled', 'false')
ON CONFLICT (setting_key) DO UPDATE SET setting_value = 'false';