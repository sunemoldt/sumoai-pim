// Pull product data FROM Shopify INTO PIM, respecting field_sync_policy.
// - Updates fields in master_products only when master='shopify' and direction in (pull,two_way)
// - Always syncs lifecycle_status from Shopify status (DRAFT=draft, ACTIVE=active, ARCHIVED=archived)
// - Always upserts variants into product_variants
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2026-04";

async function requireUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;
  if (authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) return true;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await anon.auth.getUser();
  return !error && Boolean(user);
}

async function gql(shop: string, token: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) throw new Error(`Shopify ${res.status}: ${JSON.stringify(data.errors || data)}`);
  return data.data;
}

const PRODUCT_QUERY = `#graphql
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      vendor
      productType
      category { name fullName }
      descriptionHtml
      seo { title description }
      featuredImage { url }
      shortDescription: metafield(namespace: "custom", key: "short_description") { value }
      variants(first: 100) {
        nodes {
          id
          sku
          barcode
          price
          compareAtPrice
          position
          inventoryQuantity
          inventoryPolicy
          image { url }
          inventoryItem { id measurement { weight { value unit } } }
          selectedOptions { name value }
        }
      }

    }
  }`;

function toGid(id: string) {
  return id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
}

function canPull(policy: Map<string, { master: string; direction: string }>, field: string) {
  const p = policy.get(field);
  if (!p) return false; // unknown => don't overwrite by default
  if (p.master !== "shopify") return false;
  return p.direction === "pull" || p.direction === "two_way";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!(await requireUser(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    const { master_product_id, all } = body as { master_product_id?: string; all?: boolean };

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!conn) {
      return new Response(JSON.stringify({ error: "Shopify er ikke forbundet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: policyRows } = await supabase.from("field_sync_policy").select("field_name, master, direction");
    const policy = new Map<string, { master: string; direction: string }>(
      (policyRows ?? []).map((r) => [r.field_name, { master: r.master, direction: r.direction }])
    );

    let targets: { id: string; shopify_product_id: string | null; ean: string | null; sku: string | null }[] = [];
    if (master_product_id) {
      const { data } = await supabase.from("master_products")
        .select("id, shopify_product_id, shopify_variant_id, ean, sku").eq("id", master_product_id).single();
      if (!data?.shopify_product_id) {
        return new Response(JSON.stringify({ error: "Produktet har ikke shopify_product_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targets = [data];
    } else if (all) {
      const { data } = await supabase.from("master_products")
        .select("id, shopify_product_id, ean, sku")
        .not("shopify_product_id", "is", null);
      targets = (data ?? []) as typeof targets;
    } else {
      return new Response(JSON.stringify({ error: "master_product_id eller all=true påkrævet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const results: { id: string; ok: boolean; updated?: string[]; variants?: number; error?: string }[] = [];
    let i = 0;
    for (const t of targets) {
      i++;
      try {
        const data = await gql(conn.shop_domain, conn.access_token, PRODUCT_QUERY, { id: toGid(t.shopify_product_id!) });
        const sp = data.product;
        if (!sp) { results.push({ id: t.id, ok: false, error: "not found in shopify" }); continue; }

        const update: Record<string, unknown> = {};
        const tryField = (field: string, value: unknown) => {
          if (canPull(policy, field) && value !== undefined && value !== null) update[field] = value;
        };
        tryField("title", sp.title);
        tryField("long_description", sp.descriptionHtml);
        tryField("short_description", sp.shortDescription?.value);
        tryField("meta_title", sp.seo?.title);
        tryField("meta_description", sp.seo?.description);
        // image_url is set below from the matched variant (falls back to featuredImage)
        tryField("brand", sp.vendor);
        tryField("category", sp.category?.fullName || sp.category?.name || sp.productType);

        // Pick the variant matching THIS PIM master.
        // Priority: explicit link (t.shopify_variant_id) > EAN > SKU > first variant.
        // Respecting the explicit link prevents overwriting a manual "Søg & link" when
        // Shopify variants share the same SKU or have missing/duplicate barcodes.
        const variants = sp.variants?.nodes ?? [];
        const normEan = (s: string | null | undefined) =>
          s ? String(s).trim().replace(/^0+/, "") || String(s).trim() : "";
        const targetVariantId = t.shopify_variant_id ? String(t.shopify_variant_id) : "";
        const targetEan = normEan(t.ean);
        const targetSku = (t.sku ?? "").trim();
        const matchedVariant =
          (targetVariantId && variants.find((v: any) => (v.id?.split("/").pop() ?? "") === targetVariantId)) ||
          (targetEan && variants.find((v: any) => normEan(v.barcode) === targetEan)) ||
          (targetSku && variants.find((v: any) => (v.sku ?? "").trim() === targetSku)) ||
          variants[0];

        // Image: prefer variant image, fall back to product featured image
        tryField("image_url", matchedVariant?.image?.url || sp.featuredImage?.url);

        // Always keep master's shopify_variant_id in sync with the matched variant
        if (matchedVariant?.id) {
          update.shopify_variant_id = matchedVariant.id.split("/").pop();
        }


        if (matchedVariant) {
          tryField("webshop_price", matchedVariant.price ? Number(matchedVariant.price) : null);
          tryField("sale_price", matchedVariant.compareAtPrice ? Number(matchedVariant.compareAtPrice) : null);
          tryField("stock_quantity", typeof matchedVariant.inventoryQuantity === "number" ? matchedVariant.inventoryQuantity : null);
          tryField("backorders_allowed", matchedVariant.inventoryPolicy === "CONTINUE");
          tryField("backorder_policy", matchedVariant.inventoryPolicy === "CONTINUE" ? "yes" : "no");
          const wRaw = matchedVariant.inventoryItem?.measurement?.weight;
          if (wRaw?.value != null) {
            const wKg = wRaw.unit === "GRAMS" ? Number(wRaw.value) / 1000
              : wRaw.unit === "POUNDS" ? Number(wRaw.value) * 0.45359237
              : wRaw.unit === "OUNCES" ? Number(wRaw.value) * 0.0283495231
              : Number(wRaw.value);
            tryField("weight_kg", wKg);
          }
          tryField("ean", matchedVariant.barcode ? String(matchedVariant.barcode).trim().replace(/^0+/, "") || String(matchedVariant.barcode).trim() : matchedVariant.barcode);
          tryField("sku", matchedVariant.sku);
        }


        // Lifecycle is always synced from Shopify status
        const lifecycle = sp.status === "ACTIVE" ? "active" : sp.status === "ARCHIVED" ? "archived" : "draft";
        update.lifecycle_status = lifecycle;
        update.updated_at = new Date().toISOString();

        await supabase.rpc("set_change_source", { source: "shopify-pull" });
        await supabase.from("master_products").update(update).eq("id", t.id);

        // Sync variants
        const variantRows = (sp.variants?.nodes ?? []).map((v: any, idx: number) => ({
          master_product_id: t.id,
          shopify_variant_id: v.id?.split("/").pop() ?? null,
          shopify_inventory_item_id: v.inventoryItem?.id?.split("/").pop() ?? null,
          sku: v.sku ?? null,
          ean: v.barcode ? (String(v.barcode).trim().replace(/^0+/, "") || String(v.barcode).trim()) : null,
          webshop_price: v.price ? Number(v.price) : null,
          sale_price: v.compareAtPrice ? Number(v.compareAtPrice) : null,
          stock_quantity: typeof v.inventoryQuantity === "number" ? v.inventoryQuantity : 0,
          weight: v.inventoryItem?.measurement?.weight?.value ?? null,
          attributes: Object.fromEntries((v.selectedOptions ?? []).map((o: any) => [o.name, o.value])),
          position: v.position ?? idx,
          updated_at: new Date().toISOString(),
        }));

        // Delete variants that no longer exist in Shopify, then upsert current ones
        const keepIds = variantRows.map((v: any) => v.shopify_variant_id).filter(Boolean);
        if (keepIds.length > 0) {
          await supabase.from("product_variants")
            .delete()
            .eq("master_product_id", t.id)
            .not("shopify_variant_id", "in", `(${keepIds.map((x: string) => `"${x}"`).join(",")})`);
        }
        for (const vr of variantRows) {
          const { data: existing } = await supabase.from("product_variants")
            .select("id").eq("master_product_id", t.id).eq("shopify_variant_id", vr.shopify_variant_id).maybeSingle();
          if (existing) {
            await supabase.from("product_variants").update(vr).eq("id", existing.id);
          } else {
            await supabase.from("product_variants").insert(vr);
          }
        }

        // Auto-rematch suppliers if EAN was set/changed and product has no supplier links yet
        if (update.ean) {
          const { count: spCount } = await supabase
            .from("supplier_products")
            .select("id", { count: "exact", head: true })
            .eq("master_product_id", t.id);
          if ((spCount ?? 0) === 0) {
            // Fire-and-forget — runs in parallel against all active auto-feeds with target_ean filter
            fetch(`${SUPABASE_URL}/functions/v1/supplier-rematch-product`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
              },
              body: JSON.stringify({ master_product_id: t.id }),
            }).catch((e) => console.error("rematch trigger failed:", e));
          }
        }

        results.push({ id: t.id, ok: true, updated: Object.keys(update), variants: variantRows.length });
      } catch (e) {
        results.push({ id: t.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      // gentle pacing for bulk
      if (all && i % 10 === 0) await new Promise((r) => setTimeout(r, 300));
    }

    const ok = results.filter((r) => r.ok).length;
    return new Response(JSON.stringify({ success: true, total: results.length, ok, failed: results.length - ok, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("shopify-pull:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
