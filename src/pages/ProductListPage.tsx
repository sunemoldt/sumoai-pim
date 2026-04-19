import { useMemo, useCallback, useState } from "react";
import { useMasterProducts, useSuppliers, getCheapestSupplier, getCheapestSupplierAny, getMarginPercent, getRecommendedPriceInclVat, usePriceSettings, exVat, useAllProductAnalytics, useProductRecommendations } from "@/hooks/use-products";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { da } from "date-fns/locale";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Package, Filter, X, ExternalLink, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Lightbulb, TrendingUp, RefreshCw, CheckSquare, Loader2, LayoutGrid, List, Download } from "lucide-react";
import { downloadDineroCsv } from "@/lib/dinero-export";
import ProductCard from "@/components/ProductCard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type StockFilter = "all" | "instock" | "outofstock" | "backorder";
type MarginFilter = "all" | "low" | "medium" | "good";
type PriceFilter = "all" | "has_price" | "no_price" | "on_sale";
type StatusFilter = "all" | "on_stock" | "out_of_stock" | "no_data";
type DuplicateFilter = "all" | "fallback_ean" | "shared_ean";
type SortField = "title" | "ean" | "brand" | "stock_quantity" | "purchase_price" | "webshop_price" | "recommended" | "margin" | "page_views" | "conversion_rate" | "updated_at";
type SortDir = "asc" | "desc";

export default function ProductListPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Persist filters in URL search params so back-navigation preserves them
  const search = searchParams.get("q") ?? "";
  const stockFilter = (searchParams.get("stock") ?? "all") as StockFilter;
  const brandFilter = searchParams.get("brand") ?? "all";
  const categoryFilter = searchParams.get("category") ?? "all";
  const marginFilter = (searchParams.get("margin") ?? "all") as MarginFilter;
  const priceFilter = (searchParams.get("price") ?? "all") as PriceFilter;
  const supplierFilter = searchParams.get("supplier") ?? "all";
  const statusFilter = (searchParams.get("status") ?? "all") as StatusFilter;
  const duplicateFilter = (searchParams.get("duplicate") ?? "all") as DuplicateFilter;
  const sortField = (searchParams.get("sort") ?? "title") as SortField;
  const sortDir = (searchParams.get("dir") ?? "asc") as SortDir;
  const view = (searchParams.get("view") ?? "grid") as "grid" | "list";

  const setParam = useCallback((key: string, value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      const isDefault =
        value === "all" ||
        value === "" ||
        (key === "sort" && value === "title") ||
        (key === "dir" && value === "asc") ||
        (key === "view" && value === "grid");
      if (isDefault) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSearch = (v: string) => setParam("q", v);
  const setStockFilter = (v: StockFilter) => setParam("stock", v);
  const setBrandFilter = (v: string) => setParam("brand", v);
  const setCategoryFilter = (v: string) => setParam("category", v);
  const setMarginFilter = (v: MarginFilter) => setParam("margin", v);
  const setPriceFilter = (v: PriceFilter) => setParam("price", v);
  const setSupplierFilter = (v: string) => setParam("supplier", v);
  const setStatusFilter = (v: StatusFilter) => setParam("status", v);
  const setDuplicateFilter = (v: DuplicateFilter) => setParam("duplicate", v);

  const { data: products = [], isLoading } = useMasterProducts(search || undefined);
  const { data: priceSettings = [] } = usePriceSettings();
  const { data: suppliers = [] } = useSuppliers();
  const { data: analyticsMap } = useAllProductAnalytics();
  const { data: recommendations = [] } = useProductRecommendations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkSyncSupplierIds, setBulkSyncSupplierIds] = useState<string[]>([]);

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map(p => p.id)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const bulkEnableStockSync = async (supplierIds: string[]) => {
    setBulkLoading(true);
    try {
      const selectedProducts = sorted.filter(p => selectedIds.has(p.id));
      for (const prod of selectedProducts) {
        const existing = ((prod as any).stock_sync_supplier_ids as string[] | null) ?? [];
        const merged = [...new Set([...existing, ...supplierIds])];
        await supabase
          .from("master_products")
          .update({
            auto_stock_sync: true,
            stock_sync_supplier_ids: merged,
            stock_sync_supplier_id: merged[0] || null,
            stock_sync_interval: "daily",
            min_sync_margin: 15,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", prod.id);
      }
      toast.success(`Lager-sync aktiveret for ${selectedProducts.length} produkter med ${supplierIds.length} leverandør(er)`);
      clearSelection();
      setBulkSyncSupplierIds([]);
      queryClient.invalidateQueries({ queryKey: ["master_products"] });
    } catch (err: any) {
      toast.error("Fejl: " + (err.message ?? "Ukendt fejl"));
    } finally {
      setBulkLoading(false);
    }
  };

  const bulkDisableStockSync = async () => {
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from("master_products")
        .update({
          auto_stock_sync: false,
          stock_sync_supplier_id: null,
          stock_sync_supplier_ids: [],
          updated_at: new Date().toISOString(),
        } as any)
        .in("id", ids);
      if (error) throw error;
      toast.success(`Lager-sync deaktiveret for ${ids.length} produkter`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["master_products"] });
    } catch (err: any) {
      toast.error("Fejl: " + (err.message ?? "Ukendt fejl"));
    } finally {
      setBulkLoading(false);
    }
  };

  const bulkEnableBackorders = async () => {
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from("master_products")
        .update({
          backorders_allowed: true,
          updated_at: new Date().toISOString(),
        })
        .in("id", ids);
      if (error) throw error;
      toast.success(`Restordre aktiveret for ${ids.length} produkter`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["master_products"] });
    } catch (err: any) {
      toast.error("Fejl: " + (err.message ?? "Ukendt fejl"));
    } finally {
      setBulkLoading(false);
    }
  };
  const { data: duplicateEans } = useQuery({
    queryKey: ["duplicate_eans"],
    queryFn: async () => {
      const { data } = await supabase
        .from("import_logs")
        .select("duplicate_eans")
        .eq("source", "woocommerce")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      const eans = (data?.duplicate_eans as string[] | null) ?? [];
      return new Set(eans);
    },
  });

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

      // Duplicate filter
      if (duplicateFilter === "fallback_ean" && !product.ean.startsWith("wc-")) return false;
      if (duplicateFilter === "shared_ean" && (!duplicateEans || !duplicateEans.has(product.ean))) return false;

      return true;
    });
  }, [products, stockFilter, brandFilter, categoryFilter, marginFilter, priceFilter, supplierFilter, statusFilter, duplicateFilter, duplicateEans]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortField === "title") return dir * a.title.localeCompare(b.title, "da");
      if (sortField === "ean") return dir * a.ean.localeCompare(b.ean);
      if (sortField === "brand") return dir * (a.brand ?? "").localeCompare(b.brand ?? "", "da");
      if (sortField === "stock_quantity") return dir * ((a.stock_quantity ?? 0) - (b.stock_quantity ?? 0));
      if (sortField === "purchase_price") {
        const cA = getCheapestSupplierAny(a.supplier_products)?.purchase_price ?? 0;
        const cB = getCheapestSupplierAny(b.supplier_products)?.purchase_price ?? 0;
        return dir * (cA - cB);
      }
      if (sortField === "webshop_price") {
        const pA = a.sale_price ?? a.webshop_price ?? 0;
        const pB = b.sale_price ?? b.webshop_price ?? 0;
        return dir * (pA - pB);
      }
      if (sortField === "recommended") {
        const cA = getCheapestSupplierAny(a.supplier_products);
        const cB = getCheapestSupplierAny(b.supplier_products);
        const rA = cA ? getRecommendedPriceInclVat(cA.purchase_price, a.custom_markup_percentage ?? globalMarkup) : 0;
        const rB = cB ? getRecommendedPriceInclVat(cB.purchase_price, b.custom_markup_percentage ?? globalMarkup) : 0;
        return dir * (rA - rB);
      }
      if (sortField === "margin") {
        const cA = getCheapestSupplierAny(a.supplier_products)?.purchase_price;
        const cB = getCheapestSupplierAny(b.supplier_products)?.purchase_price;
        const apA = a.sale_price ?? a.webshop_price;
        const apB = b.sale_price ?? b.webshop_price;
        const mA = apA && cA ? getMarginPercent(exVat(apA), cA) : -999;
        const mB = apB && cB ? getMarginPercent(exVat(apB), cB) : -999;
        return dir * (mA - mB);
      }
      if (sortField === "page_views") {
        const aV = analyticsMap?.get(a.id)?.page_views ?? 0;
        const bV = analyticsMap?.get(b.id)?.page_views ?? 0;
        return dir * (aV - bV);
      }
      if (sortField === "conversion_rate") {
        const aC = analyticsMap?.get(a.id)?.conversion_rate ?? 0;
        const bC = analyticsMap?.get(b.id)?.conversion_rate ?? 0;
        return dir * (aC - bC);
      }
      if (sortField === "updated_at") return dir * (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      return 0;
    });
  }, [filtered, sortField, sortDir, globalMarkup, analyticsMap]);

  const setSortField = (v: SortField) => setParam("sort", v);
  const setSortDir = (v: SortDir) => setParam("dir", v);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const activeFilterCount = [stockFilter, brandFilter, categoryFilter, marginFilter, priceFilter, supplierFilter, statusFilter, duplicateFilter].filter((f) => f !== "all").length;

  const clearFilters = () => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      ["stock", "brand", "category", "margin", "price", "supplier", "status", "duplicate"].forEach(k => next.delete(k));
      return next;
    }, { replace: true });
  };

  const formatPrice = (price: number | null) => {
    if (price === null || price === undefined) return "—";
    return new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" }).format(price);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Produkter</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Master produktliste – {sorted.length} af {products.length} produkter
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <Download className="h-3.5 w-3.5" />
                Eksportér til Dinero
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3" align="end">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">Dinero CSV-eksport</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Eksporterer i Dinero-skabelonens format (semikolon, UTF-8). Pris konverteres til ekskl. moms.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const list = sorted.filter(p => selectedIds.size === 0 || selectedIds.has(p.id));
                      if (list.length === 0) {
                        toast.error("Ingen produkter at eksportere");
                        return;
                      }
                      downloadDineroCsv(list, `dinero-produkter-${new Date().toISOString().slice(0,10)}.csv`);
                      toast.success(`${list.length} produkter eksporteret`);
                    }}
                  >
                    {selectedIds.size > 0 ? `Eksportér ${selectedIds.size} valgte` : `Eksportér ${sorted.length} synlige`}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      if (products.length === 0) {
                        toast.error("Ingen produkter at eksportere");
                        return;
                      }
                      downloadDineroCsv(products, `dinero-produkter-alle-${new Date().toISOString().slice(0,10)}.csv`);
                      toast.success(`${products.length} produkter eksporteret`);
                    }}
                  >
                    Eksportér alle ({products.length})
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          <Button
            variant={view === "grid" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-2"
            onClick={() => setParam("view", "grid")}
            title="Kort-visning"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-2"
            onClick={() => setParam("view", "list")}
            title="Liste-visning"
          >
            <List className="h-4 w-4" />
          </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="relative w-full max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Søg på titel, EAN eller brand..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
            <Filter className="h-4 w-4" />
          </div>

          <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as StockFilter)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Lagerstatus" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle lagerstatus</SelectItem>
              <SelectItem value="instock">På lager</SelectItem>
              <SelectItem value="outofstock">Udsolgt</SelectItem>
              <SelectItem value="backorder">Restordre</SelectItem>
            </SelectContent>
          </Select>

          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
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
            <SelectTrigger className="h-8 w-[140px] text-xs">
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
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="Avance" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle avancer</SelectItem>
              <SelectItem value="low">Lav (&lt;10%)</SelectItem>
              <SelectItem value="medium">Medium (10-20%)</SelectItem>
              <SelectItem value="good">God (&gt;20%)</SelectItem>
            </SelectContent>
          </Select>

          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
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
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statusser</SelectItem>
              <SelectItem value="on_stock">På lager</SelectItem>
              <SelectItem value="out_of_stock">Udsolgt</SelectItem>
              <SelectItem value="no_data">Ingen data</SelectItem>
            </SelectContent>
          </Select>

          <Select value={duplicateFilter} onValueChange={(v) => setDuplicateFilter(v as DuplicateFilter)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Dubletter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle produkter</SelectItem>
              <SelectItem value="fallback_ean">Fallback-EAN (wc-)</SelectItem>
              <SelectItem value="shared_ean">Delt EAN</SelectItem>
            </SelectContent>
          </Select>

          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 gap-1 text-xs">
              <X className="h-3 w-3" />
              Ryd ({activeFilterCount})
            </Button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 flex-wrap">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{selectedIds.size} valgt</span>
          <div className="flex items-center gap-2 ml-2 flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs" disabled={bulkLoading}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Aktivér lager-sync ({bulkSyncSupplierIds.length} valgt)
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3" align="start">
                <div className="space-y-3">
                  <p className="text-sm font-medium">Vælg leverandører til sync</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {suppliers.map((s) => (
                      <div key={s.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`bulk-sync-${s.id}`}
                          checked={bulkSyncSupplierIds.includes(s.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setBulkSyncSupplierIds((prev) => [...prev, s.id]);
                            } else {
                              setBulkSyncSupplierIds((prev) => prev.filter((id) => id !== s.id));
                            }
                          }}
                        />
                        <Label htmlFor={`bulk-sync-${s.id}`} className="cursor-pointer text-sm">{s.name}</Label>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Min. avance: 15% — leverandører under springes over automatisk</p>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={bulkSyncSupplierIds.length === 0 || bulkLoading}
                    onClick={() => bulkEnableStockSync(bulkSyncSupplierIds)}
                  >
                    {bulkLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                    Aktivér for {selectedIds.size} produkter
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={bulkDisableStockSync} disabled={bulkLoading}>
              Deaktivér sync
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={bulkEnableBackorders} disabled={bulkLoading}>
              Aktivér restordre
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-xs ml-auto" onClick={clearSelection}>
            <X className="h-3 w-3 mr-1" /> Ryd valg
          </Button>
        </div>
      )}

      {view === "grid" ? (
        isLoading ? (
          <div className="py-20 text-center text-muted-foreground">Indlæser...</div>
        ) : sorted.length === 0 ? (
          <div className="py-20 text-center text-muted-foreground">
            <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />
            Ingen produkter fundet
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {sorted.map((product) => {
              const a = analyticsMap?.get(product.id);
              return (
                <ProductCard
                  key={product.id}
                  product={product}
                  globalMarkup={globalMarkup}
                  pageViews={a?.page_views ?? 0}
                  convRate={a?.conversion_rate ?? 0}
                  selected={selectedIds.has(product.id)}
                  onToggleSelect={(id) => toggleSelect(id)}
                />
              );
            })}
          </div>
        )
      ) : (
      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full caption-bottom text-xs">
            <thead className="[&_tr]:border-b">
              <tr className="border-b bg-secondary/50">
                <th className="h-9 px-2 text-center align-middle font-medium text-muted-foreground w-8">
                  <Checkbox
                    checked={sorted.length > 0 && selectedIds.size === sorted.length}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Vælg alle"
                    className="mx-auto"
                  />
                </th>
                <th className="h-9 px-2 text-left align-middle font-medium text-muted-foreground w-8"></th>
                <th className="h-9 px-2 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("title")}>
                  <span className="inline-flex items-center">Produkt<SortIcon field="title" /></span>
                </th>
                <th className="h-9 px-2 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("ean")}>
                  <span className="inline-flex items-center">EAN<SortIcon field="ean" /></span>
                </th>
                <th className="h-9 px-2 text-left align-middle font-medium text-muted-foreground hidden xl:table-cell cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("brand")}>
                  <span className="inline-flex items-center">Brand<SortIcon field="brand" /></span>
                </th>
                <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("stock_quantity")}>
                  <span className="inline-flex items-center justify-end">Lager<SortIcon field="stock_quantity" /></span>
                </th>
                <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("purchase_price")}>
                  <span className="inline-flex items-center justify-end">Indkøb<SortIcon field="purchase_price" /></span>
                </th>
                <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("webshop_price")}>
                  <span className="inline-flex items-center justify-end">Webshop<SortIcon field="webshop_price" /></span>
                </th>
                <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("recommended")}>
                  <span className="inline-flex items-center justify-end">Anbef.<SortIcon field="recommended" /></span>
                </th>
                <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("margin")}>
                  <span className="inline-flex items-center justify-end">Avance<SortIcon field="margin" /></span>
                </th>
                <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("page_views")}>
                  <span className="inline-flex items-center justify-end">Besøg<SortIcon field="page_views" /></span>
                </th>
                <th className="h-9 px-2 text-right align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("conversion_rate")}>
                  <span className="inline-flex items-center justify-end">Konv.%<SortIcon field="conversion_rate" /></span>
                </th>
                <th className="h-9 px-2 text-left align-middle font-medium text-muted-foreground">Status</th>
                <th className="h-9 px-2 text-left align-middle font-medium text-muted-foreground hidden xl:table-cell cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("updated_at")}>
                  <span className="inline-flex items-center">Ændret<SortIcon field="updated_at" /></span>
                </th>
                <th className="h-9 px-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {isLoading ? (
                <tr className="border-b">
                  <td colSpan={15} className="py-8 text-center text-muted-foreground">Indlæser...</td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr className="border-b">
                  <td colSpan={15} className="py-8 text-center text-muted-foreground">
                    <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    Ingen produkter fundet
                  </td>
                </tr>
              ) : (
                sorted.map((product) => {
                  const cheapestAny = getCheapestSupplierAny(product.supplier_products);
                  const cheapestPrice = cheapestAny?.purchase_price ?? null;
                  const recommendedPriceInclVat = cheapestPrice ? getRecommendedPriceInclVat(cheapestPrice, product.custom_markup_percentage ?? globalMarkup) : null;
                  const activePrice = product.sale_price ?? product.webshop_price;
                  const activePriceExVat = activePrice ? exVat(activePrice) : null;
                  const margin = activePriceExVat && cheapestPrice ? getMarginPercent(activePriceExVat, cheapestPrice) : null;
                  const allOutOfStock = product.supplier_products.length > 0 && product.supplier_products.every((sp) => !sp.in_stock);
                  const analytics = analyticsMap?.get(product.id);
                  const pageViews = analytics?.page_views ?? 0;
                  const convRate = analytics?.conversion_rate ?? 0;

                  return (
                    <tr key={product.id} className={`border-b cursor-pointer transition-colors hover:bg-accent/50 ${selectedIds.has(product.id) ? "bg-primary/5" : ""}`} onClick={() => navigate(`/products/${product.id}`)}>
                      <td className="px-2 py-1.5 align-middle text-center">
                        <Checkbox
                          checked={selectedIds.has(product.id)}
                          onCheckedChange={() => toggleSelect(product.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Vælg produkt"
                        />
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        {product.image_url ? (
                          <img src={product.image_url} alt="" className="h-7 w-7 rounded object-cover" />
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded bg-secondary">
                            <Package className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        )}
                      </td>
                      <td className="max-w-[240px] px-2 py-1.5 align-middle font-medium text-foreground truncate">{product.title}</td>
                      <td className="px-2 py-1.5 align-middle text-muted-foreground font-mono text-[11px]">{product.ean}</td>
                      <td className="px-2 py-1.5 align-middle text-muted-foreground hidden xl:table-cell">{product.brand ?? "—"}</td>
                      <td className="px-2 py-1.5 align-middle text-right font-mono text-muted-foreground">{product.stock_quantity ?? "—"}</td>
                      <td className="px-2 py-1.5 align-middle text-right font-mono">
                        {cheapestPrice !== null ? <span className="text-foreground">{formatPrice(cheapestPrice)}</span> : "—"}
                      </td>
                      <td className="px-2 py-1.5 align-middle text-right font-mono text-foreground">
                        {product.sale_price ? <span className="text-warning">{formatPrice(product.sale_price)}</span> : product.webshop_price ? formatPrice(product.webshop_price) : "—"}
                      </td>
                      <td className="px-2 py-1.5 align-middle text-right font-mono text-primary">{formatPrice(recommendedPriceInclVat)}</td>
                      <td className="px-2 py-1.5 align-middle text-right">
                        {margin !== null ? (
                          <Badge variant="outline" className={margin < 10 ? "text-destructive border-destructive/30 text-xs" : margin < 20 ? "text-warning border-warning/30 text-xs" : "text-success border-success/30 text-xs"}>
                            {margin.toFixed(1)}%
                          </Badge>
                        ) : "—"}
                      </td>
                      <td className="px-2 py-1.5 align-middle text-right font-mono">
                        {analytics ? <span className={pageViews > 0 ? "text-foreground" : "text-muted-foreground"}>{pageViews}</span> : "—"}
                      </td>
                      <td className="px-2 py-1.5 align-middle text-right font-mono">
                        {analytics ? <span className={convRate > 0 ? "text-success" : "text-muted-foreground"}>{convRate.toFixed(1)}%</span> : "—"}
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        {allOutOfStock ? (
                          <Badge variant="destructive" className="text-xs">Udsolgt</Badge>
                        ) : product.supplier_products.length > 0 ? (
                          <Badge variant="outline" className="text-success border-success/30 text-xs">På lager</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Ingen data</Badge>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-middle text-muted-foreground hidden xl:table-cell whitespace-nowrap">
                        {format(new Date(product.updated_at), "d. MMM yyyy", { locale: da })}
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(`/products/${product.id}`, "_blank");
                          }}
                          title="Åbn i nyt vindue"
                        >
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}