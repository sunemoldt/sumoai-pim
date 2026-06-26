
# Partner-ads produktfeed (selvbygget)

Erstatter Avecdo/Multifeeds med et XML-feed i Google Shopping-stil, leveret via en fast offentlig URL. Feedet caches som fil i Storage og kan regenereres natligt eller manuelt.

## 1. Database

Migration tilføjer på `master_products`:
- `exclude_from_feeds boolean default false` — pr. produkt opt-out (kan udvides senere til specifikke feeds via jsonb hvis du får flere kanaler).

Ny tabel `feed_runs` (audit/status):
- `id`, `feed_key text` (fx `partner-ads`), `status`, `product_count int`, `file_path text`, `file_size_bytes int`, `error text`, `started_at`, `finished_at`.

Storage bucket `product-feeds` (public read) til de genererede XML-filer. Fast sti: `product-feeds/partner-ads.xml` → stabil URL til Partner-ads.

## 2. Edge functions

**`generate-partner-ads-feed`** (verify_jwt=false)
- Henter alle `master_products` hvor `lifecycle_status <> 'draft'` og `exclude_from_feeds = false`.
- Bygger Google Shopping-kompatibel XML (RSS 2.0 + `g:`-namespace), ét `<item>` pr. produkt:
  - `g:id` = EAN (eller intern id hvis EAN mangler)
  - `title`, `description` (long_description, HTML-strippet), `link` (Shopify handle URL), `g:image_link`, `g:brand`, `g:gtin` (EAN), `g:mpn` (SKU), `g:product_type` (category), `g:price` (webshop_price inkl. moms DKK), `g:sale_price` (hvis sat), `g:availability` (in stock / out of stock / preorder afhængig af `stock_status` + `backorder_policy`), `g:condition` = new, `g:shipping_weight` (weight_kg kg).
- Uploader resultatet til `product-feeds/partner-ads.xml` (overskriver).
- Logger til `feed_runs`.
- Returnerer `{ url, product_count, size }`.

**`partner-ads-feed`** (verify_jwt=false, GET)
- Streamer den cachede fil fra Storage med `Content-Type: application/xml; charset=utf-8`.
- Hvis filen mangler → kalder generator inline.
- Dette giver dig en pæn URL: `https://<project>.functions.supabase.co/partner-ads-feed` som du giver til Partner-ads. (Storage public URL virker også, men funktion gør det nemt at tilføje headers/redirect/UTM senere uden at flytte URL.)

## 3. Cron

`pg_cron` job kl. 02:15 UTC kalder `generate-partner-ads-feed` (samme mønster som nightly-backup). Tilføjes via `supabase--insert`-tool.

## 4. UI

Ny sektion på Indstillinger/Integrationer-siden: **"Partner-ads feed"**
- Viser feed-URL med kopiér-knap.
- Viser sidste kørsel fra `feed_runs` (tidspunkt, antal produkter, status).
- Knap **"Regenerér nu"** → kalder `generate-partner-ads-feed`.
- Link til de seneste 10 kørsler.

Pr. produkt (ProductDetailPage, sektion ved sync-indstillinger):
- Switch **"Ekskluder fra affiliate-feeds"** → toggler `exclude_from_feeds`.

Produktlisten: nyt filter-chip **"Ekskluderet fra feeds"** så du kan finde dem hurtigt.

## 5. Lagerstatus-mapping

| PIM-tilstand | `g:availability` |
|---|---|
| `instock` + qty > 0 | `in stock` |
| `outofstock` + `backorder_policy = yes` | `preorder` |
| Alt andet | `out of stock` |

## 6. Hvad jeg IKKE bygger (medmindre du beder om det)
- Multi-feed-konfiguration (flere affiliate-partnere) — kun `partner-ads` nu, men strukturen (`feed_key`, bucket-sti) er forberedt.
- UTM/tracking på URL'er — du valgte ren URL.
- Variant-niveau items (hver variant som eget `<item>`) — vi sender master-produktet; kan tilføjes hvis Partner-ads kræver det.

Sig til hvis jeg skal justere noget, ellers implementerer jeg planen som beskrevet.
