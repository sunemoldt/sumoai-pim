# Tilbudskampagner (bulk)

Muligheden for at oprette en kampagne, tilføje flere produkter, sætte en procentrabat og en start/slutdato. Aktivering og deaktivering sker automatisk i baggrunden.

## Datamodel

Ny tabel `sale_campaigns`:
- `name` (tekst)
- `discount_percent` (numerisk, 0–90)
- `starts_at`, `ends_at` (timestamptz)
- `status` (`scheduled` | `active` | `ended` | `cancelled`)
- `overwrite_existing_sale` (boolean — checkbox ved oprettelse)
- `activated_at`, `deactivated_at` (til logning)

Ny tabel `sale_campaign_products`:
- `campaign_id`, `master_product_id`
- `original_sale_price` (snapshot af `sale_price` inden aktivering — bruges til at gendanne ved slut)
- `applied_sale_price` (den beregnede kampagnepris)
- `applied_at`, `reverted_at`, `skipped_reason`

RLS + GRANTs som resten af projektet (authenticated + service_role).

## Beregning

`applied_sale_price = round(webshop_price × (1 − discount_percent/100), 2)` — ingen prisrunding (som valgt). Beregnes per produkt ved aktivering, så nye webshop_price-ændringer i kampagneperioden ikke automatisk ompriser (fastfrosset ved start).

## Aktivering / deaktivering

Ny edge function `sale-campaign-scheduler` (verify_jwt=false), kaldt af `pg_cron` hvert 5. minut:

1. **Aktivér** kampagner hvor `status='scheduled'` og `starts_at ≤ now()`:
   - For hvert produkt: hvis `sale_price` allerede sat og `overwrite_existing_sale=false` → skip (log `skipped_reason='had_manual_sale'`)
   - Ellers: snapshot nuværende `sale_price` → `original_sale_price`, sæt ny `sale_price` = beregnet pris
   - Sæt `change_source = 'sale-campaign'` så eksisterende trigger enqueuer Shopify-push
   - Kampagne → `status='active'`
2. **Deaktivér** kampagner hvor `status='active'` og `ends_at ≤ now()`:
   - Restore `sale_price` = `original_sale_price` (kan være NULL) for hvert produkt hvor `sale_price` = `applied_sale_price` (undgå at overskrive hvis en bruger har rettet i mellemtiden)
   - Kampagne → `status='ended'`

Tilføj også manuelle `activate`/`deactivate`/`cancel` actions i UI der kalder samme function med explicit `campaign_id`.

## UI

Ny route `/campaigns`:
- **Liste**: alle kampagner med status-badge, periode, rabat%, antal produkter, aktivér/pause/annullér
- **Editor** (`/campaigns/new`, `/campaigns/:id`):
  - Felter: navn, rabat%, start-dato, slut-dato, checkbox "Overskriv produkter der allerede er på tilbud"
  - Produkt-picker: søgning (title/EAN/brand/SKU) + filter (brand, kategori, "kun på lager"), tilføj/fjern
  - Preview-tabel: titel, webshop_price, beregnet kampagnepris, evt. eksisterende sale_price + advarsel hvis den vil blive sprunget over
- Sidebar-link "Kampagner" i `AppSidebar`

Ingen ændringer i `ProductCard`/`ProductListPage` denne omgang (dedikeret editor valgt).

## Filer

**Ny**
- Migration: `sale_campaigns`, `sale_campaign_products` (+ GRANTs, RLS, `updated_at`-trigger)
- `supabase/functions/sale-campaign-scheduler/index.ts`
- pg_cron schedule (insert via data-tool, ikke migration)
- `src/pages/CampaignListPage.tsx`
- `src/pages/CampaignEditorPage.tsx`
- `src/hooks/use-campaigns.ts`
- `src/components/CampaignProductPicker.tsx`

**Ændret**
- `src/App.tsx` (routes)
- `src/components/AppSidebar.tsx` (nav-link)
- Regenereret `src/integrations/supabase/types.ts` (auto)

## Kanttilfælde

- Produkt slettet mellem oprettelse og aktivering → skip + log
- Kampagne redigeret efter aktivering → kun `name`/`ends_at` må ændres (rabat% og produkter låses); ny rabat kræver ny kampagne
- Overlappende kampagner på samme produkt → seneste aktive kampagne vinder ved aktivering (bruger advares i editor hvis produkt allerede indgår i anden aktiv/planlagt kampagne)
- Shopify-push håndteres automatisk via `auto_enqueue_shopify_update` triggeren når `sale_price` ændres