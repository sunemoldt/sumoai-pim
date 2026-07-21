## Problem

Produkt `4711636204439` (ASUS Ascent GX10) har kun DCS valgt som lagerkilde blandt de tilknyttede leverandører, men PIM foreslår stadig et samlet lager der inkluderer andre leverandører (fx Kosatec, der ikke er valgt).

Rodårsag: to steder ignorerer den aktive valgte leverandørliste (`stock_sync_supplier_ids`):

1. **UI — `src/pages/ProductDetailPage.tsx` linje 293 (`initPushFields`)**
   Når "Send til Shopify"-fanen åbnes, summeres `stock_quantity` fra ALLE `supplier_products`, ikke kun de valgte lagerkilder. Det er dette tal der forudfyldes i "Antal på lager".

2. **DB — `public.recompute_product_stock` fallback**
   Hvis ingen valgt leverandør passer margin-filteret, falder funktionen tilbage til "sum af alle in-stock leverandører på laveste indkøbspris" — det kan trække ikke-valgte leverandører ind.

## Ændringer

### 1. `src/pages/ProductDetailPage.tsx`
- I `initPushFields`: filtrer `product.supplier_products` gennem `stockSyncSupplierIds` før summering, præcis som stock-anbefalings-badget (linje 1250-1256) allerede gør.
- Hvis ingen leverandør er valgt: brug 0 / eksisterende `product.stock_quantity` (ingen aggregering på tværs). Ingen "fallback til alle".

### 2. Migration — forenkl `public.recompute_product_stock`
- Fjern fallback-blokken der genberegner totalen ud fra `MIN(purchase_price)` på tværs af alle in-stock leverandører.
- Regel bliver enkel: hvis `auto_stock_sync = true` og `stock_sync_supplier_ids` er sat, sum kun stock fra de valgte leverandører der består margin-tjekket. Ellers → 0 / `outofstock`.
- Behold eksisterende trigger-flow og `apply_low_margin_guard`-kaldet uændret.

### 3. UI — fjern "fallback til alle leverandører" i stock-anbefalingen (linje 1249-1253)
- Hvis ingen leverandører er valgt som lagerkilde: vis "Ingen lagerkilde valgt" i stedet for at summere alle tilknyttede.
- Konsistens: både forslags-badget og init-værdien viser nu udelukkende det, brugeren har valgt.

## Ikke ændret
- `apply_low_margin_guard` og `prevent_below_purchase_price` — de arbejder på tværs af leverandører for at beskytte mod negativ avance, hvilket er ønsket.
- Trigger-kaskader og Shopify-push-flow.

## Verifikation
- Kør `recompute_product_stock` for `fbf014d6-3a0a-4f85-9df1-0122a27a6bd0` og bekræft `stock_quantity = 3` (kun DCS).
- Åbn produktsiden → "Send til Shopify": "Antal" forudfyldes med 3, ikke summen inkl. Kosatec.
