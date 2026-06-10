## Mål

Sikre at Del 2 (salgs-modregning fra Shopify) er driftsikker før den aktiveres. Tre konkrete fixes — den første er kritisk, de to andre er hardening.

---

## Fix 1 (kritisk) — Atomar stock-decrement via SQL-funktion

**Problem:** `sb.rpc("set_change_source", ...)` efterfulgt af `sb.from("master_products").update(...)` kører på to forskellige PostgREST-requests og typisk to forskellige PgBouncer-connections. Session-GUC'en `app.change_source` overlever ikke skiftet → triggeren `auto_enqueue_shopify_update` ser kilden som `'manual'` og kø-lægger en push tilbage til Shopify → sync-loop eller overskrivning af Shopifys egen lagerværdi.

**Løsning:** Migration der opretter en SECURITY DEFINER funktion som sætter GUC og opdaterer rækken i **samme transaktion**:

```sql
CREATE OR REPLACE FUNCTION public.decrement_stock_from_shopify_order(
  p_master_product_id uuid,
  p_qty integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old integer;
  v_new integer;
  v_auto boolean;
  v_lifecycle text;
BEGIN
  SELECT stock_quantity, auto_stock_sync, lifecycle_status
  INTO v_old, v_auto, v_lifecycle
  FROM master_products WHERE id = p_master_product_id FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('skipped','not_found'); END IF;
  IF v_auto THEN RETURN jsonb_build_object('skipped','auto_stock_sync'); END IF;
  IF v_lifecycle = 'draft' THEN RETURN jsonb_build_object('skipped','draft'); END IF;

  v_new := GREATEST(COALESCE(v_old,0) - p_qty, 0);

  PERFORM set_config('app.change_source', 'shopify-order', true); -- local = same txn
  UPDATE master_products
  SET stock_quantity = v_new,
      stock_status = CASE WHEN v_new > 0 THEN 'instock' ELSE 'outofstock' END,
      updated_at = now()
  WHERE id = p_master_product_id;

  RETURN jsonb_build_object('decremented', p_qty, 'old', v_old, 'new', v_new);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decrement_stock_from_shopify_order(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_stock_from_shopify_order(uuid, integer) TO service_role;
```

Bemærk: `set_config(..., true)` (local) er nu trygt fordi UPDATE sker i samme transaktion.

**Edge function ændring** (`shopify-order-webhook/index.ts`): erstat blokken der gør `rpc("set_change_source")` + `update(...)` med ét `sb.rpc("decrement_stock_from_shopify_order", { p_master_product_id, p_qty })`-kald. Tolk returobjektet til `lineResults`.

---

## Fix 2 — Atomar idempotens (race-fix)

**Problem:** `select` + `insert` i `shopify_processed_orders` er ikke atomar. To samtidige Shopify-retries kan begge passere check'et.

**Løsning:** Skift rækkefølge — forsøg at **claime ordren først** via insert med `on conflict do nothing`, og fortsæt kun hvis claim'et lykkedes:

```ts
const { data: claim } = await sb
  .from("shopify_processed_orders")
  .insert({ order_id: orderId, shopify_order_number: orderNumber, line_count: lineItems.length, total_decremented: 0 })
  .select("order_id")
  .maybeSingle();

if (!claim) return json({ skipped: "duplicate", order_id: orderId });
```

Derefter kør line-loop og afslut med en `update` af samme række (sæt `total_decremented` og `raw`).

Skip-cases (`no_cutoff_configured`, `before_cutoff`) flyttes til separat tabel eller får `skipped_reason` sat samtidig med claim'et — for at undgå at en gyldig replay efter cutoff-konfiguration bliver fejlagtigt blokeret af en tidligere skip-række, ændres PK fra `order_id` til `(order_id, skipped_reason IS NULL)` er overkill — i stedet: lad skip-rækker have `total_decremented = 0` og `skipped_reason != null`, og lad claim-step kun blokere når `skipped_reason IS NULL` (= ægte processing). Implementeres som: skip-cases bruger separat `shopify_skipped_orders` tabel, så `shopify_processed_orders` udelukkende repræsenterer "denne ordre er trukket fra lager".

---

## Fix 3 — Validér `variant_id`

**Problem:** `variantId` interpoleres direkte i `.or(...)`-streng. Ikke SQL-injection, men ikke-numeriske værdier giver tavse fejl.

**Løsning:** I edge function:

```ts
if (!variantId || !/^\d+$/.test(variantId)) {
  lineResults.push({ variant_id: variantId, skipped: "invalid_variant_id" });
  continue;
}
```

---

## Rækkefølge

1. Migration: ny funktion `decrement_stock_from_shopify_order` + ny tabel `shopify_skipped_orders` (med GRANTs og RLS).
2. Edge function `shopify-order-webhook` opdateres til at bruge RPC'en, atomar claim, variant_id validering, og skip-tabel for cutoff/duplicate.
3. Test: lokal curl mod edge function med fake order payload (før cutoff, efter cutoff, duplicate, ukendt variant, auto_stock_sync produkt) — verificér at `shopify_update_queue` IKKE får en ny række efter en gyldig decrement.

---

## Hvad der ikke ændres

- Aktiveringsflow i Settings (`ShopifyOrderSyncCard`) — ingen ændring.
- `shopify-register-webhook` — ingen ændring.
- HMAC-verifikation — beholdes som den er (fallback til `SHOPIFY_CLIENT_SECRET` er korrekt for Admin-API-oprettede webhooks).
- `set_change_source` i `shopify-pull` og `mcp-server` — samme latente issue, men begge bruger kilder der ikke trigger push-tilbage, så ingen praktisk effekt. Noteres men røres ikke nu.

---

## Risiko

Lav. Migrationen tilføjer kun ny funktion + ny tabel. Edge function-ændringen er begrænset til én fil og deaktiveret indtil brugeren trykker "Aktivér" i Settings.
