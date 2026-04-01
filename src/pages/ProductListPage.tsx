import { useState, useMemo } from "react";
import { useMasterProducts, useSuppliers, getCheapestSupplier, getMarginPercent, getRecommendedPriceInclVat, usePriceSettings, exVat, useAllProductAnalytics, useProductRecommendations } from "@/hooks/use-products";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { da } from "date-fns/locale";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Package, Filter, X, ExternalLink, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Lightbulb, TrendingUp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

type StockFilter = "all" | "instock" | "outofstock" | "backorder";
type MarginFilter = "all" | "low" | "medium" | "good";
type PriceFilter = "all" | "has_price" | "no_price" | "on_sale";
type StatusFilter = "all" | "on_stock" | "out_of_stock" | "no_data";
type SortField = "title" | "stock_quantity" | "updated_at" | "recommended";
type SortDir = "asc" | "desc";

export default function ProductListPage() {
  const [search, setSearch] = useState("");
  const { data: products = [], isLoading } = useMasterProducts(search || undefined);
  const { data: priceSettings = [] } = usePriceSettings();
  const { data: suppliers = [] } = useSuppliers();
  const { data: analyticsMap } = useAllProductAnalytics();
  const { data: recommendations = [] } = useProductRecommendations();
  const navigate = useNavigate();

  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [marginFilter, setMarginFilter] = useState<MarginFilter>("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortField, setSortField] = useState<SortField>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortField === "title") return dir * a.title.localeCompare(b.title, "da");
      if (sortField === "stock_quantity") return dir * ((a.stock_quantity ?? 0) - (b.stock_quantity ?? 0));
      if (sortField === "updated_at") return dir * (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      if (sortField === "recommended") {
        const cA = getCheapestSupplier(a.supplier_products);
        const cB = getCheapestSupplier(b.supplier_products);
        const rA = cA ? getRecommendedPriceInclVat(cA.purchase_price, a.custom_markup_percentage ?? globalMarkup) : 0;
        const rB = cB ? getRecommendedPriceInclVat(cB.purchase_price, b.custom_markup_percentage ?? globalMarkup) : 0;
        return dir * (rA - rB);
      }
      return 0;
    });
  }, [filtered, sortField, sortDir, globalMarkup]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

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
            Master produktliste – {sorted.length} af {products.length} produkter
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

      <div className="rounded-lg border border-border bg-card shadow-sm overflow-auto">
        <table className="w-full caption-bottom text-xs">
          <thead className="[&_tr]:border-b">
            <tr className="border-b bg-secondary/50">
              <th className="h-9 px-2 text-left align-middle font-medium text-muted-foreground w-10"></th>
              <th className="h-9 px-2 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("title")}>
                <span className="inline-flex items-center">Produkt<SortIcon field="title" /></span>
              </th>
              <th className="h-9 px-2 text-left align-middle font-medium text-muted-foreground">EAN</th>
              <th className="h-9 px-2 text-left align-middle font-medium text-muted-foreground">SKU</th>
              <th className="h-9 px-2 text-left align-middle font-medium text-muted-foreground">Brand</th>
              <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("stock_quantity")}>
                <span className="inline-flex items-center justify-end">Eget<SortIcon field="stock_quantity" /></span>
              </th>
              <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground">Lev.</th>
              <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground">Indkøb</th>
              <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground">Webshop</th>
              <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground">Tilbud</th>
              <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("recommended")}>
                <span className="inline-flex items-center justify-end">Anbefalet<SortIcon field="recommended" /></span>
              </th>
              <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground">Avance</th>
              <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground">Konv. (7d)</th>
              <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground">Besøg ÷ salg</th>
              <th className="h-9 px-2 text-left align-middle font-medium text-muted-foreground">Status</th>
              <th className="h-9 px-2 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("updated_at")}>
                <span className="inline-flex items-center">Redigeret<SortIcon field="updated_at" /></span>
              </th>
              <th className="h-9 px-2 text-center align-middle font-medium text-muted-foreground w-10"></th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {isLoading ? (
              <tr className="border-b">
                <td colSpan={17} className="text-center py-8 text-muted-foreground">
                  Indlæser...
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr className="border-b">
                <td colSpan={17} className="text-center py-8 text-muted-foreground">
                  <Package className="mx-auto h-8 w-8 mb-2 opacity-40" />
                  Ingen produkter fundet
                </td>
              </tr>
            ) : (
              sorted.map((product) => {
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
                  <tr
                    key={product.id}
                    className="border-b cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => navigate(`/products/${product.id}`)}
                  >
                    <td className="px-2 py-1.5 align-middle">
                      {product.image_url ? (
                        <img src={product.image_url} alt="" className="h-7 w-7 rounded object-cover" />
                      ) : (
                        <div className="h-7 w-7 rounded bg-secondary flex items-center justify-center">
                          <Package className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 align-middle font-medium text-foreground max-w-[160px] truncate">{product.title}</td>
                    <td className="px-2 py-1.5 align-middle text-muted-foreground font-mono">{product.ean}</td>
                    <td className="px-2 py-1.5 align-middle text-muted-foreground font-mono">{product.sku ?? "—"}</td>
                    <td className="px-2 py-1.5 align-middle text-muted-foreground">{product.brand ?? "—"}</td>
                    <td className="px-2 py-1.5 align-middle text-right font-mono text-muted-foreground">
                      {product.stock_quantity ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right font-mono text-muted-foreground">
                      {product.supplier_products.length > 0
                        ? product.supplier_products.reduce((sum, sp) => sum + (sp.stock_quantity ?? 0), 0) || "—"
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right font-mono">
                      {cheapestPrice !== null ? (
                        <span className="text-foreground">{formatPrice(cheapestPrice)}</span>
                      ) : "—"}
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right font-mono text-foreground">
                      {product.webshop_price ? formatPrice(product.webshop_price) : "—"}
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right font-mono">
                      {product.sale_price ? (
                        <span className="text-warning">{formatPrice(product.sale_price)}</span>
                      ) : "—"}
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right font-mono text-primary">{formatPrice(recommendedPriceInclVat)}</td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      {margin !== null ? (
                        <Badge
                          variant="outline"
                          className={
                            margin < 10
                              ? "text-destructive border-destructive/30 text-xs"
                              : margin < 20
                              ? "text-warning border-warning/30 text-xs"
                              : "text-success border-success/30 text-xs"
                          }
                        >
                          {margin.toFixed(1)}%
                        </Badge>
                      ) : "—"}
                    </td>
                    {/* Analytics columns */}
                    {(() => {
                      const analytics = analyticsMap?.get(product.id);
                      const productRecs = recommendations.filter(r => r.master_product_id === product.id);
                      const hasWarning = productRecs.some(r => r.severity === "critical");
                      const hasTip = productRecs.some(r => r.severity === "info" || r.severity === "warning");
                      const visitsNoSale = analytics ? analytics.page_views - analytics.purchases : null;
                      return (
                        <>
                          <td className="px-2 py-1.5 align-middle text-right font-mono">
                            <div className="flex items-center justify-end gap-1">
                              {analytics ? `${analytics.conversion_rate.toFixed(1)}%` : "—"}
                              {hasWarning && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger><AlertTriangle className="h-3.5 w-3.5 text-destructive" /></TooltipTrigger>
                                    <TooltipContent><p>{productRecs.find(r => r.severity === "critical")?.title}</p></TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              {!hasWarning && hasTip && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger><Lightbulb className="h-3.5 w-3.5 text-warning" /></TooltipTrigger>
                                    <TooltipContent><p>{productRecs[0]?.title}</p></TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 align-middle text-right font-mono">
                            {visitsNoSale !== null && visitsNoSale > 0 ? (
                              <span className={visitsNoSale > 50 ? "text-destructive" : "text-muted-foreground"}>{visitsNoSale}</span>
                            ) : analytics ? "0" : "—"}
                          </td>
                        </>
                      );
                    })()}
                    <td className="px-2 py-1.5 align-middle">
                      {allOutOfStock ? (
                        <Badge variant="destructive" className="text-xs">Udsolgt</Badge>
                      ) : product.supplier_products.length > 0 ? (
                        <Badge variant="outline" className="text-success border-success/30 text-xs">På lager</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Ingen data</Badge>
                      )}
                    </td>
                    <td className="px-2 py-1.5 align-middle text-muted-foreground whitespace-nowrap">
                      {format(new Date(product.updated_at), "d. MMM yyyy HH:mm", { locale: da })}
                    </td>
                    <td className="px-2 py-1.5 align-middle text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`/products/${product.id}`, '_blank');
                        }}
                        className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        title="Åbn i ny fane"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}