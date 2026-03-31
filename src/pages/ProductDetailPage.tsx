import { useParams, useNavigate } from "react-router-dom";
import { useMasterProduct, getCheapestSupplier, getMarginPercent, getRecommendedPrice, usePriceSettings } from "@/hooks/use-products";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, CheckCircle, XCircle, Package } from "lucide-react";

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: product, isLoading } = useMasterProduct(id!);
  const { data: priceSettings = [] } = usePriceSettings();

  const globalMarkup = priceSettings.find((s) => s.scope === "global")?.markup_percentage ?? 30;

  const formatPrice = (price: number | null) => {
    if (price === null || price === undefined) return "—";
    return new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" }).format(price);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">Indlæser produkt...</div>
    );
  }

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Package className="h-12 w-12 mb-4 opacity-40" />
        <p>Produkt ikke fundet</p>
        <Button variant="ghost" onClick={() => navigate("/products")} className="mt-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Tilbage til produkter
        </Button>
      </div>
    );
  }

  const cheapest = getCheapestSupplier(product.supplier_products);
  const cheapestPrice = cheapest?.purchase_price ?? null;
  const recommendedPrice = cheapestPrice ? getRecommendedPrice(cheapestPrice, globalMarkup) : null;
  const margin = product.webshop_price && cheapestPrice ? getMarginPercent(product.webshop_price, cheapestPrice) : null;
  const priceDiff = product.webshop_price && recommendedPrice ? product.webshop_price - recommendedPrice : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/products")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{product.title}</h1>
          <p className="text-sm text-muted-foreground">EAN: {product.ean} {product.brand && `· ${product.brand}`}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Billigste indkøbspris</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{formatPrice(cheapestPrice)}</p>
            {cheapest?.suppliers && <p className="text-xs text-muted-foreground mt-0.5">{cheapest.suppliers.name}</p>}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Webshop salgspris</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{formatPrice(product.webshop_price)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{product.webshop_platform}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Anbefalet salgspris</p>
            <p className="text-2xl font-semibold text-primary mt-1">{formatPrice(recommendedPrice)}</p>
            {priceDiff !== null && (
              <p className={`text-xs mt-0.5 ${priceDiff > 0 ? "text-success" : priceDiff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                {priceDiff > 0 ? "+" : ""}{formatPrice(priceDiff)} vs. anbefalet
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Aktuel avance</p>
            <p className={`text-2xl font-semibold mt-1 ${
              margin !== null ? (margin < 10 ? "text-destructive" : margin < 20 ? "text-warning" : "text-success") : "text-foreground"
            }`}>
              {margin !== null ? `${margin.toFixed(1)}%` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Markup: {globalMarkup}%</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Leverandøroversigt</CardTitle>
        </CardHeader>
        <CardContent>
          {product.supplier_products.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Ingen leverandørdata tilgængelig</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/50">
                  <TableHead>Leverandør</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Indkøbspris</TableHead>
                  <TableHead className="text-right">Lager</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sidst opdateret</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.supplier_products
                  .sort((a, b) => a.purchase_price - b.purchase_price)
                  .map((sp) => {
                    const isCheapest = cheapest?.id === sp.id;
                    return (
                      <TableRow key={sp.id} className={isCheapest ? "bg-success/5" : ""}>
                        <TableCell className="font-medium text-foreground">
                          {sp.suppliers?.name ?? "Ukendt"}
                          {isCheapest && (
                            <Badge className="ml-2 bg-success/10 text-success border-0 text-xs">Billigst</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground font-mono text-xs">{sp.supplier_sku ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-foreground">{formatPrice(sp.purchase_price)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{sp.stock_quantity ?? "—"}</TableCell>
                        <TableCell>
                          {sp.in_stock ? (
                            <span className="flex items-center gap-1 text-success text-sm">
                              <CheckCircle className="h-3.5 w-3.5" /> På lager
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-destructive text-sm">
                              <XCircle className="h-3.5 w-3.5" /> Udsolgt
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {new Date(sp.last_updated).toLocaleDateString("da-DK")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
