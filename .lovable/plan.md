# Plan: Filter for "På lager men 0 antal"

Tilføj et nyt valg i lager-filtret på produktlisten, så du kan finde produkter hvor `stock_status = "instock"` men `stock_quantity = 0` (eller null). Så kan du gå ind og slukke leverandør-synk manuelt på dem.

## Ændring

**`src/pages/ProductListPage.tsx`**

1. Udvid `StockFilter`-typen:
   ```ts
   type StockFilter = "all" | "instock" | "outofstock" | "backorder" | "instock_zero";
   ```

2. Tilføj filter-gren (ved linje 244-246):
   ```ts
   if (stockFilter === "instock_zero"
       && !(product.stock_status === "instock" && (product.stock_quantity ?? 0) === 0)) return false;
   ```

3. Tilføj `<SelectItem value="instock_zero">På lager med 0 antal</SelectItem>` i dropdown'en (ved linje 494).

Ingen database-ændringer, ingen ændringer i lagersync-logik. Du beholder fuld manuel kontrol.
