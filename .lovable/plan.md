## Ny lager-regel (opsummeret fra dig)

- Kun **valgte** leverandører må bidrage til lager og pris.
- Er alle valgte leverandører udsolgt → produktet er **udsolgt**.
- Total lager = **den billigste valgte leverandørs lager** (ikke summen). Når den er solgt tomt, hopper vi over til næste billigste og bruger dens lager.
- Formålet: aldrig sælge under indkøbspris fordi en dyrere leverandør har lager.

Eksempel: to valgte leverandører har hver 1 stk. → PIM viser 1 stk. Sælges den, går varen udsolgt indtil næste feed-opdatering; så bliver total = 1 igen fra leverandør 2.

## Bekræftet på 810084698426

DCS-feedet melder i morges 12 stk. Der er *ingen* skjult sammenlægning i det aktuelle recompute — DCS'ens 12 er ægte. Men reglerne skal alligevel skærpes så det aldrig kan blive galt.

## Ændringer

### 1. Ny `recompute_product_stock` (migration)

- Kun leverandører i `stock_sync_supplier_ids` tælles.
- Sortér valgte in‑stock leverandører **billigst først** (ex‑moms indkøbspris).
- Filtrér dem der ikke opfylder `min_sync_margin` (produkt eller globalt default).
- **Total lager = lageret hos den billigste tilbageværende leverandør**, ikke summen.
- Ingen valgte leverandører / alle udsolgte / alle under margin → `stock_quantity = 0`, `stock_status = 'outofstock'`.
- Ingen fallback til uvalgte leverandører — nogensinde.

### 2. `apply_low_margin_guard` (migration)

- Fjern fallback‑grenen der scanner alle in‑stock leverandører når `stock_sync_supplier_ids` er tom/NULL. Tom udvælgelse → guarden gør intet (recompute har allerede sat 0).
- Beholder cheapest‑first walk, men over samme snævre kandidat‑pulje.
- Cap lageret til den billigste sikre leverandørs lager (samme "hop til næste når tom" princip).

### 3. Én‑gangs rebuild efter migration

- Kald `recompute_product_stock` på alle aktive produkter med Shopify‑link, så eventuelle spøgelsestal fra tidligere sum‑logik ryddes.
- `change_source = 'stock-sync'`, så eksisterende auto‑push til Shopify tager de ændrede rækker.

### 4. UI på ProductDetailPage (kun præsentation)

- Under "Lagerstyring" vises pr. valgt leverandør: `navn — X stk. @ pris kr — margin %` med farve for aktiv (bidrager) vs. udsolgt/afvist.
- Badge "Leverandørlager: N stk." forklarer at N er lageret hos den aktive (billigste sikre) kilde, ikke en sum.
- Ingen ændring i knappen "Brug leverandørlager" — den bruger nu det nye tal.

### 5. Verifikation

- Query der lister produkter hvor gammelt `stock_quantity` var større end den nye billigste‑kilde‑værdi (dvs. hvor sum‑logikken oppustede lager). Rapport til dig før Shopify‑køen drænes.
- Spotcheck på 810084698426: efter migration bør stock forblive 12 (DCS er billigste sikre og har 12).

## Teknik

- Rører kun `recompute_product_stock` og `apply_low_margin_guard`. Triggere og queue‑logik uændret.
- `attach_own_stock_supplier` triggeren rører jeg ikke — den er INSERT‑only, og Eget‑lager uden supplier_products‑række bidrager naturligt 0 i den nye logik.
- Bulk‑recompute køres i migrationen med `set_bulk_supplier_import(true)` for at undgå N synkron trigger‑storm; efterfølges af én samlet queue‑poke.