# Dupliker tilbud

Tilføj en handling til hver række på **Tilbud**-siden, så et eksisterende tilbud kan kopieres og bruges som udgangspunkt for et nyt.

## UI
- Ny kolonne "Handling" yderst til højre i tabellen på `src/pages/QuoteListPage.tsx`.
- Ikon-knap (Copy-ikon) med tooltip "Dupliker" pr. række.
- Klik på knappen må ikke også åbne tilbuddet (stopper row-click).

## Logik
Ved klik:
1. Hent det fulde tilbud + alle `quote_lines` fra databasen.
2. Indsæt en ny række i `quotes` med kopierede felter:
   - Kunde, noter, valuta, rabat mv. kopieres 1:1.
   - `quote_number` genereres automatisk (samme mekanisme som "Nyt tilbud").
   - `quote_date` = i dag.
   - `status` = `draft` (altid kladde, uanset originalens status).
   - Dinero-relaterede felter (fx `dinero_invoice_id`, `sent_at`) nulstilles.
3. Indsæt kopier af alle `quote_lines` med det nye `quote_id` (nye id'er, samme produkt/pris/antal/rækkefølge).
4. Vis toast "Tilbud kopieret" og naviger til `/quotes/{nyt-id}` så brugeren kan redigere videre.

## Fejlhåndtering
- Vis toast med fejlbesked hvis kopiering fejler; rul intet tilbage manuelt (én insert ad gangen, linjer først efter header lykkes).
- Invalider `quotes-list`-query så listen opdateres.

Ingen ændringer i database-skema eller edge functions.
