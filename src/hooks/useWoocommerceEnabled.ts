import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * WooCommerce is currently a legacy integration. All setup (edge functions,
 * DB trigger, cards) is preserved so it can be re-enabled later, but by default
 * this hook returns `false` and callers should skip WC push/pull.
 */
export function useWoocommerceEnabled() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    supabase
      .from("analytics_settings")
      .select("setting_value")
      .eq("setting_key", "woocommerce_enabled")
      .maybeSingle()
      .then(({ data }) => {
        if (active) setEnabled(data?.setting_value === "true");
      });
    return () => {
      active = false;
    };
  }, []);

  return enabled;
}
