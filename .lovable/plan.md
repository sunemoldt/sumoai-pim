## Mål

1. Tilføj **vægt (kg)** på produkter i PIM, synk til Shopify, læs fra leverandørfeeds. Felt er valgfrit — hvis tomt, sendes **1 kg** til Shopify.
2. Udvid **restordre** fra boolean til 3 valgmuligheder, og map korrekt til Shopify `inventoryPolicy`:
   - Nej → `DENY`
   - Ja → `CONTINUE`
   - Ja, med besked → `DENY` (må ikke sælges ved udsolgt; "besked" håndteres via Shopifys "Notify me when available", ikke salg)

## Database

Migration:
- `master_products`: tilføj `weight_kg numeric` (nullable), tilføj `backorder_policy text` (`'no' | 'yes' | 'notify'`, default `'no'`).
  - Backfill `backorder_policy` ud fra eksisterende `backorders_allowed` (true → `'yes'`, false → `'no'`).
  - Behold `backorders_allowed` indtil videre (bruges af triggers/queue) — opdater triggeren `auto_enqueue_shopify_update` til også at lytte på `backorder_policy` og `weight_kg`.
- `supplier_products`: tilføj `weight_kg numeric` (nullable).
- `product_variants`: tilføj `weight_kg numeric` (nullable) så varianter kan have egen vægt.
- Tilføj kolonner til whitelists i `revert_change_log_entry` (`weight_kg` numeric, `backorder_policy` text).

## Backend (edge functions)

**shopify-update-product / shopify-create-product**
- Læs `weight_kg` (fallback `1`) og send som variant weight (`inventoryItem.measurement.weight { value, unit: KILOGRAMS }` via GraphQL, eller `weight`/`weight_unit` på REST variant — brug samme API som filen allerede bruger).
- Erstat `toInventoryPolicy(backorders)` så den mapper:
  - `'yes'` → `CONTINUE`
  - `'no' | 'notify'` → `DENY`
- Acceptér både gammel (`'yes'|'no'|'notify'`) og nyt felt `backorder_policy` i payload.
- Inkludér `weight_kg` og `backorder_policy` i `auto_enqueue_shopify_update`-triggerens changed-fields detektion.

**shopify-pull / shopify-import**
- Læs variant weight fra Shopify og skriv til `weight_kg` (kun hvis feltet er tomt i PIM, ellers respektér field_sync_policy).
- Map `inventoryPolicy === 'CONTINUE'` → `backorder_policy = 'yes'`, ellers `'no'` (kan ikke skelne `notify` fra Shopify).

**Leverandørimport (`supplier-feed-import`, `wc-import`, Aurdel)**
- Tilføj `weight_kg` til felt-mapping (CSV/XML kolonne → `supplier_products.weight_kg`).
- Ved match til master: hvis `master_products.weight_kg` er tom, kopier fra billigste/primære leverandør.

## Frontend

**ProductDetailPage**
- Nyt input "Vægt (kg)" (decimal, valgfri, placeholder "1.0 (standard hvis tom)").
- Erstat checkbox "Restordre tilladt" med RadioGroup/Select med 3 valg:
  - Nej (kan ikke købes når udsolgt)
  - Ja (kan købes når udsolgt)
  - Ja, med besked (vis "Giv mig besked"-knap i Shopify, kan ikke købes)

**ProductListPage / ProductCard**
- Vis vægt i evt. detaljevisning (read-only).

**NewProductPage**
- Tilføj `weight_kg`-felt og restordre-valg ved oprettelse.

**SupplierMappingDialog / feed preview**
- Tilføj `weight_kg` til liste af mappable felter.

**FieldSyncPolicyCard**
- Tilføj `weight_kg` og `backorder_policy` til policy-listen.

## Tekniske noter

- Behold `backorders_allowed` som beregnet view i koden: `backorders_allowed = backorder_policy === 'yes'`. Den bruges fortsat af triggere indtil migrering er færdig.
- Stripping af leading zeros mv. rører vi ikke. EAN-logik uændret.
- Vægt valideres ≥ 0; tom = NULL = "1 kg ved push".
