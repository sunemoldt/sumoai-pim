import { useMasterProducts, getCheapestSupplier, getMarginPercent } from "@/hooks/use-products";
import { useSuppliers } from "@/hooks/use-products";
import StatCard from "@/components/StatCard";
import { Package, Truck, AlertTriangle, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

export default function DashboardPage() {
  const { data: products = [] } = useMasterProducts();
  const { data: suppliers = [] } = useSuppliers();
  const navigate = useNavigate();

  const totalProducts = products.length;
  const activeSuppliers = suppliers.filter((s) => s.is_active).length;

  // Products with low margin (< 10%)
  const lowMarginProducts = products.filter((p) => {
    if (!p.webshop_price) return false;
    const cheapest = getCheapestSupplier(p.supplier_products);
    if (!cheapest) return false;
    return getMarginPercent(p.webshop_price, cheapest.purchase_price) < 10;
  });

  // Products out of stock everywhere
  const outOfStockProducts = products.filter((p) => {
    if (p.supplier_products.length === 0) return false;
    return p.supplier_products.every((sp) => !sp.in_stock);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Overblik over produkter, leverandører og priser</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Produkter" value={totalProducts} icon={<Package className="h-5 w-5" />} />
        <StatCard title="Aktive leverandører" value={activeSuppliers} icon={<Truck className="h-5 w-5" />} variant="success" />
        <StatCard title="Lav avance" value={lowMarginProducts.length} icon={<AlertTriangle className="h-5 w-5" />} variant="warning" description="Under 10% margin" />
        <StatCard title="Ikke på lager" value={outOfStockProducts.length} icon={<TrendingUp className="h-5 w-5" />} variant="destructive" description="Hos alle leverandører" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Produkter med lav avance</CardTitle>
          </CardHeader>
          <CardContent>
            {lowMarginProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Ingen produkter med lav avance</p>
            ) : (
              <div className="space-y-3">
                {lowMarginProducts.slice(0, 5).map((p) => {
                  const cheapest = getCheapestSupplier(p.supplier_products);
                  const margin = cheapest && p.webshop_price ? getMarginPercent(p.webshop_price, cheapest.purchase_price) : 0;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-accent transition-colors"
                      onClick={() => navigate(`/products/${p.id}`)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{p.title}</p>
                        <p className="text-xs text-muted-foreground">EAN: {p.ean}</p>
                      </div>
                      <Badge variant="outline" className="text-warning border-warning/30 ml-2 shrink-0">
                        {margin.toFixed(1)}%
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Udsolgte produkter</CardTitle>
          </CardHeader>
          <CardContent>
            {outOfStockProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Alle produkter er på lager</p>
            ) : (
              <div className="space-y-3">
                {outOfStockProducts.slice(0, 5).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-accent transition-colors"
                    onClick={() => navigate(`/products/${p.id}`)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{p.title}</p>
                      <p className="text-xs text-muted-foreground">EAN: {p.ean}</p>
                    </div>
                    <Badge variant="destructive" className="ml-2 shrink-0">Udsolgt</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
