## Mål
Tilføj en "Kategorier" (Shopify Collections) sektion i PIM, hvor Shopify er master. Produkter kan tilknyttes/afknyttes collections i PIM, og ændringer synces begge veje.

## Omfang

### 1. Database
Ny tabel `shopify_collections`:
- `id` (uuid), `shopify_collection_id` (text, unique), `handle`, `title`
- `description_html`, `meta_title`, `meta_description`
- `collection_type` ('custom' | 'smart'), `products_count`, `image_url`
- `last_shopify_sync_at`, `created_at`, `updated_at`

Ny join-tabel `master_product_collections`:
- `master_product_id` (fk → master_products), `collection_id` (fk → shopify_collections)
- `created_at`, unique(master_product_id, collection_id)
- Kun for "custom collections" (smart collections styres af Shopify's regler — read-only i PIM)

Grants + RLS (authenticated read/write, service_role all).

### 2. Edge Functions
- `shopify-collections-pull`: henter alle collections via GraphQL (`collections` query) med metafields for SEO. Upsert til `shopify_collections`. Henter også produkt-medlemskaber og synkroniserer `master_product_collections`.
- `shopify-collections-update`: pusher ændringer af collection metadata (description, SEO) tilbage til Shopify via `collectionUpdate`.
- `shopify-collection-add-product` / `remove-product`: `collectionAddProducts` / `collectionRemoveProducts` mutationer. Tilføjer/fjerner et produkt fra en custom collection.

### 3. UI
- Ny sidebar-menupunkt "Kategorier" → `/collections`
- `CollectionsListPage`: liste med søgning, antal produkter, type-badge (custom/smart), sidste sync
- `CollectionDetailPage`: rediger description/meta title/meta description (custom collections), vis produktliste, tilføj/fjern produkter (kun custom). Smart = read-only.
- Knap "Sync fra Shopify" (kalder pull-funktion).
- På `ProductDetailPage`: ny tab/sektion "Kategorier" med multi-select checkbox-liste over custom collections. Ændringer kalder add/remove edge functions med det samme.

### 4. Sync-strategi
- **Shopify → PIM (pull)**: manuel knap + tilføj til nightly `scheduled-sync` (én gang dagligt).
- **PIM → Shopify (push)**: ved manuel redigering af collection-metadata eller produkt-tilknytning.
- Smart collections: `products_count` og produkt-medlemskab pulles kun; PIM viser dem men lader ikke brugeren redigere medlemskab (Shopify styrer via regler).
- Field sync policy udvides med `collection_description`, `collection_meta_title`, `collection_meta_description` (master='shopify', direction='two_way').

### 5. Tekniske detaljer
- Shopify GraphQL: `collections(first: 250, after: $cursor) { nodes { id handle title descriptionHtml seo { title description } sortOrder ruleSet { rules } products(first: 250) { nodes { id } } } }` med paginering.
- Reuse `shopifyGraphql` helper-mønster fra `shopify-update-product`.
- Rate limit: hent i batches af 50 collections, throttle 500ms.

## Filer der oprettes
- `supabase/functions/shopify-collections-pull/index.ts`
- `supabase/functions/shopify-collections-update/index.ts`
- `supabase/functions/shopify-collection-add-product/index.ts`
- `supabase/functions/shopify-collection-remove-product/index.ts`
- `src/pages/CollectionsListPage.tsx`
- `src/pages/CollectionDetailPage.tsx`
- `src/components/ProductCollectionsTab.tsx` (til ProductDetailPage)
- Migration for de to nye tabeller + RLS/grants
- Routes i `App.tsx`, sidebar-entry i `AppSidebar.tsx`

## Spørgsmål inden implementering
Ingen — planen dækker det du beskrev. Sig til hvis du vil ændre noget (fx om smart collections skal være helt skjult eller vises som read-only).
