import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const BodySchema = z.object({ ean: z.string().trim().min(3).max(32) });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Require an authenticated caller (any signed-in user).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = parsed.data.ean.replace(/\D+/g, "");
    if (!raw) {
      return new Response(JSON.stringify({ error: "Ugyldigt EAN" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const stripped = raw.replace(/^0+/, "") || raw;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find master product: try both raw and leading-zero-stripped variants.
    const { data: masters } = await admin
      .from("master_products")
      .select("id, title, ean, image_url, webshop_price, sale_price, brand, sku")
      .in("ean", Array.from(new Set([raw, stripped])))
      .limit(1);

    const master = masters?.[0] ?? null;

    let offers: any[] = [];
    if (master) {
      const { data: sp } = await admin
        .from("supplier_products")
        .select("supplier_id, purchase_price, in_stock, stock_quantity, supplier_sku, last_updated, suppliers(id, name)")
        .eq("master_product_id", master.id);
      offers = (sp ?? []).map((row: any) => ({
        supplier_id: row.supplier_id,
        supplier_name: row.suppliers?.name ?? "Ukendt",
        purchase_price: Number(row.purchase_price ?? 0),
        in_stock: !!row.in_stock,
        stock_quantity: row.stock_quantity ?? null,
        supplier_sku: row.supplier_sku ?? null,
        last_updated: row.last_updated ?? null,
      }));
      // Sort: in stock first, then cheapest first.
      offers.sort((a, b) => {
        if (a.in_stock !== b.in_stock) return a.in_stock ? -1 : 1;
        return a.purchase_price - b.purchase_price;
      });
    }

    return new Response(
      JSON.stringify({
        ean: raw,
        ean_normalized: stripped,
        master_product: master,
        offers,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
