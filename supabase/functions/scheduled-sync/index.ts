import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const results: any[] = [];

    // 1. Check supplier feeds that need syncing
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("id, name, feed_schedule, feed_url, feed_type, is_active")
      .eq("is_active", true)
      .neq("feed_schedule", "manual")
      .not("feed_schedule", "is", null);

    if (suppliers && suppliers.length > 0) {
      for (const supplier of suppliers) {
        if (!supplier.feed_url || supplier.feed_type === "manual") continue;
        if (!shouldRunNow(supplier.feed_schedule)) continue;

        try {
          const response = await fetch(
            `${supabaseUrl}/functions/v1/supplier-feed-import`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({ supplier_id: supplier.id }),
            }
          );
          const data = await response.json();
          results.push({
            type: "supplier",
            name: supplier.name,
            success: !data.error,
            imported: data.imported ?? 0,
          });
        } catch (err) {
          results.push({
            type: "supplier",
            name: supplier.name,
            success: false,
            error: String(err),
          });
        }
      }
    }

    // 2. Check WC import schedule
    const { data: wcSetting } = await supabase
      .from("price_settings")
      .select("scope_value")
      .eq("scope", "wc_schedule")
      .maybeSingle();

    if (wcSetting?.scope_value && wcSetting.scope_value !== "manual") {
      if (shouldRunNow(wcSetting.scope_value)) {
        try {
          const response = await fetch(
            `${supabaseUrl}/functions/v1/wc-import`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({}),
            }
          );
          const data = await response.json();
          results.push({
            type: "wc-import",
            success: data.success ?? !data.error,
            imported: data.imported ?? 0,
          });
        } catch (err) {
          results.push({
            type: "wc-import",
            success: false,
            error: String(err),
          });
        }
      }
    }

    // 3. Auto stock sync for products with multi-supplier support + margin check
    const { data: syncProducts } = await supabase
      .from("master_products")
      .select("id, auto_stock_sync, stock_sync_supplier_ids, stock_sync_interval, min_sync_margin, webshop_price, sale_price")
      .eq("auto_stock_sync", true);

    if (syncProducts && syncProducts.length > 0) {
      for (const product of syncProducts) {
        const syncIds = (product as any).stock_sync_supplier_ids as string[] | null;
        if (!syncIds || syncIds.length === 0) continue;

        const interval = (product as any).stock_sync_interval ?? "daily";
        // Simple interval check: hourly=always, daily=hour 6, weekly=hour 6 on Monday
        const now = new Date();
        if (interval === "daily" && now.getUTCHours() !== 6) continue;
        if (interval === "weekly" && (now.getUTCHours() !== 6 || now.getUTCDay() !== 1)) continue;

        try {
          // Get supplier products for this master product
          const { data: supplierProducts } = await supabase
            .from("supplier_products")
            .select("supplier_id, purchase_price, in_stock, stock_quantity")
            .eq("master_product_id", product.id)
            .in("supplier_id", syncIds);

          if (!supplierProducts || supplierProducts.length === 0) continue;

          const activePrice = product.sale_price ?? product.webshop_price;
          const minMargin = (product as any).min_sync_margin ?? 15;

          // Filter by margin: only include suppliers where margin >= min_sync_margin
          const eligibleSuppliers = supplierProducts.filter((sp) => {
            if (!activePrice || activePrice === 0) return true; // If no webshop price, include all
            const salePriceExVat = activePrice / 1.25; // Danish VAT
            const margin = ((salePriceExVat - sp.purchase_price) / salePriceExVat) * 100;
            return margin >= minMargin;
          });

          // Aggregate stock from eligible suppliers
          const totalStock = eligibleSuppliers.reduce((sum, sp) => sum + (sp.stock_quantity ?? 0), 0);
          const anyInStock = eligibleSuppliers.some((sp) => sp.in_stock);
          const stockStatus = anyInStock ? "instock" : "outofstock";

          // Update master product stock
          const { error } = await supabase
            .from("master_products")
            .update({
              stock_quantity: totalStock,
              stock_status: stockStatus,
              updated_at: new Date().toISOString(),
            })
            .eq("id", product.id);

          if (error) {
            results.push({ type: "stock-sync", product_id: product.id, success: false, error: error.message });
          } else {
            const skippedCount = supplierProducts.length - eligibleSuppliers.length;
            results.push({
              type: "stock-sync",
              product_id: product.id,
              success: true,
              total_stock: totalStock,
              status: stockStatus,
              suppliers_used: eligibleSuppliers.length,
              suppliers_skipped_margin: skippedCount,
            });
          }
        } catch (err) {
          results.push({ type: "stock-sync", product_id: product.id, success: false, error: String(err) });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Simple cron-like check: does the given cron expression match the current UTC time?
 */
function shouldRunNow(cron: string): boolean {
  const now = new Date();
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minExpr, hourExpr] = parts;
  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();

  return matchField(minExpr, minute) && matchField(hourExpr, hour);
}

function matchField(expr: string, value: number): boolean {
  if (expr === "*") return true;
  if (expr.startsWith("*/")) {
    const step = parseInt(expr.slice(2), 10);
    return value % step === 0;
  }
  return parseInt(expr, 10) === value;
}
