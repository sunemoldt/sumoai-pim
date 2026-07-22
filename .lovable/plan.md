
## Mål
Fjerne oversættelsesmodulet fra PIM — kun dansk bruges. Ingen UI, hooks, edge functions eller database-rester tilbage.

## Ændringer

### UI
- **`src/pages/ProductDetailPage.tsx`**: fjern import af `ProductTranslationsTab`, fjern faneknappen "Oversættelser" (`TabsTrigger value="translations"`) og det tilhørende `TabsContent`.
- **`src/pages/SettingsPage.tsx`**: fjern import og render af `<LanguageSettingsCard />`.
- **Slet filer**:
  - `src/components/ProductTranslationsTab.tsx`
  - `src/components/LanguageSettingsCard.tsx`
  - `src/hooks/use-translations.ts`

### Backend / database
- **Migration**: `DROP TABLE public.product_translations CASCADE;` (fjerner også RLS-policies).
- Fjern `"product_translations"` fra tabel-listen i `supabase/functions/nightly-backup/index.ts`, så backup ikke fejler.
- Tjek om der findes en `translate-product` edge function; hvis ja, slettes den (ingen fundet i første scan, verificeres under implementering).

### Verifikation
- Build passerer uden ubrugte imports.
- Produktdetalje viser ikke længere "Oversættelser"-fanen.
- Indstillinger viser ikke længere sprogkort.
- Natlig backup kører uden reference til slettet tabel.

## Ikke omfattet
- Sidebar/nav (der er ingen top-level "Oversættelser"-menu).
- Shopify-flow (ingen oversættelser sendes i dag).
