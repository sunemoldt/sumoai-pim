# Tilføj TXT (semikolon-separeret) som leverandør-feed-type

Filen fra leverandøren er reelt en CSV med semikolon-separator, kolonnerne `Varenummer;Producentens Varenummer;EAN/UPC;Pris;Lager`, citerede felter og komma som decimaltegn — bare gemt som `.txt`. Import-motoren håndterer allerede det format (semikolon, `"`-fjernelse, komma→punktum, EAN med foranstillede nuller strippes). Der mangler kun at kunne **vælge** typen ved oprettelse/redigering af leverandøren, så uploadet fil bliver behandlet korrekt.

## Ændringer

### 1. `src/components/SupplierFormDialog.tsx`
- Tilføj `TXT (semikolon-separeret)` som valg i feed-type dropdown (`<SelectItem value="txt">`).
- Fil-upload `<input accept>` inkluderer allerede `.txt` — ingen ændring.
- URL/upload-blokken vises allerede for alt der ikke er `manual/api/ftp`, så txt får samme UI som csv/xml.

### 2. `src/pages/SupplierListPage.tsx`
- Tilføj `txt: "TXT Feed"` i `feedTypeLabels`.

### 3. `supabase/functions/supplier-feed-import/index.ts`
- I else-grenen (linje 421) er logikken `if xml → parseXml else parseCsv`. Behold — `txt` falder automatisk i CSV-grenen med `;` som default-delimiter. **Ingen ændring nødvendig**, men jeg tilføjer en kommentar der eksplicit nævner `txt` for fremtidig læsbarhed.

### 4. `supabase/functions/supplier-feed-preview/index.ts`
- Samme: preview'et defaulter alt ikke-xml/ftp/api til CSV-parsing, så mapping-dialogen fungerer for txt. Ingen kode-ændring.

## Efter deploy — hvordan leverandøren opsættes

1. Opret leverandør → feed-type **TXT (semikolon-separeret)**.
2. Upload `.txt`-filen (eller angiv URL).
3. Åbn **Mapping** og sæt:
   - `EAN/UPC` → `ean`
   - `Pris` → `purchase_price`
   - `Lager` → `stock_quantity`
   - `Varenummer` → `sku` (valgfri)
4. Valuta = DKK (priserne er i DKK ekskl. moms som forventet).
5. Kør synkronisering.

## Filer der ændres
- `src/components/SupplierFormDialog.tsx`
- `src/pages/SupplierListPage.tsx`
- `supabase/functions/supplier-feed-import/index.ts` (kun kommentar)

## Filer der IKKE ændres
- Import-parser, preview-funktion, storage-bucket (accepterer allerede alle filtyper).
