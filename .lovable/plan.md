
## Mål
Etablere en præcis sync-arkitektur: hvilke felter er master i PIM vs. Shopify, draft-flow før Shopify-aktivering, samt korrekt understøttelse af varianter og attributter.

---

## Step 1 — Ryd 856963007033 (og lignende rester)

Ved kontrol af `long_description` ligger der stadig fuld Elementor-blok (`data-elementor-type`, `elementor-element …`) fra linje 21 og frem.

- Forbedre `bulk-clean-descriptions` regex så den fjerner:
  - Hele `<div class="elementor-…">…</div>`-blokke (rekursivt, balancerede tags)
  - `data-elementor-*`, `data-id`, `data-element_type`, `data-widget_type`, `wpc-filter-*` attributter
  - WP-shortcodes `[…]`
  - `&nbsp;` sekvenser, tomme `<p></p>`/`<div></div>`
- Kør på alle Shopify-synkede produkter igen og log diff i `product_change_log`.
- Push renset HTML til Shopify (kun for de produkter der faktisk ændres) — Shopify er master, men kun når PIM-rensning er en ren oprydning, ikke et indholdsændring.

---

## Step 2 — Master-field policy (PIM ↔ Shopify)

Ny tabel `field_sync_policy`:

```text
field_name (text PK)      -- 'webshop_price', 'sale_price', 'weight', 'purchase_price',
                          --  'ean', 'sku', 'title', 'short_description',
                          --  'long_description', 'stock_quantity', 'attributes', …
master         text       -- 'pim' | 'shopify'
direction      text       -- 'push' | 'pull' | 'two_way' | 'off'
updated_at     timestamptz
```

Defaults der matcher nuværende politik:
- `title`, `short_description`, `long_description`, `meta_*`  → master = **shopify** (pull til PIM)
- `webshop_price`, `sale_price`, `stock_quantity`, `backorders_allowed`  → master = **pim** (push til Shopify)
- `purchase_price`, `ean`, `sku`, `weight`, `attributes`, `brand`, `category` → master = **pim**

UI: ny side `Indstillinger → Sync-felter` med tabel: felt | master (PIM/Shopify) | retning. Gemmes eksplicit (ingen auto-save).

Edge functions opdateres til at konsultere `field_sync_policy`:
- `shopify-import` (pull): kun felter med master=shopify overskriver PIM-værdier; resten ignoreres.
- `shopify-update-product` / `scheduled-sync` (push): kun felter med master=pim sendes til Shopify.

---

## Step 3 — Draft-flow

Tilføj kolonne `master_products.lifecycle_status` text default `'active'` med værdier:
- `draft` — kun i PIM, sendes ikke til Shopify
- `pending_activation` — oprettet i Shopify som DRAFT (Shopify status=DRAFT), venter på manuel aktivering
- `active` — fuldt synket

Flow:
1. Bruger opretter produkt i PIM → `draft`. Ingen Shopify-kald.
2. Bruger trykker "Send til Shopify" → ny edge function `shopify-create-product` opretter produkt + varianter med `status: DRAFT` i Shopify, sætter PIM til `pending_activation` og gemmer `shopify_product_id`/`shopify_variant_id`.
3. Bruger aktiverer i Shopify-admin (status → ACTIVE). Næste sync (eller webhook) detekterer ACTIVE og sætter PIM → `active`.
4. `shopify-update-product` springer over hvis lifecycle = `draft` (intet at opdatere endnu).

UI: ProductListPage får filter på lifecycle, ProductDetailPage viser badge + knappen "Send til Shopify (kladde)" / "Genaktiver".

---

## Step 4 — Varianter (master + varianter)

Ny tabel `product_variants`:

```text
id uuid PK
master_product_id uuid -> master_products(id) ON DELETE CASCADE
sku text
ean text
shopify_variant_id text
purchase_price numeric
webshop_price numeric
sale_price numeric
stock_quantity int
weight numeric
attributes jsonb        -- variant-specifik (fx {"color":"sort","size":"M"})
position int
created_at, updated_at
```

`master_products` bliver "parent": når der er rækker i `product_variants`, tolkes produktet som variabelt (Shopify product med variants). Ellers single-variant (eksisterende felter på master bruges).

Oprettelses-UI:
- ProductDetailPage får en "Varianter"-tab: tilføj/rediger/slet rækker med pris, lager, EAN, attributter.
- Ved "Send til Shopify" mappes varianter → Shopify `productVariantsBulkCreate`.

Sync-import: `shopify-import` opdateres til at hente alle varianter (ikke kun første) og upserte i `product_variants`.

---

## Step 5 — Attributter (Længde, Farve, …)

Ny tabel `attribute_definitions`:

```text
id uuid PK
key text UNIQUE       -- 'length', 'color', 'material'
label text            -- 'Længde', 'Farve'
unit text             -- 'mm', null
type text             -- 'text' | 'number' | 'select'
options jsonb         -- ['Sort','Hvid','Rød'] for select
is_variant_axis bool  -- om den bruges som variant-akse
created_at
```

Seedes via migration ud fra `master_products.attributes` (jsonb): aggreger alle eksisterende keys, gæt type, opret rækker — så det matcher det der allerede er i databasen.

UI:
- `Indstillinger → Attributter` til at tilføje/redigere definitioner.
- ProductDetailPage Attributter-tab bruger definitionerne (dropdown for select, number-input m. unit, osv.).

---

## Tekniske noter

- Migrationer: 5 stk. (policy, lifecycle, variants, attribute_defs, attribute seed).
- Eksisterende `master_products.attributes` jsonb beholdes som "produkt-attributter på parent". Variant-attributter ligger i `product_variants.attributes`.
- Alle nye tabeller får RLS-policies der matcher mønstret (authenticated read/write, service_role full).
- `field_sync_policy` cacheres i edge functions (læs én gang pr. invocation).
- Ingen brydende ændringer for nuværende sync — defaults bevarer status quo.

---

## Foreslået rækkefølge
1. **Step 1** alene først (lille, isoleret, fixer det konkrete produkt).
2. **Step 2 + Step 3** sammen (policy + lifecycle hænger sammen i UI).
3. **Step 5** (attribut-definitioner — fundament for varianter).
4. **Step 4** (varianter — størst, bygger på attributter).

Sig til hvis rækkefølgen passer, eller om jeg skal starte direkte med fx Step 1 + Step 2 nu.
