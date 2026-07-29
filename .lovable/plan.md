## Formål

Kør en struktureret drifts- og robusthedsgennemgang ("simulering") af PIM'et: prislogik, lagerlogik, leverandør-sync, Shopify-push og sikkerhed — og lever en rapport med konkrete fund + fixes.

Note om modeller: i dette projekt bruges Lovable AI Gateway. Chat-default er `openai/gpt-5.6-sol` (Claude-modeller er ikke i kataloget her). Simuleringerne nedenfor kører primært som deterministiske SQL/edge-function-tests — ikke som AI-gæt — så resultaterne er efterprøvelige.

## Trin 1 — Datatilstands-audit (read-only SQL)

Kør faktatjek mod databasen og sammenhold med reglerne:
- Produkter hvor `stock_quantity` ikke matcher billigste/prioriterede valgte leverandør (leverandør-prioritet respekteret?).
- Produkter der står "på lager" uden en valgt leverandør med lager.
- Produkter hvor `webshop_price`/`sale_price` er under indkøb + margin-grænse, men uden aktiv prisalarm (og omvendt: alarmer der burde være lukket).
- Produkter med `low_margin_guard = 'off'` der stadig har alarm.
- Aktive tilbudskampagner: er slut-dato-revert faktisk sket på alle produkter?
- Ugyldige/duplikerede EAN'er og produkter uden Shopify-link.

## Trin 2 — Sync-sundhed (leverandører)

- Sidste succesfulde kørsel pr. leverandør vs. konfigureret interval; hvor mange fejl-/timeout-kørsler i `import_logs` seneste 7 dage.
- Tjek om last-run-gate/overlap-guard reelt forhindrer samtidige kørsler (mønster i logs).
- Cache-friskhed i `supplier_feed_cache` pr. leverandør (DCS undtaget pga. skip_cache).

## Trin 3 — Shopify-drift

- Kø-status: fastlåste/gentagne fejlende jobs i Shopify-køen, ældste ubehandlede job.
- Stikprøve-diff PIM ↔ Shopify på 20–30 produkter: pris, compareAtPrice, lager, tracked, SEO — via `shopify-compare`.
- Verificér at tilbudsprodukter har korrekt price/compareAtPrice.

## Trin 4 — Negative simuleringer (kontrollerede test-scenarier)

Kør som transaktioner der rulles tilbage / på ét testprodukt:
- Sæt billigste leverandør til 0 på lager → forventet: lager falder til næste leverandør, ikke summeret, ingen negativ avance.
- Sæt indkøbspris over salgspris → forventet: salg stoppes + alarm rejses øjeblikkeligt.
- Push under kostpris → forventet: blokeret (undtagen kladde-oprettelse).
- Kampagne der udløber → forventet: pris ruller tilbage, også hvis trigger først blokerer.

## Trin 5 — Sikkerhed & fejltolerance

- Kør sikkerhedsscan; bekræft ingen nye fund.
- Tjek at alle edge functions validerer JWT / service-role korrekt.
- Tjek fejlhåndtering: 429/402 fra AI-gateway, timeouts, retry-adfærd.

## Leverance

En rapport i chatten: Grønt / Advarsel / Kritisk pr. område, med præcise produkt-/log-referencer. Kritiske fund fixes med det samme i samme runde; advarsler listes med forslag, så du vælger.

## Teknisk

Alt i trin 1–3 og 5 er read-only (SQL-queries, logs, scan). Trin 4 bruger ét dedikeret testprodukt eller rullede transaktioner, så produktionsdata ikke ændres, og eventuelle Shopify-push i test køres mod kladde/dry-run.
