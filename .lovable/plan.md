## Mål
Når et Shopify-produkt har flere varianter (fx UVC-G5-Turret-Ultra Hvid/Sort), skal PIM automatisk have **én master pr. variant** — hver med egen EAN, egen pris, eget lager og egen leverandør-match. Én master = én sælgende enhed. Alle varianter deler samme `shopify_product_id`, men har hver sit `shopify_variant_id`.

## Nuværende problem på G5 Turret Ultra
- Shopify: 2 varianter (Hvid EAN 810084693575, Sort EAN 810084696972).
- PIM: 1 master med Hvid's EAN, men `shopify_variant_id` peger på Sort. Inkonsistent — sync overskriver felter forkert.

## Løsning

### 1. `shopify-pull` — auto-split ved multi-variant
Når Shopify returnerer >1 variant for et produkt vi allerede har som master:
- Behandl den nuværende master som "variant 1" (behold link til dens faktiske variant baseret på EAN-match, ellers første variant).
- For hver ekstra variant: opret en ny master-række med
  - `shopify_product_id` = fælles product-id
  - `shopify_variant_id` = variantens id
  - `title` = "{produkttitel} - {variant-optioner}" (fx "…Turret Ultra - Sort")
  - `ean`, `sku`, `webshop_price`, `sale_price`, `stock_quantity`, `weight_kg`, `image_url` fra variant
  - Kopier `brand`, `category`, `long_description`, `short_description`, `meta_*` fra hoved-master (så SEO/tekst deles).
  - Sæt `shopify_sync_enabled = true`, `lifecycle_status` fra produktet.
- Idempotent: skip variant hvis en master allerede har det `shopify_variant_id`.
- Kør auto-supplier-rematch på nyoprettede masters (som allerede sker ved EAN-set).

### 2. `shopify-update-product` (push) — pr.-variant push
Når PIM opdaterer pris/lager/EAN/vægt/inventoryPolicy for en master med `shopify_variant_id`:
- Push **kun** til dén variant via `productVariantsBulkUpdate` (allerede sådan idag).
- Titel/beskrivelse/SEO/kategori/brand pushes stadig på produkt-niveau — så tekstredigering fra én af søskendevarianterne opdaterer det fælles produkt (uændret adfærd).
- Metafield `custom.shortdescription` er produkt-scope, uændret.

### 3. Meta-sync mellem søskende
Vi har allerede `sync_meta_to_siblings`-triggeren, der spejler `meta_title`/`meta_description` mellem masters med samme `shopify_product_id`. Udvid til også at spejle `short_description`, `long_description`, `brand`, `category` mellem søskende — så tekster ikke divergerer.

### 4. Manuel oprydning på UVC-G5-Turret-Ultra
- Ret den eksisterende master (id `ec1997f3…`) til at være **Hvid**-varianten:
  - `shopify_variant_id` = 54186121822547 (Hvid)
  - `ean` = 810084693575, `sku` = `UVC-G5-Turret-Ultra-white`
  - `webshop_price` = 999
- Opret ny master for **Sort**:
  - `shopify_variant_id` = 54186121855315, `ean` = 810084696972, `sku` = `UVC-G5-Turret-Ultra-b`
  - `title` = "Ubiquiti UniFi Protect G5 Turret Ultra - Sort"
- Kør `shopify-pull` for begge så alle felter fyldes fra Shopify.

### 5. UI-signal
`ProductListPage` og `ProductDetailPage` viser allerede title; tilføj lille badge "Variant" ved siden af titlen hvis `shopify_product_id` deles med anden master (billig `count`-check i `useMasterProducts`). Ingen struktur-ændringer i UI'et.

## Teknisk

**Filer der ændres**
- `supabase/functions/shopify-pull/index.ts` — auto-split logik i variant-løkken.
- Migration — udvid `sync_meta_to_siblings` til `sync_shared_fields_to_siblings` (inkl. descriptions/brand/category, samme guard mod rekursion).
- Data-fix (via `supabase--insert`) på det ene konkrete produkt.
- `src/hooks/use-products.ts` + `src/pages/ProductListPage.tsx` — variant-badge.

**Ikke omfattet**
- Ingen ændringer i `shopify-create-product` (opretter stadig enkelt-variant produkter fra PIM — hvis du vil oprette varianter, sker det direkte i Shopify og trækkes ind).
- Ingen sletning af den eksisterende `product_variants`-tabel — den bruges fortsat som ren pull-cache, men er ikke længere den primære sælgende enhed.
- Ingen ændringer i priser eller Shopify-side data — kun PIM-side spejling.
