## Problem

Skærmbillederne viser to metafields på produktet i Shopify:

- `custom.shortdescription` (uden underscore) → indeholder den lange beskrivelse. **Det er dette felt dit tema faktisk renderer øverst på produktsiden.**
- `custom.short_description` (med underscore) → er det felt vores PIM-sync skriver til. Dit tema ignorerer det.

Derfor "sker der ingenting": vores opdateringer lander i det rigtige felt teknisk set, men i det forkerte metafelt i forhold til hvad dit Shopify-tema læser. Storefront'en har derfor stadig den gamle (lange) tekst.

Samme problem ramte oprindeligt migreringen fra WooCommerce: WC's excerpt blev importeret ind i `custom.shortdescription`, men vores kode arbejder med `custom.short_description`.

## Løsning

Ret metafield-nøglen i alle edge functions til `shortdescription` (det tema-læste felt), og kør en backfill der kopierer PIM's `short_description` ind i det korrekte metafelt for alle Shopify-synkede produkter. Det gamle `short_description`-metafelt lades urørt (ingen sletning — sikkert rollback muligt).

### Ændringer

1. **`supabase/functions/shopify-update-product/index.ts`**
   - Metafield-mutation: `key: "short_description"` → `key: "shortdescription"` (namespace `custom` uændret).

2. **`supabase/functions/shopify-create-product/index.ts`**
   - Samme ændring i `productCreate`-metafields-blokken.

3. **`supabase/functions/shopify-pull/index.ts`**
   - GraphQL-query og mapping: læs fra `custom.shortdescription` i stedet for `custom.short_description`, så vi henter det tema-relevante felt ved pull/backfill.

4. **Backfill for eksisterende produkter**
   - Genbrug den eksisterende "Genskub kort beskrivelse + SEO"-knap i `ShopifyPage.tsx` (ingen UI-ændring).
   - Efter kode-ændringen kører den nu automatisk push til `custom.shortdescription` for alle ~571 Shopify-produkter.

5. **Verifikation**
   - Kør backfill.
   - Hent UCG-ULTRA direkte fra Shopify GraphQL og bekræft at `custom.shortdescription` nu matcher PIM's korte beskrivelse.
   - Bed dig genindlæse produktsiden for at bekræfte visuelt.

### Ikke omfattet (bevidst)

- Vi rører **ikke** ved det gamle `custom.short_description`-metafelt — det bliver liggende urørt som backup, kan slettes manuelt senere hvis ønsket.
- Ingen tema-ændringer nødvendige.
- Ingen ændringer i PIM-UI eller database-skema.

### Teknisk note

Både create og update bruger allerede `metafieldsSet`-mønstret (upsert), så eksisterende `custom.shortdescription`-værdier bliver overskrevet uden konflikter. Retry-logikken og `dbValueIfQueued`-helperen fra sidste tur er stadig aktive og påvirkes ikke.
