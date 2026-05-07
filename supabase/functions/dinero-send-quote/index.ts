import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { quote_id } = await req.json();
    if (!quote_id) return new Response(JSON.stringify({ error: "quote_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const apiKey = Deno.env.get("DINERO_API_KEY");
    const orgId = Deno.env.get("DINERO_ORGANIZATION_ID");
    if (!apiKey || !orgId) {
      return new Response(JSON.stringify({ error: "Dinero credentials not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: quote, error: qErr } = await admin.from("quotes").select("*").eq("id", quote_id).single();
    if (qErr || !quote) throw new Error(qErr?.message || "Quote not found");

    const { data: lines, error: lErr } = await admin.from("quote_lines").select("*").eq("quote_id", quote_id).order("sort_order");
    if (lErr) throw lErr;

    const invoiceLines = (lines ?? []).map((l: any) => ({
      productGuid: null,
      description: l.product_name || "Produkt",
      quantity: Number(l.quantity) || 1,
      accountNumber: 1000,
      unit: "parts",
      discount: 0,
      lineType: "Product",
      accountName: null,
      baseAmountValue: Number(l.quote_price) || 0,
    }));

    const payload: any = {
      currency: "DKK",
      language: "da-DK",
      date: quote.quote_date,
      paymentConditionNumberOfDays: quote.valid_days ?? 30,
      paymentConditionType: "Netto",
      contactGuid: quote.dinero_contact_guid || null,
      description: quote.note_internal || `Tilbud ${quote.quote_number}`,
      comment: quote.note_customer || "",
      productLines: invoiceLines,
    };

    // Dinero uses OAuth2: exchange API key for access token first
    const tokenRes = await fetch("https://authz.dinero.dk/dineroapi/oauth/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${apiKey}:${apiKey}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=password&scope=read%20write&username=${encodeURIComponent(apiKey)}&password=${encodeURIComponent(apiKey)}`,
    });
    const tokenBody = await tokenRes.text();
    if (!tokenRes.ok) {
      return new Response(JSON.stringify({ error: "Dinero auth error", status: tokenRes.status, body: tokenBody }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const accessToken = JSON.parse(tokenBody).access_token;

    const url = `https://api.dinero.dk/v1/${orgId}/invoices`;
    const dineroRes = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const dineroBody = await dineroRes.text();
    if (!dineroRes.ok) {
      return new Response(JSON.stringify({ error: "Dinero API error", status: dineroRes.status, body: dineroBody }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let dineroJson: any = {};
    try { dineroJson = JSON.parse(dineroBody); } catch {}
    const voucherGuid = dineroJson.Guid || dineroJson.guid || dineroJson.VoucherGuid || null;

    await admin.from("quotes").update({ dinero_voucher_guid: voucherGuid, status: "sent" }).eq("id", quote_id);

    return new Response(JSON.stringify({ success: true, voucherGuid, organizationId: orgId, dinero: dineroJson }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
