import { useState } from "react";
import { useMasterProducts, getCheapestSupplier, getMarginPercent, getRecommendedPrice, usePriceSettings } from "@/hooks/use-products";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Package } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function ProductListPage() {
  const [search, setSearch] = useState("");
  const { data: products = [], isLoading } = useMasterProducts(search || undefined);
  const { data: priceSettings = [] } = usePriceSettings();
  const navigate = useNavigate();

  const globalMarkup = priceSettings.find((s) => s.scope === "global")?.markup_percentage ?? 30;

  const formatPrice = (price: number | null) => {
    if (price === null || price === undefined) return "—";
    return new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" }).format(price);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Produkter</h1>
          <p className="text-sm text-muted-foreground mt-1">Master produktliste – {products.length} produkter</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Søg på titel, EAN eller brand..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/50">
              <TableHead className="w-12"></TableHead>
              <TableHead>Produkt</TableHead>
              <TableHead>EAN</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead className="text-right">Lager</TableHead>
              <TableHead className="text-right">Billigste indkøb</TableHead>
              <TableHead className="text-right">Webshop pris</TableHead>
              <TableHead className="text-right">Tilbudspris</TableHead>
              <TableHead className="text-right">Anbefalet pris</TableHead>
              <TableHead className="text-right">Avance</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                  Indlæser...
                </TableCell>
              </TableRow>
            ) : products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                  <Package className="mx-auto h-8 w-8 mb-2 opacity-40" />
                  Ingen produkter fundet
                </TableCell>
              </TableRow>
            ) : (
              products.map((product) => {
                const cheapest = getCheapestSupplier(product.supplier_products);
                const cheapestPrice = cheapest?.purchase_price ?? null;
                const recommendedPrice = cheapestPrice ? getRecommendedPrice(cheapestPrice, product.custom_markup_percentage ?? globalMarkup) : null;
                const activePrice = product.sale_price ?? product.webshop_price;
                const margin =
                  activePrice && cheapestPrice
                    ? getMarginPercent(activePrice, cheapestPrice)
                    : null;
                const allOutOfStock =
                  product.supplier_products.length > 0 && product.supplier_products.every((sp) => !sp.in_stock);

                return (
                  <TableRow
                    key={product.id}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => navigate(`/products/${product.id}`)}
                  >
                    <TableCell>
                      {product.image_url ? (
                        <img src={product.image_url} alt="" className="h-8 w-8 rounded object-cover" />
                      ) : (
                        <div className="h-8 w-8 rounded bg-secondary flex items-center justify-center">
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-foreground max-w-[200px] truncate">{product.title}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{product.ean}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{(product as any).sku ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{product.brand ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">
                      {cheapestPrice !== null ? (
                        <div>
                          <span className="text-foreground">{formatPrice(cheapestPrice)}</span>
                          {cheapest?.suppliers && (
                            <p className="text-xs text-muted-foreground">{cheapest.suppliers.name}</p>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-foreground">{formatPrice(product.webshop_price)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {product.sale_price ? (
                        <span className="text-warning">{formatPrice(product.sale_price)}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-primary">{formatPrice(recommendedPrice)}</TableCell>
                    <TableCell className="text-right">
                      {margin !== null ? (
                        <Badge
                          variant="outline"
                          className={
                            margin < 10
                              ? "text-destructive border-destructive/30"
                              : margin < 20
                              ? "text-warning border-warning/30"
                              : "text-success border-success/30"
                          }
                        >
                          {margin.toFixed(1)}%
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {allOutOfStock ? (
                        <Badge variant="destructive">Udsolgt</Badge>
                      ) : product.supplier_products.length > 0 ? (
                        <Badge variant="outline" className="text-success border-success/30">På lager</Badge>
                      ) : (
                        <Badge variant="secondary">Ingen data</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
