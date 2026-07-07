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
      await admin
        .from("master_products")
        .update({ sale_price: cp.original_sale_price })
        .eq("id", mp.id);
      reverted++;
    }

    await admin
      .from("sale_campaign_products")
      .update({ reverted_at: new Date().toISOString() })
      .eq("id", cp.id);
  }

  await admin
    .from("sale_campaigns")
    .update({ status: finalStatus, deactivated_at: new Date().toISOString() })
    .eq("id", campaign.id);

  return { reverted };
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
