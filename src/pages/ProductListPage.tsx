import { useState, useMemo } from "react";
import { useMasterProducts, useSuppliers, getCheapestSupplier, getMarginPercent, getRecommendedPriceInclVat, usePriceSettings, exVat } from "@/hooks/use-products";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Package, Filter, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

type StockFilter = "all" | "instock" | "outofstock" | "backorder";
type MarginFilter = "all" | "low" | "medium" | "good";
type PriceFilter = "all" | "has_price" | "no_price" | "on_sale";
type StatusFilter = "all" | "on_stock" | "out_of_stock" | "no_data";

export default function ProductListPage() {
  const [search, setSearch] = useState("");
  const { data: products = [], isLoading } = useMasterProducts(search || undefined);
  const { data: priceSettings = [] } = usePriceSettings();
  const { data: suppliers = [] } = useSuppliers();
  const navigate = useNavigate();

  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [marginFilter, setMarginFilter] = useState<MarginFilter>("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const globalMarkup = priceSettings.find((s) => s.scope === "global")?.markup_percentage ?? 30;

  const brands = useMemo(() => {
    const set = new Set(products.map((p) => p.brand).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [products]);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    return products.filter((product) => {
      if (stockFilter === "instock" && product.stock_status !== "instock") return false;
      if (stockFilter === "outofstock" && product.stock_status !== "outofstock") return false;
      if (stockFilter === "backorder" && !product.backorders_allowed) return false;
      if (brandFilter !== "all" && product.brand !== brandFilter) return false;
      if (categoryFilter !== "all" && product.category !== categoryFilter) return false;
      if (priceFilter === "has_price" && !product.webshop_price) return false;
      if (priceFilter === "no_price" && product.webshop_price) return false;
      if (priceFilter === "on_sale" && !product.sale_price) return false;

      // Supplier filter
      if (supplierFilter !== "all") {
        const hasSupplier = product.supplier_products.some((sp) => sp.supplier_id === supplierFilter);
        if (!hasSupplier) return false;
      }

      // Status filter (supplier stock status badge)
      if (statusFilter !== "all") {
        const allOut = product.supplier_products.length > 0 && product.supplier_products.every((sp) => !sp.in_stock);
        if (statusFilter === "on_stock" && (product.supplier_products.length === 0 || allOut)) return false;
        if (statusFilter === "out_of_stock" && !allOut) return false;
        if (statusFilter === "no_data" && product.supplier_products.length > 0) return false;
      }

      if (marginFilter !== "all") {
        const cheapest = getCheapestSupplier(product.supplier_products);
        const activePrice = product.sale_price ?? product.webshop_price;
        if (!activePrice || !cheapest) return false;
        const margin = getMarginPercent(exVat(activePrice), cheapest.purchase_price);
        if (marginFilter === "low" && margin >= 10) return false;
        if (marginFilter === "medium" && (margin < 10 || margin >= 20)) return false;
        if (marginFilter === "good" && margin < 20) return false;
      }

      return true;
    });
  }, [products, stockFilter, brandFilter, categoryFilter, marginFilter, priceFilter, supplierFilter, statusFilter]);

  const activeFilterCount = [stockFilter, brandFilter, categoryFilter, marginFilter, priceFilter, supplierFilter, statusFilter].filter((f) => f !== "all").length;

  const clearFilters = () => {
    setStockFilter("all");
    setBrandFilter("all");
    setCategoryFilter("all");
    setMarginFilter("all");
    setPriceFilter("all");
    setSupplierFilter("all");
    setStatusFilter("all");
  };

  const formatPrice = (price: number | null) => {
    if (price === null || price === undefined) return "—";
    return new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" }).format(price);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Produkter</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Master produktliste – {filtered.length} af {products.length} produkter
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Søg på titel, EAN eller brand..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Filter className="h-4 w-4" />
            <span>Filtre:</span>
          </div>

          <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as StockFilter)}>
            <SelectTrigger className="w-[150px] h-9 text-sm">
              <SelectValue placeholder="Lagerstatus" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle lagerstatus</SelectItem>
              <SelectItem value="instock">På lager</SelectItem>
              <SelectItem value="outofstock">Udsolgt</SelectItem>
              <SelectItem value="backorder">Restordre tilladt</SelectItem>
            </SelectContent>
          </Select>

          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="w-[160px] h-9 text-sm">
              <SelectValue placeholder="Brand" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle brands</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px] h-9 text-sm">
              <SelectValue placeholder="Kategori" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle kategorier</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={marginFilter} onValueChange={(v) => setMarginFilter(v as MarginFilter)}>
            <SelectTrigger className="w-[150px] h-9 text-sm">
              <SelectValue placeholder="Avance" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle avancer</SelectItem>
              <SelectItem value="low">Lav (&lt;10%)</SelectItem>
              <SelectItem value="medium">Medium (10-20%)</SelectItem>
              <SelectItem value="good">God (&gt;20%)</SelectItem>
            </SelectContent>
          </Select>

          <Select value={priceFilter} onValueChange={(v) => setPriceFilter(v as PriceFilter)}>
            <SelectTrigger className="w-[150px] h-9 text-sm">
              <SelectValue placeholder="Pris" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle priser</SelectItem>
              <SelectItem value="has_price">Har pris</SelectItem>
              <SelectItem value="no_price">Mangler pris</SelectItem>
              <SelectItem value="on_sale">På tilbud</SelectItem>
            </SelectContent>
          </Select>

          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="w-[170px] h-9 text-sm">
              <SelectValue placeholder="Leverandør" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle leverandører</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[150px] h-9 text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statusser</SelectItem>
              <SelectItem value="on_stock">På lager</SelectItem>
              <SelectItem value="out_of_stock">Udsolgt</SelectItem>
              <SelectItem value="no_data">Ingen data</SelectItem>
            </SelectContent>
          </Select>

          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-sm gap-1">
              <X className="h-3.5 w-3.5" />
              Ryd filtre ({activeFilterCount})
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <ScrollArea className="w-full" type="auto">
        <div className="min-w-[1200px]">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/50">
              <TableHead className="w-12"></TableHead>
              <TableHead>Produkt</TableHead>
              <TableHead>EAN</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead className="text-right">Eget lager</TableHead>
              <TableHead className="text-right">Lev. lager</TableHead>
              <TableHead className="text-right">Indkøb (ex. moms)</TableHead>
              <TableHead className="text-right">Webshop (inkl. moms)</TableHead>
              <TableHead className="text-right">Tilbud (inkl. moms)</TableHead>
              <TableHead className="text-right">Anbefalet (inkl.)</TableHead>
              <TableHead className="text-right">Avance (ex.)</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                  Indlæser...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                  <Package className="mx-auto h-8 w-8 mb-2 opacity-40" />
                  Ingen produkter fundet
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((product) => {
                const cheapest = getCheapestSupplier(product.supplier_products);
                const cheapestPrice = cheapest?.purchase_price ?? null;
                const recommendedPriceInclVat = cheapestPrice ? getRecommendedPriceInclVat(cheapestPrice, product.custom_markup_percentage ?? globalMarkup) : null;
                const activePrice = product.sale_price ?? product.webshop_price;
                const activePriceExVat = activePrice ? exVat(activePrice) : null;
                const margin =
                  activePriceExVat && cheapestPrice
                    ? getMarginPercent(activePriceExVat, cheapestPrice)
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
                    <TableCell className="text-muted-foreground font-mono text-xs">{product.sku ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{product.brand ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {product.stock_quantity ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {product.supplier_products.length > 0
                        ? product.supplier_products.reduce((sum, sp) => sum + (sp.stock_quantity ?? 0), 0) || "—"
                        : "—"}
                    </TableCell>
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
                    <TableCell className="text-right font-mono text-foreground">
                      {product.webshop_price ? (
                        <div>
                          <span>{formatPrice(product.webshop_price)}</span>
                          <p className="text-xs text-muted-foreground">ex. {formatPrice(exVat(product.webshop_price))}</p>
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {product.sale_price ? (
                        <div>
                          <span className="text-warning">{formatPrice(product.sale_price)}</span>
                          <p className="text-xs text-muted-foreground">ex. {formatPrice(exVat(product.sale_price))}</p>
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-primary">{formatPrice(recommendedPriceInclVat)}</TableCell>
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
        <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </div>
  );
}