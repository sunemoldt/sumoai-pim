# Fix "Mest besøgte (90 dage)" — data er forældet og delvist tom

Nej, tallene er ikke korrekte. De kommer ikke fra de sidste 90 dage.

## Hvad jeg fandt (verificeret i databasen)

1. **Ingen nye tal siden 25. juni.** `product_analytics` indeholder kun tre perioder: 2026-03-02→04-01 (de eneste rækker med besøgstal, i alt 1.326 visninger), 2026-03-25→04-01 og 2026-05-26→06-25. Nyeste opdatering er 25. juni 2026.
2. **Det daglige job fejler hver nat.** Cron-jobbet `shopify-analytics-daily` (kl. 02:00) kalder analytics-funktionen med den offentlige nøgle i stedet for en gyldig servicenøgle. Svaret i loggen er `401 Unauthorized` hver eneste gang — funktionen kører aldrig. Cron rapporterer "succeeded", fordi selve HTTP-kaldet blev afsendt, hvilket har skjult fejlen.
3. **Cron beder desuden om 30 dage**, ikke de 90 dage der er sat i indstillingerne.
4. **Sidste kørsel (25. juni) gemte kun nuller** for alle 537 produkter. Det tyder på at Shopifys besøgsdata (ShopifyQL `products_analytics`) ikke kom igennem — funktionen fanger den fejl og fortsætter stille med 0 i stedet for at melde fejl.
5. **Dashboardet viser derfor gamle tal fra marts/april** under overskriften "Mest besøgte (90 dage)".

## Løsning

**1. Få det natlige job til at køre igen**
- Opdatér cron-jobbet til at kalde funktionen med korrekt intern autorisation, og fjern den hårdkodede `days: 30` så perioden altid følger indstillingen (90 dage).

**2. Gør fejl synlige i stedet for at gemme nuller**
- Hvis Shopifys besøgsdata ikke kan hentes, skal kørslen fejle tydeligt og **ikke** overskrive eksisterende tal med 0.
- Log og returnér hvorfor (manglende adgang/scope, parse-fejl, tomt svar) så det kan ses direkte.

**3. Verificér datakilden mod Shopify**
- Kør funktionen manuelt og sammenlign antal produkter med besøg og totale visninger mod Shopifys egen analyserapport for samme periode.
- Hvis ShopifyQL nægter adgang, skyldes det typisk at appens adgang mangler `read_analytics`-tilladelse — så skal Shopify-forbindelsen godkendes på ny med den rettighed. Det melder jeg tilbage om, da det kræver din godkendelse i Shopify.

**4. Ryd op i visningen**
- Fjern de nulstillede rækker fra 25. juni, så dashboardet ikke blander tomme og gamle perioder.
- Vis perioden der rent faktisk ligger bag tallene (fra-dato → til-dato) samt "sidst opdateret" i kortets overskrift, så forældede data er synlige med det samme.
- Hvis der ikke findes friske data for den valgte periode, vises "Ingen aktuelle besøgsdata" i stedet for gamle tal.

## Teknisk

- Cron `jobid 11` (`shopify-analytics-daily`): erstat anon-nøglen i `Authorization` med intern service-autorisation; drop `days` fra body.
- `supabase/functions/fetch-analytics/index.ts`: lad `fetchShopifyViews` kaste fejl videre i stedet for `catch → tom map`; afbryd upsert hvis view-datasættet er tomt samtidig med at der findes ordredata; log HTTP-status og `ParseError`-kode.
- `product_analytics`: slet perioden 2026-05-26→2026-06-25 (alle nul-rækker).
- `src/hooks/use-products.ts` (`useAllProductAnalytics`) + `src/pages/DashboardPage.tsx`: dedupér på nyeste periode og vis periode-interval samt `updated_at` i kortoverskriften.
