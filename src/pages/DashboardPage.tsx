import { useState } from "react";
import { useMasterProducts, getCheapestSupplier, getMarginPercent, exVat } from "@/hooks/use-products";
import { useSuppliers } from "@/hooks/use-products";
import StatCard from "@/components/StatCard";
import { Package, Truck, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

type DashView = "overview" | "low_margin" | "out_of_stock" | "high_margin";

export default function DashboardPage() {
  const { data: products = [] } = useMasterProducts();
  const { data: suppliers = [] } = useSuppliers();
  const navigate = useNavigate();
  const [view, setView] = useState<DashView>("overview");

  const totalProducts = products.length;
  const activeSuppliers = suppliers.filter((s) => s.is_active).length;

  const getProductMargin = (p: typeof products[0]) => {
    const cheapest = getCheapestSupplier(p.supplier_products);
    if (!cheapest || !p.webshop_price) return null;
    return getMarginPercent(exVat(p.webshop_price), cheapest.purchase_price);
  };

  const lowMarginProducts = products.filter((p) => {
    const m = getProductMargin(p);
    return m !== null && m < 10;
  });

  const highMarginProducts = products.filter((p) => {
    const m = getProductMargin(p);
    return m !== null && m > 40;
  });

  const outOfStockProducts = products.filter((p) => {
    if (p.supplier_products.length === 0) return false;
    return p.supplier_products.every((sp) => !sp.in_stock);
  });

  const formatPrice = (price: number | null | undefined) => {
    if (price === null || price === undefined) return "—";
    return new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" }).format(price);
  };

  const renderProductList = (list: typeof products, badgeRenderer: (p: typeof products[0]) => React.ReactNode) => (
    <div className="space-y-2">
      {list.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-accent transition-colors"
          onClick={() => navigate(`/products/${p.id}`)}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">{p.title}</p>
            <p className="text-xs text-muted-foreground">EAN: {p.ean} {p.brand && `· ${p.brand}`}</p>
          </div>
          {badgeRenderer(p)}
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Overblik over produkter, leverandører og priser</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="Produkter" value={totalProducts} icon={<Package className="h-5 w-5" />} onClick={() => navigate("/products")} />
        <StatCard title="Aktive leverandører" value={activeSuppliers} icon={<Truck className="h-5 w-5" />} variant="success" onClick={() => navigate("/suppliers")} />
        <StatCard
          title="Lav avance"
          value={lowMarginProducts.length}
          icon={<AlertTriangle className="h-5 w-5" />}
          variant="warning"
          description="Under 10% margin (ex. moms)"
          onClick={() => setView(view === "low_margin" ? "overview" : "low_margin")}
        />
        <StatCard
          title="Ikke på lager"
          value={outOfStockProducts.length}
          icon={<TrendingDown className="h-5 w-5" />}
          variant="destructive"
          description="Hos alle leverandører"
          onClick={() => setView(view === "out_of_stock" ? "overview" : "out_of_stock")}
        />
        <StatCard
          title="Høj avance"
          value={highMarginProducts.length}
          icon={<TrendingUp className="h-5 w-5" />}
          variant="success"
          description="Over 40% margin (ex. moms)"
          onClick={() => setView(view === "high_margin" ? "overview" : "high_margin")}
        />
      </div>

      {view === "low_margin" && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">
              Produkter med lav avance ({lowMarginProducts.length})
              <Badge variant="outline" className="ml-2 text-warning border-warning/30">Under 10%</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lowMarginProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Ingen produkter med lav avance</p>
            ) : renderProductList(lowMarginProducts, (p) => {
              const m = getProductMargin(p);
              return (
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <span className="text-xs text-muted-foreground">{formatPrice(p.webshop_price)}</span>
                  <Badge variant="outline" className="text-warning border-warning/30">
                    {m?.toFixed(1)}%
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {view === "out_of_stock" && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">
              Udsolgte produkter ({outOfStockProducts.length})
              <Badge variant="destructive" className="ml-2">Udsolgt</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {outOfStockProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Alle produkter er på lager</p>
            ) : renderProductList(outOfStockProducts, () => (
              <Badge variant="destructive" className="ml-2 shrink-0">Udsolgt</Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {view === "high_margin" && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">
              Produkter med høj avance ({highMarginProducts.length})
              <Badge variant="outline" className="ml-2 text-success border-success/30">Over 40%</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {highMarginProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Ingen produkter med høj avance</p>
            ) : renderProductList(highMarginProducts, (p) => {
              const m = getProductMargin(p);
              return (
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <span className="text-xs text-muted-foreground">{formatPrice(p.webshop_price)}</span>
                  <Badge variant="outline" className="text-success border-success/30">
                    {m?.toFixed(1)}%
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {view === "overview" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Produkter med lav avance</CardTitle>
            </CardHeader>
            <CardContent>
              {lowMarginProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Ingen produkter med lav avance</p>
              ) : renderProductList(lowMarginProducts.slice(0, 5), (p) => {
                const m = getProductMargin(p);
                return <Badge variant="outline" className="text-warning border-warning/30 ml-2 shrink-0">{m?.toFixed(1)}%</Badge>;
              })}
              {lowMarginProducts.length > 5 && (
                <button onClick={() => setView("low_margin")} className="text-sm text-primary mt-3 hover:underline">
                  Vis alle {lowMarginProducts.length} →
                </button>
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
              ) : renderProductList(outOfStockProducts.slice(0, 5), () => (
                <Badge variant="destructive" className="ml-2 shrink-0">Udsolgt</Badge>
              ))}
              {outOfStockProducts.length > 5 && (
                <button onClick={() => setView("out_of_stock")} className="text-sm text-primary mt-3 hover:underline">
                  Vis alle {outOfStockProducts.length} →
                </button>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
