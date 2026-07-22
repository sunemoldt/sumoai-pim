import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const VAT_RATE = 0.25;

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

function isBelowPurchase(sellingPriceInclVat: number, purchasePriceExVat: number | null): boolean {
  if (purchasePriceExVat == null) return false;
  return sellingPriceInclVat / (1 + VAT_RATE) + 0.005 < purchasePriceExVat;
}

async function activateCampaign(admin: any, campaign: any) {
  const { data: cps } = await admin
    .from("sale_campaign_products")
    .select("id, master_product_id, applied_at")
    .eq("campaign_id", campaign.id);

  let applied = 0;
  let skipped = 0;

  for (const cp of cps ?? []) {
    if (cp.applied_at) continue; // already applied
    const { data: mp } = await admin
      .from("master_products")
      .select("id, webshop_price, sale_price")
      .eq("id", cp.master_product_id)
      .maybeSingle();

    if (!mp || mp.webshop_price == null) {
      await admin
        .from("sale_campaign_products")
        .update({ skipped_reason: "missing_product_or_price" })
        .eq("id", cp.id);
      skipped++;
      continue;
    }

    if (mp.sale_price != null && !campaign.overwrite_existing_sale) {
      await admin
        .from("sale_campaign_products")
        .update({ skipped_reason: "had_manual_sale" })
        .eq("id", cp.id);
      skipped++;
      continue;
    }

    const newSale = round2(Number(mp.webshop_price) * (1 - Number(campaign.discount_percent) / 100));
    const cheapestPurchase = await getCheapestPurchasePrice(admin, mp.id);
    if (isBelowPurchase(newSale, cheapestPurchase)) {
      await admin
        .from("sale_campaign_products")
        .update({ skipped_reason: "below_purchase_price" })
        .eq("id", cp.id);
      skipped++;
      continue;
    }

    await admin.rpc("set_change_source", { source: "sale-campaign" });
    const { error: upErr } = await admin
      .from("master_products")
      .update({ sale_price: newSale })
      .eq("id", mp.id);

    if (upErr) {
      await admin
        .from("sale_campaign_products")
        .update({ skipped_reason: `update_failed:${upErr.message}` })
        .eq("id", cp.id);
      skipped++;
      continue;
    }

    await admin
      .from("sale_campaign_products")
      .update({
        original_sale_price: mp.sale_price,
        applied_sale_price: newSale,
        applied_at: new Date().toISOString(),
        skipped_reason: null,
      })
      .eq("id", cp.id);
    applied++;
  }

  await admin
    .from("sale_campaigns")
    .update({ status: "active", activated_at: new Date().toISOString() })
    .eq("id", campaign.id);

  return { applied, skipped };
}

async function deactivateCampaign(admin: any, campaign: any, finalStatus: "ended" | "cancelled") {
  const { data: cps } = await admin
    .from("sale_campaign_products")
    .select("id, master_product_id, original_sale_price, applied_sale_price, applied_at, reverted_at")
    .eq("campaign_id", campaign.id);

  let reverted = 0;

  for (const cp of cps ?? []) {
    if (!cp.applied_at || cp.reverted_at) continue;

    const { data: mp } = await admin
      .from("master_products")
      .select("id, sale_price")
      .eq("id", cp.master_product_id)
      .maybeSingle();
    if (!mp) continue;

    // Only revert if the campaign price is still active — user may have overridden
    const currentMatches =
      cp.applied_sale_price != null &&
      mp.sale_price != null &&
      Math.abs(Number(mp.sale_price) - Number(cp.applied_sale_price)) < 0.005;

    if (currentMatches) {
      await admin.rpc("set_change_source", { source: "sale-campaign" });
      const { error: revertErr } = await admin
        .from("master_products")
        .update({ sale_price: cp.original_sale_price })
        .eq("id", mp.id);
      if (revertErr) {
        // Revert rejected (e.g. below-cost trigger). Do NOT mark reverted — leave for retry/manual fix.
        console.error(`revert failed for ${mp.id}: ${revertErr.message}`);
        await admin
          .from("sale_campaign_products")
          .update({ skipped_reason: `revert_failed:${revertErr.message}` })
          .eq("id", cp.id);
        continue;
      }
      reverted++;
    }

    await admin
      .from("sale_campaign_products")
      .update({ reverted_at: new Date().toISOString() })
      .eq("id", cp.id);
  }

  // Only mark the campaign as ended/cancelled once every applicable product has been reverted.
  // If any revert failed (e.g. below-cost trigger), leave status = 'active' so the next tick retries.
  const { count: pendingCount } = await admin
    .from("sale_campaign_products")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .not("applied_at", "is", null)
    .is("reverted_at", null);

  if ((pendingCount ?? 0) === 0) {
    await admin
      .from("sale_campaigns")
      .update({ status: finalStatus, deactivated_at: new Date().toISOString() })
      .eq("id", campaign.id);
  }

  return { reverted, pending: pendingCount ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let action: string = "tick";
  let campaignId: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      action = body?.action ?? "tick";
      campaignId = body?.campaign_id ?? null;
    } catch (_) {
      // no body
    }
  }

  // AuthZ: manual actions require an authenticated user; scheduled 'tick' calls
  // must present the CRON_SECRET header (used by pg_cron / scheduler).
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedCronSecret = req.headers.get("x-cron-secret");
  const isCron = !!cronSecret && providedCronSecret === cronSecret;

  if (!isCron) {
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.slice(7);
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }


  try {
    const results: any[] = [];

    if (action === "activate" && campaignId) {
      const { data: c } = await admin.from("sale_campaigns").select("*").eq("id", campaignId).single();
      if (c) results.push({ campaign_id: c.id, ...(await activateCampaign(admin, c)) });
    } else if ((action === "deactivate" || action === "cancel") && campaignId) {
      const { data: c } = await admin.from("sale_campaigns").select("*").eq("id", campaignId).single();
      if (c) results.push({ campaign_id: c.id, ...(await deactivateCampaign(admin, c, action === "cancel" ? "cancelled" : "ended")) });
    } else {
      // tick: activate all scheduled where starts_at<=now, deactivate active where ends_at<=now
      const nowIso = new Date().toISOString();
      const { data: toActivate } = await admin
        .from("sale_campaigns")
        .select("*")
        .eq("status", "scheduled")
        .lte("starts_at", nowIso);
      for (const c of toActivate ?? []) {
        results.push({ campaign_id: c.id, action: "activate", ...(await activateCampaign(admin, c)) });
      }
      const { data: toEnd } = await admin
        .from("sale_campaigns")
        .select("*")
        .eq("status", "active")
        .lte("ends_at", nowIso);
      for (const c of toEnd ?? []) {
        results.push({ campaign_id: c.id, action: "deactivate", ...(await deactivateCampaign(admin, c, "ended")) });
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("sale-campaign-scheduler error", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
