import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2026-04";
const VAT_RATE = 0.25;

async function requireUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;
  if (authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) return true;

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await anonClient.auth.getUser();
  return !error && Boolean(user);
}

async function shopifyGraphql(shopDomain: string, accessToken: string, query: string, variables: Record<string, unknown>) {
  const response = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    const snippet = text.slice(0, 200).replace(/\s+/g, " ");
    throw new Error(`Shopify API returned non-JSON [${response.status}]: ${snippet}`);
  }
  const data = await response.json();
  if (!response.ok || data.errors) {
    throw new Error(`Shopify API error [${response.status}]: ${JSON.stringify(data.errors || data)}`);
  }
  return data.data;
}

// Convert HTML to Shopify rich_text_field JSON structure.
// Supports: h1-h6, p, ul, ol, li, strong/b, em/i, br, a. Everything else -> plain text.
function htmlToShopifyRichText(html: string): string {
  const clean = String(html ?? "").trim();
  if (!clean) return JSON.stringify({ type: "root", children: [] });

  type Node = { type: string; children?: Node[]; value?: string; level?: number; url?: string; listType?: string; bold?: boolean; italic?: boolean };
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");
  const decodeEntities = (s: string) => s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  // Parse inline content (strong/em/a/br) into text nodes
  function parseInline(inner: string): Node[] {
    const nodes: Node[] = [];
    const re = /<(\/?)(strong|b|em|i|a|br)(\s[^>]*)?>/gi;
    let last = 0;
    const stack: { bold: boolean; italic: boolean; url?: string }[] = [{ bold: false, italic: false }];
    const pushText = (raw: string) => {
      if (!raw) return;
      const top = stack[stack.length - 1];
      const text = decodeEntities(raw);
      if (!text) return;
      const node: Node = { type: "text", value: text };
      if (top.bold) node.bold = true;
      if (top.italic) node.italic = true;
      if (top.url) {
        nodes.push({ type: "link", url: top.url, children: [node] });
      } else {
        nodes.push(node);
      }
    };
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner)) !== null) {
      pushText(inner.slice(last, m.index));
      const closing = m[1] === "/";
      const tag = m[2].toLowerCase();
      const attrs = m[3] ?? "";
      if (tag === "br") {
        // Rich text root doesn't have a break node; ignore or add space.
      } else if (closing) {
        if (stack.length > 1) stack.pop();
      } else {
        const top = { ...stack[stack.length - 1] };
        if (tag === "strong" || tag === "b") top.bold = true;
        if (tag === "em" || tag === "i") top.italic = true;
        if (tag === "a") {
          const hrefMatch = /href=["']([^"']+)["']/i.exec(attrs);
          if (hrefMatch) top.url = hrefMatch[1];
        }
        stack.push(top);
      }
      last = m.index + m[0].length;
    }
    pushText(inner.slice(last));
    return nodes.length ? nodes : [{ type: "text", value: decodeEntities(stripTags(inner)) }];
  }

  const children: Node[] = [];
  const blockRe = /<(h[1-6]|p|ul|ol)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = blockRe.exec(clean)) !== null) {
    matched = true;
    const tag = m[1].toLowerCase();
    const inner = m[3];
    if (tag.startsWith("h")) {
      children.push({ type: "heading", level: parseInt(tag.slice(1), 10), children: parseInline(inner) });
    } else if (tag === "p") {
      children.push({ type: "paragraph", children: parseInline(inner) });
    } else {
      const items: Node[] = [];
      const liRe = /<li(\s[^>]*)?>([\s\S]*?)<\/li>/gi;
      let li: RegExpExecArray | null;
      while ((li = liRe.exec(inner)) !== null) {
        items.push({ type: "list-item", children: parseInline(li[2]) });
      }
      children.push({ type: "list", listType: tag === "ol" ? "ordered" : "unordered", children: items });
    }
  }
  if (!matched) {
    children.push({ type: "paragraph", children: parseInline(clean) });
  }
  return JSON.stringify({ type: "root", children });
}


function toInventoryPolicy(backorders?: string) {
  if (!backorders) return undefined;
  // Only 'yes' allows backorders. 'notify' and 'no' both DENY purchases when out of stock.
  return backorders === "yes" ? "CONTINUE" : "DENY";
}

function toGid(type: "Product" | "ProductVariant" | "InventoryItem" | "Location", id: string | number | null | undefined): string | null {
  if (id == null || id === "") return null;
  const s = String(id);
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/${type}/${s}`;
}

async function getCheapestPurchasePrice(admin: any, masterProductId: string): Promise<number | null> {
  const { data } = await admin
    .from("supplier_products")
    .select("purchase_price, in_stock, stock_quantity")
    .eq("master_product_id", masterProductId);

  const rows = (data ?? [])
    .map((sp: any) => ({
      purchase: sp.purchase_price == null ? null : Number(sp.purchase_price),
      inStock: sp.in_stock === true && (sp.stock_quantity == null || Number(sp.stock_quantity) > 0),
    }))
    .filter((sp: { purchase: number | null }) => sp.purchase != null && Number.isFinite(sp.purchase) && sp.purchase > 0);

  if (rows.length === 0) return null;
  const inStockRows = rows.filter((sp: { inStock: boolean }) => sp.inStock);
  const pool = inStockRows.length > 0 ? inStockRows : rows;
  return Math.min(...pool.map((sp: { purchase: number }) => sp.purchase));
}

function assertNotBelowPurchase(sellingPriceInclVat: number | null, purchasePriceExVat: number | null) {
  if (sellingPriceInclVat == null || purchasePriceExVat == null) return;
  const sellingExVat = sellingPriceInclVat / (1 + VAT_RATE);
  if (sellingExVat + 0.005 < purchasePriceExVat) {
    throw new Error(
      `Blokeret: Shopify-salgspris ${sellingPriceInclVat.toFixed(2)} kr inkl. moms er under indkøb ${purchasePriceExVat.toFixed(2)} kr ekskl. moms.`
    );
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authed = await requireUser(req);
    if (!authed) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { master_product_id, regular_price, sale_price, stock_quantity, stock_status, backorders, backorder_policy, weight_kg, title: titleInput, description, short_description, meta_title, meta_description, force, enqueue_on_throttle, queued, source, status, ean: eanInput, changed_fields } = body;
    const changedFields = Array.isArray(changed_fields) ? changed_fields.map((f) => String(f)) : [];
    if (!master_product_id) {
      return new Response(JSON.stringify({ error: "master_product_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: product, error: productError } = await supabase
      .from("master_products")
      .select("id, title, ean, webshop_price, sale_price, stock_quantity, stock_status, backorders_allowed, backorder_policy, weight_kg, shopify_product_id, shopify_variant_id, short_description, long_description, meta_title, meta_description, lifecycle_status")
      .eq("id", master_product_id)
      .single();

    if (productError || !product) {
      return new Response(JSON.stringify({ error: "Product not found", details: productError?.message }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only skip drafts that have NEVER been pushed to Shopify. If a product already
    // has a Shopify variant ID it's live on the shop — regardless of PIM lifecycle —
    // and edits (price/stock) must sync, otherwise the shop drifts silently.
    if (product.lifecycle_status === "draft" && (!product.shopify_product_id || !product.shopify_variant_id)) {
      return new Response(JSON.stringify({ skipped: true, reason: "lifecycle=draft", message: "Produktet er en kladde og er ikke sendt til Shopify endnu." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!product.shopify_product_id || !product.shopify_variant_id) {
      return new Response(JSON.stringify({ error: "Produktet har ikke Shopify produkt-/variant-ID. Kør Shopify-import først." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conn) {
      return new Response(JSON.stringify({ error: "Shopify er ikke forbundet endnu" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load field sync policy and skip fields where PIM is not master/push
    const { data: policyRows } = await supabase
      .from("field_sync_policy")
      .select("field_name, master, direction");
    const policy = new Map<string, { master: string; direction: string }>(
      (policyRows ?? []).map((r) => [r.field_name, { master: r.master, direction: r.direction }])
    );
    const canPush = (field: string) => {
      if (force === true) return true;
      const p = policy.get(field);
      if (!p) return true; // unknown field => allow
      if (p.master !== "pim") return false;
      return p.direction === "push" || p.direction === "two_way";
    };

    const updatedFields: string[] = [];
    const skippedFields: string[] = [];
    const dbUpdate: Record<string, unknown> = {};
    const changeLogs: { master_product_id: string; change_type: string; field_name: string; old_value: string | null; new_value: string | null; source: string }[] = [];
    const logChange = (field: string, oldVal: unknown, newVal: unknown, type: string) => {
      const oldText = oldVal == null ? null : String(oldVal);
      const newText = newVal == null ? null : String(newVal);
      if (oldText !== newText) changeLogs.push({ master_product_id, change_type: type, field_name: field, old_value: oldText, new_value: newText, source: "shopify-update-product" });
    };

    const variantGid = toGid("ProductVariant", product.shopify_variant_id);
    const productGid = toGid("Product", product.shopify_product_id);
    const dbValueIfQueued = (field: string, explicitValue: unknown) => {
      if (explicitValue !== undefined) return explicitValue;
      if (queued === true && changedFields.includes(field)) return (product as Record<string, unknown>)[field];
      return undefined;
    };
    const effectiveTitle = dbValueIfQueued("title", titleInput);
    const effectiveRegularPrice = dbValueIfQueued("webshop_price", regular_price);
    const effectiveSalePrice = dbValueIfQueued("sale_price", sale_price);
    const effectiveStockQuantity = dbValueIfQueued("stock_quantity", stock_quantity);
    const effectiveStockStatus = dbValueIfQueued("stock_status", stock_status);
    const effectiveWeightKg = dbValueIfQueued("weight_kg", weight_kg);
    const effectiveDescription = dbValueIfQueued("long_description", description);
    const effectiveShortDescription = dbValueIfQueued("short_description", short_description);
    const effectiveMetaTitle = dbValueIfQueued("meta_title", meta_title);
    const effectiveMetaDescription = dbValueIfQueued("meta_description", meta_description);
    const effectiveBackorderPolicy = dbValueIfQueued("backorder_policy", backorder_policy);
    const effectiveEan = dbValueIfQueued("ean", eanInput);
    // Normalize backorder input: accept legacy 'backorders' ('yes'/'no'/'notify') or new 'backorder_policy'
    const backordersNorm: string | undefined = (effectiveBackorderPolicy ?? backorders) as string | undefined;

    const variantInput: Record<string, unknown> = { id: variantGid };
    // Shopify semantics: variant.price = current selling price, compareAtPrice = "was" price (strikethrough).
    // PIM semantics: webshop_price = normal price, sale_price = discounted price when on sale.
    // Mapping: if sale_price is set (and < webshop_price) => price = sale_price, compareAtPrice = webshop_price.
    //         else => price = webshop_price, compareAtPrice = null.
    const pricingTouched = effectiveRegularPrice !== undefined || effectiveSalePrice !== undefined;
    if (pricingTouched) {
      const newRegular = effectiveRegularPrice !== undefined && effectiveRegularPrice !== null
        ? Number(effectiveRegularPrice)
        : (product.webshop_price != null ? Number(product.webshop_price) : null);
      const newSaleRaw = effectiveSalePrice !== undefined ? effectiveSalePrice : product.sale_price;
      const newSale = newSaleRaw !== null && newSaleRaw !== undefined ? Number(newSaleRaw) : null;
      const onSale = newSale !== null && newRegular !== null && newSale < newRegular && newSale > 0;
      const intendedSellingPrice = onSale ? newSale : newRegular;
      const willPushSellingPrice = onSale ? canPush("sale_price") : canPush("webshop_price");

      if (willPushSellingPrice) {
        // Guard: only block when the selling price is actually being LOWERED (or newly set)
        // to a value under cost. If the price is unchanged vs. what's already in the DB,
        // don't block — otherwise stock/other updates that re-push the current price get
        // stuck forever when a new supplier feed lands a higher purchase price.
        const currentSellingPrice = (() => {
          const curRegular = product.webshop_price != null ? Number(product.webshop_price) : null;
          const curSale = product.sale_price != null ? Number(product.sale_price) : null;
          const wasOnSale = curSale !== null && curRegular !== null && curSale < curRegular && curSale > 0;
          return wasOnSale ? curSale : curRegular;
        })();
        const priceIsLoweredOrNew =
          intendedSellingPrice != null &&
          (currentSellingPrice == null || intendedSellingPrice + 0.005 < currentSellingPrice);
        if (force !== true && priceIsLoweredOrNew) {
          const cheapestPurchase = await getCheapestPurchasePrice(supabase, master_product_id);
          assertNotBelowPurchase(intendedSellingPrice, cheapestPurchase);
        }
      }

      if (effectiveRegularPrice !== undefined && effectiveRegularPrice !== null) {
        if (canPush("webshop_price")) {
          dbUpdate.webshop_price = effectiveRegularPrice;
          logChange("webshop_price", product.webshop_price, effectiveRegularPrice, "price_update");
        } else { skippedFields.push("webshop_price"); }
      }
      if (effectiveSalePrice !== undefined) {
        if (canPush("sale_price")) {
          dbUpdate.sale_price = effectiveSalePrice;
          logChange("sale_price", product.sale_price, effectiveSalePrice, "price_update");
        } else { skippedFields.push("sale_price"); }
      }

      // Gate price/compareAtPrice independently by field sync policy so a blocked
      // field is never overwritten by a push on the other field.
      // - variant.price reflects the current selling price:
      //     on sale -> comes from sale_price (gate on "sale_price")
      //     not on sale -> comes from webshop_price (gate on "webshop_price")
      // - variant.compareAtPrice reflects the "was" strikethrough price:
      //     on sale -> the regular price (gate on "webshop_price")
      //     not on sale -> cleared to null (gate on "sale_price", since this ends a sale)
      if (onSale) {
        if (canPush("sale_price")) {
          variantInput.price = String(newSale);
          updatedFields.push("price");
        }
        if (canPush("webshop_price")) {
          variantInput.compareAtPrice = String(newRegular);
          updatedFields.push("compareAtPrice");
        }
      } else if (newRegular !== null) {
        if (canPush("webshop_price")) {
          variantInput.price = String(newRegular);
          updatedFields.push("price");
        }
        if (canPush("sale_price")) {
          variantInput.compareAtPrice = null;
          updatedFields.push("compareAtPrice");
        }
      }
    }
    const inventoryPolicy = toInventoryPolicy(backordersNorm);
    if (inventoryPolicy) {
      if (canPush("backorders_allowed") || canPush("backorder_policy")) {
        variantInput.inventoryPolicy = inventoryPolicy;
        const allowed = inventoryPolicy === "CONTINUE";
        const policyValue = backordersNorm === "yes" || backordersNorm === "no" || backordersNorm === "notify" ? backordersNorm : (allowed ? "yes" : "no");
        dbUpdate.backorders_allowed = allowed;
        dbUpdate.backorder_policy = policyValue;
        logChange("backorders_allowed", product.backorders_allowed, allowed, "stock_update");
        logChange("backorder_policy", product.backorder_policy, policyValue, "stock_update");
        updatedFields.push("inventoryPolicy");
      } else { skippedFields.push("backorders_allowed"); }
    }

    // Weight (kg) — send to Shopify via inventoryItem measurement. Defaults to 1 kg if no value set in PIM.
    {
      const effectiveWeight = effectiveWeightKg !== undefined && effectiveWeightKg !== null
        ? Number(effectiveWeightKg)
        : (product.weight_kg != null ? Number(product.weight_kg) : 1);
      if (Number.isFinite(effectiveWeight) && effectiveWeight >= 0) {
        if (canPush("weight_kg")) {
          variantInput.inventoryItem = {
            ...(variantInput.inventoryItem as Record<string, unknown> ?? {}),
            measurement: { weight: { value: effectiveWeight, unit: "KILOGRAMS" } },
          };
          if (effectiveWeightKg !== undefined && effectiveWeightKg !== null) {
            dbUpdate.weight_kg = effectiveWeightKg;
            logChange("weight_kg", product.weight_kg, effectiveWeightKg, "weight_update");
          }
          updatedFields.push("weight");
        } else { skippedFields.push("weight_kg"); }
      }
    }
    // Barcode (EAN). Default to PIM's current ean unless caller overrode. Skip fallback 'wc-' EANs.
    {
      const eanCandidate = effectiveEan !== undefined ? effectiveEan : product.ean;
      if (eanCandidate && typeof eanCandidate === "string" && !eanCandidate.startsWith("wc-")) {
        if (canPush("ean")) {
          // Only push if it actually differs from what we last knew, OR caller forced
          if (force === true || effectiveEan !== undefined) {
            variantInput.barcode = String(eanCandidate);
            logChange("ean", product.ean, eanCandidate, "ean_update");
            updatedFields.push("barcode");
          }
        } else { skippedFields.push("ean"); }
      }
    }

    // Product-level update (description / excerpt)
    const productInput: Record<string, unknown> = { id: productGid };
    if (effectiveTitle !== undefined && effectiveTitle !== null) {
      if (canPush("title")) {
        productInput.title = String(effectiveTitle);
        dbUpdate.title = effectiveTitle;
        logChange("title", product.title, effectiveTitle, "title_update");
        updatedFields.push("title");
      } else { skippedFields.push("title"); }
    }
    if (effectiveDescription !== undefined && effectiveDescription !== null) {
      if (canPush("long_description")) {
        productInput.descriptionHtml = String(effectiveDescription);
        dbUpdate.long_description = effectiveDescription;
        logChange("long_description", product.long_description, effectiveDescription, "description_update");
        updatedFields.push("descriptionHtml");
      } else { skippedFields.push("long_description"); }
    }
    if (effectiveShortDescription !== undefined && effectiveShortDescription !== null) {
      if (canPush("short_description")) {
        productInput.metafields = [{
          namespace: "custom",
          key: "shortdescription",
          type: "rich_text_field",
          value: htmlToShopifyRichText(String(effectiveShortDescription)),
        }];
        dbUpdate.short_description = effectiveShortDescription;
        logChange("short_description", product.short_description, effectiveShortDescription, "description_update");
        updatedFields.push("short_description");
      } else { skippedFields.push("short_description"); }
    }
    // SEO: Page title + Meta description (Shopify-side: product.seo)
    // Only push when the caller explicitly provided (or queued) a value.
    // Never fall back to DB values on unrelated pushes — that would clobber
    // manual SEO edits made in Shopify Admin.
    {
      const seoObj: Record<string, unknown> = {};

      if (effectiveMetaTitle !== undefined && effectiveMetaTitle !== null) {
        if (canPush("meta_title")) {
          seoObj.title = String(effectiveMetaTitle);
          dbUpdate.meta_title = effectiveMetaTitle;
          logChange("meta_title", product.meta_title, effectiveMetaTitle, "seo_update");
          updatedFields.push("seo.title");
        } else {
          skippedFields.push("meta_title");
        }
      }

      if (effectiveMetaDescription !== undefined && effectiveMetaDescription !== null) {
        if (canPush("meta_description")) {
          seoObj.description = String(effectiveMetaDescription);
          dbUpdate.meta_description = effectiveMetaDescription;
          logChange("meta_description", product.meta_description, effectiveMetaDescription, "seo_update");
          updatedFields.push("seo.description");
        } else {
          skippedFields.push("meta_description");
        }
      }

      if (Object.keys(seoObj).length > 0) {
        productInput.seo = seoObj;
      }
    }


    if (status !== undefined && status !== null) {
      const s = String(status).toUpperCase();
      if (s === "ACTIVE" || s === "ARCHIVED" || s === "DRAFT") {
        productInput.status = s;
        logChange("shopify_status", null, s, "status_update");
        updatedFields.push("status");
      }
    }
    if (Object.keys(productInput).length > 1) {
      const productMutation = `#graphql
        mutation UpdateProduct($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id }
            userErrors { field message }
          }
        }`;
      const pData = await shopifyGraphql(conn.shop_domain, conn.access_token, productMutation, { input: productInput });
      const pErrors = pData.productUpdate.userErrors;
      if (pErrors?.length) throw new Error(pErrors.map((e: { message: string }) => e.message).join(", "));
    }

    if (Object.keys(variantInput).length > 1) {
      const mutation = `#graphql
        mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id }
            userErrors { field message }
          }
        }`;
      const data = await shopifyGraphql(conn.shop_domain, conn.access_token, mutation, {
        productId: productGid,
        variants: [variantInput],
      });
      const errors = data.productVariantsBulkUpdate.userErrors;
      if (errors?.length) throw new Error(errors.map((e: { message: string }) => e.message).join(", "));
    }

    if (effectiveStockQuantity !== undefined && effectiveStockQuantity !== null) {
      if (!canPush("stock_quantity")) {
        skippedFields.push("stock_quantity");
      } else {
        const inventoryQuery = `#graphql
          query VariantInventory($id: ID!) {
            productVariant(id: $id) {
              inventoryItem {
                id
                inventoryLevels(first: 10) {
                  nodes {
                    location { id }
                    quantities(names: ["available"]) { name quantity }
                  }
                }
              }
            }
            locations(first: 5, includeInactive: false) { nodes { id } }
          }`;
        const inventoryData = await shopifyGraphql(conn.shop_domain, conn.access_token, inventoryQuery, { id: variantGid });
        const inventoryItemId = inventoryData.productVariant?.inventoryItem?.id;
        const levels = inventoryData.productVariant?.inventoryItem?.inventoryLevels?.nodes ?? [];
        const firstLevel = levels[0];
        const locationId = firstLevel?.location?.id ?? inventoryData.locations?.nodes?.[0]?.id;
        const currentQty = firstLevel?.quantities?.find((q: { name: string }) => q.name === "available")?.quantity ?? 0;

        if (inventoryItemId && locationId) {
          const setMutation = `#graphql
            mutation SetInventory($input: InventorySetQuantitiesInput!) {
              inventorySetQuantities(input: $input) @idempotent(key: "${crypto.randomUUID()}") {
                userErrors { field message }
              }
            }`;
          const runSet = async (fromQty: number) => {
            const setData = await shopifyGraphql(conn.shop_domain, conn.access_token, setMutation, {
              input: {
                name: "available",
                reason: "correction",
                quantities: [{ inventoryItemId, locationId, quantity: Number(effectiveStockQuantity), changeFromQuantity: fromQty }],
              },
            });
            return setData.inventorySetQuantities.userErrors as { field: string[]; message: string }[] | null;
          };
          let errors = await runSet(Number(currentQty));
          // Retry once if quantity drifted between read and write
          if (errors?.length && errors.some((e) => /changeFromQuantity|no longer matches/i.test(e.message))) {
            const refetch = await shopifyGraphql(conn.shop_domain, conn.access_token, inventoryQuery, { id: variantGid });
            const refLevels = refetch.productVariant?.inventoryItem?.inventoryLevels?.nodes ?? [];
            const refLevel = refLevels.find((l: { location?: { id?: string } }) => l.location?.id === locationId) ?? refLevels[0];
            const refQty = refLevel?.quantities?.find((q: { name: string }) => q.name === "available")?.quantity ?? 0;
            errors = await runSet(Number(refQty));
          }
          if (errors?.length) throw new Error(errors.map((e: { message: string }) => e.message).join(", "));
        }
        dbUpdate.stock_quantity = effectiveStockQuantity;
        logChange("stock_quantity", product.stock_quantity, effectiveStockQuantity, "stock_update");
        updatedFields.push("stock_quantity");
      }
    }

    if (effectiveStockStatus) {
      if (canPush("stock_status")) {
        dbUpdate.stock_status = effectiveStockStatus;
        logChange("stock_status", product.stock_status, effectiveStockStatus, "stock_update");
        updatedFields.push("stock_status");
      } else { skippedFields.push("stock_status"); }
    }

    // Always stamp sync timestamp on success (even if no fields actually pushed — call succeeded)
    dbUpdate.last_shopify_sync_at = new Date().toISOString();
    dbUpdate.last_shopify_sync_status = "ok";

    await supabase.from("master_products").update({ ...dbUpdate, updated_at: new Date().toISOString() }).eq("id", master_product_id);
    if (changeLogs.length > 0) {
      await supabase.from("product_change_log").insert(changeLogs);
    }

    return new Response(JSON.stringify({ success: true, shopify_product_id: product.shopify_product_id, shopify_variant_id: product.shopify_variant_id, updated_fields: updatedFields, skipped_fields: skippedFields, last_shopify_sync_at: dbUpdate.last_shopify_sync_at }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ukendt fejl";
    console.error("Shopify update error:", message);

    // Detect transient/throttle errors and enqueue for retry
    const isThrottle = /rate.?limit|throttl|429|too many requests|exceeded for trace/i.test(message);
    const shouldEnqueue = isThrottle && enqueue_on_throttle !== false && queued !== true;

    // Narrowly detect a stale product link. Only clear the link when Shopify
    // explicitly reports the *product* (or its variant referenced by the
    // productSet/variant mutation) as missing — NOT for unrelated "not found"
    // errors like missing Location, InventoryItem, Metafield, etc., which
    // routinely surface during stock/price pushes on healthy products.
    const isStaleLink =
      /\bProduct(?: with id [^\s]+)? does not exist\b/i.test(message) ||
      /\bproduct(?: with id)?\s+not\s*found\b/i.test(message) ||
      /gid:\/\/shopify\/Product\/[^\s'"]+\s+(?:does not exist|not found)/i.test(message);

    if (isStaleLink && master_product_id) {
      try {
        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: prod } = await sb
          .from("master_products")
          .select("ean")
          .eq("id", master_product_id)
          .maybeSingle();

        await sb.from("master_products").update({
          shopify_product_id: null,
          shopify_variant_id: null,
          last_shopify_sync_status: "unlinked",
          updated_at: new Date().toISOString(),
        }).eq("id", master_product_id);


        // Best-effort auto-rematch by EAN (does not throw on failure)
        if (prod?.ean) {
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/shopify-match`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                apikey: SUPABASE_SERVICE_ROLE_KEY,
              },
              body: JSON.stringify({ ean: prod.ean, onlyUnlinked: true }),
            });
          } catch (_) { /* ignore */ }
        }

        return new Response(JSON.stringify({
          error: message,
          stale_link_cleared: true,
          message: "Shopify-produktet findes ikke længere. Linket er nulstillet — prøv at matche eller opret på ny.",
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (clearErr) {
        console.error("Failed to clear stale Shopify link:", clearErr);
      }
    }

    // Stamp failure on product (best-effort, ignore errors)
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await sb.from("master_products").update({ last_shopify_sync_status: shouldEnqueue ? "queued" : "failed" }).eq("id", master_product_id);
    } catch { /* ignore */ }



    if (shouldEnqueue) {
      try {
        const supabaseSvc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        // Avoid duplicate pending entries for the same product
        const { data: existing } = await supabaseSvc
          .from("shopify_update_queue")
          .select("id, attempts")
          .eq("master_product_id", master_product_id)
          .in("status", ["pending", "processing"])
          .maybeSingle();

        const retryDelaySec = 60; // initial backoff window
        const payload = await req.clone().json().catch(() => ({}));
        // Strip control fields so worker re-runs cleanly
        delete payload.queued;
        delete payload.enqueue_on_throttle;

        if (existing) {
          await supabaseSvc.from("shopify_update_queue")
            .update({
              payload,
              status: "pending",
              last_error: message,
              next_attempt_at: new Date(Date.now() + retryDelaySec * 1000).toISOString(),
            })
            .eq("id", existing.id);
        } else {
          await supabaseSvc.from("shopify_update_queue").insert({
            master_product_id,
            payload,
            status: "pending",
            attempts: 0,
            last_error: message,
            next_attempt_at: new Date(Date.now() + retryDelaySec * 1000).toISOString(),
            source: source ?? "shopify-update-product",
          });
        }

        return new Response(JSON.stringify({
          queued: true,
          retry_after_seconds: retryDelaySec,
          message: "Shopify rate limit ramt — opgaven er sat i kø og prøves automatisk igen.",
        }), {
          status: 202,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (qErr) {
        console.error("Failed to enqueue:", qErr);
      }
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
