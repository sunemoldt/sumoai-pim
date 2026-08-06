import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Percent, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { applyRounding } from "@/lib/price-rounding";
import { usePriceSettings, exVat, inclVat, getMarginPercent, priceFromMargin } from "@/hooks/use-products";

type Row = {
  id: string;
  title: string;
  brand: string | null;
  category: string | null;
  categories: string[] | null;
  webshop_price: number | null;
  sale_price: number | null;
  custom_markup_percentage: number | null;
  min_sync_margin: number | null;
  stock_sync_supplier_ids: string[] | null;
  supplier_products: {
    supplier_id: string;
    purchase_price: number;
    in_stock: boolean;
    suppliers: { id: string; name: string; priority: number | null } | null;
  }[];
};

const formatPrice = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" }).format(n);

/** Cheapest purchase price among the suppliers actually selected for this product. */
function pickSupplier(p: Row) {
  const selected = p.stock_sync_supplier_ids ?? [];
  const pool = selected.length > 0
    ? p.supplier_products.filter((sp) => selected.includes(sp.supplier_id))
    : [];
  if (pool.length === 0) return null;
  const valid = pool.filter((sp) => sp.purchase_price != null && sp.purchase_price > 0);
  if (valid.length === 0) return null;
  const inStock = valid.filter((sp) => sp.in_stock);
  const candidates = inStock.length > 0 ? inStock : valid;
  // Supplier priority wins over price (lower priority number = higher priority)
  return candidates.reduce((best, sp) => {
    const bp = best.suppliers?.priority ?? 999;
    const cp = sp.suppliers?.priority ?? 999;
    if (cp !== bp) return cp < bp ? sp : best;
    return sp.purchase_price < best.purchase_price ? sp : best;
  });
}

export default function BulkPricingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: priceSettings = [] } = usePriceSettings();
  const roundingMode = priceSettings.find((s) => s.scope === "price_rounding")?.scope_value ?? "nearest_5";

  const [mode, setMode] = useState<"brand" | "category">(
    searchParams.get("category") ? "category" : "brand"
  );
  const [brand, setBrand] = useState<string>(searchParams.get("brand") ?? "");
  const [category, setCategory] = useState<string>(searchParams.get("category") ?? "");
  const [marginInput, setMarginInput] = useState("10");
  const [includeOnSale, setIncludeOnSale] = useState(false);
  const [includeCustomMarkup, setIncludeCustomMarkup] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<{ ok: number; failed: { title: string; error: string }[] } | null>(null);

  const { data: products = [], isLoading, refetch } = useQuery({
    queryKey: ["bulk_pricing_products"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("master_products")
        .select(
          "id,title,brand,category,categories,webshop_price,sale_price,custom_markup_percentage,stock_sync_supplier_ids," +
            "supplier_products(supplier_id,purchase_price,in_stock,suppliers(id,name,priority))"
        )
        .order("title");
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  const brands = useMemo(() => {
    const s = new Set(products.map((p) => p.brand).filter(Boolean) as string[]);
    return Array.from(s).sort((a, b) => a.localeCompare(b, "da"));
  }, [products]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const p of products) {
      const arr = Array.isArray(p.categories) && p.categories.length > 0 ? p.categories : p.category ? [p.category] : [];
      for (const c of arr) if (c) s.add(c);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, "da"));
  }, [products]);

  const targetMargin = Number(marginInput);
  const marginValid = Number.isFinite(targetMargin) && targetMargin > 0 && targetMargin < 95;

  const preview = useMemo(() => {
    if (mode === "brand" ? !brand : !category) return [];
    const scoped = products.filter((p) => {
      if (mode === "brand") return p.brand === brand;
      const arr = Array.isArray(p.categories) && p.categories.length > 0 ? p.categories : p.category ? [p.category] : [];
      return arr.includes(category);
    });

    return scoped.map((p) => {
      const sp = pickSupplier(p);
      const purchase = sp?.purchase_price ?? null;
      const currentActive = p.sale_price ?? p.webshop_price;
      const currentMargin =
        currentActive != null && purchase != null ? getMarginPercent(exVat(currentActive), purchase) : null;

      let skip: string | null = null;
      if (purchase == null) skip = "Ingen valgt leverandør / indkøbspris";
      else if (p.sale_price != null && !includeOnSale) skip = "På tilbud";
      else if (p.custom_markup_percentage != null && !includeCustomMarkup) skip = "Egen markup";

      const newExVat = marginValid && purchase != null ? priceFromMargin(purchase, targetMargin) : null;
      const newPrice = newExVat != null ? applyRounding(inclVat(newExVat), roundingMode) : null;
      const newMargin = newPrice != null && purchase != null ? getMarginPercent(exVat(newPrice), purchase) : null;
      const unchanged = newPrice != null && p.webshop_price != null && Math.abs(newPrice - p.webshop_price) < 0.005;

      return {
        id: p.id,
        title: p.title,
        supplierName: sp?.suppliers?.name ?? null,
        purchase,
        currentPrice: p.webshop_price,
        currentMargin,
        newPrice,
        newMargin,
        skip: skip ?? (unchanged ? "Uændret" : null),
      };
    });
  }, [products, mode, brand, category, includeOnSale, includeCustomMarkup, marginValid, targetMargin, roundingMode]);

  const applicable = preview.filter((r) => !r.skip && !excluded.has(r.id) && r.newPrice != null);
  const skipped = preview.filter((r) => r.skip);

  const apply = async () => {
    if (applicable.length === 0) return;
    setApplying(true);
    setResults(null);
    const failed: { title: string; error: string }[] = [];
    let ok = 0;
    // Equivalent markup on purchase price, so the product keeps the same rule going forward.
    const equivalentMarkup = Math.round((100 / (1 - targetMargin / 100) - 100) * 100) / 100;

    for (const row of applicable) {
      const { error } = await supabase
        .from("master_products")
        .update({
          webshop_price: row.newPrice,
          custom_markup_percentage: equivalentMarkup,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) failed.push({ title: row.title, error: error.message });
      else ok++;
    }

    setApplying(false);
    setResults({ ok, failed });
    if (failed.length === 0) toast.success(`${ok} produkter opdateret og lagt i Shopify-kø`);
    else toast.warning(`${ok} opdateret, ${failed.length} fejlede`);
    refetch();
  };

  const target = mode === "brand" ? brand : category;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Tilbage
        </Button>
        <h1 className="text-xl font-semibold">Masse-prisjustering</h1>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Percent className="h-4 w-4 text-primary" /> Vælg målgruppe og ønsket avance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Filtrér efter</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "brand" | "category")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="brand">Producent (brand)</SelectItem>
                  <SelectItem value="category">Kategori</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{mode === "brand" ? "Producent" : "Kategori"}</Label>
              <Select
                value={target || undefined}
                onValueChange={(v) => (mode === "brand" ? setBrand(v) : setCategory(v))}
              >
                <SelectTrigger><SelectValue placeholder={isLoading ? "Indlæser..." : "Vælg..."} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {(mode === "brand" ? brands : categories).map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ønsket avance (%)</Label>
              <Input
                type="number"
                value={marginInput}
                onChange={(e) => setMarginInput(e.target.value)}
                min={1}
                max={94}
                step="0.5"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={includeOnSale} onCheckedChange={(v) => setIncludeOnSale(!!v)} />
              Medtag varer på tilbud
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={includeCustomMarkup} onCheckedChange={(v) => setIncludeCustomMarkup(!!v)} />
              Medtag varer med egen markup
            </label>
          </div>

          <p className="text-xs text-muted-foreground">
            Ny pris = indkøbspris fra billigste valgte leverandør ÷ (1 − avance), + 25% moms, afrundet efter reglen
            <span className="font-medium"> {roundingMode}</span>. Lav-avance-vagt, lageropdatering og pris-alarmer kører
            uændret bagefter.
          </p>
        </CardContent>
      </Card>

      {target && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base font-medium">
              Forhåndsvisning — {preview.length} varer
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {applicable.length} opdateres · {skipped.length} springes over
              </span>
            </CardTitle>
            <Button size="sm" onClick={apply} disabled={applying || applicable.length === 0 || !marginValid}>
              {applying ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Anvend på {applicable.length}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {/* Mobile cards */}
            <div className="divide-y md:hidden">
              {preview.map((r) => (
                <div key={r.id} className="p-3 space-y-1">
                  <div className="flex items-start gap-2">
                    {!r.skip && (
                      <Checkbox
                        checked={!excluded.has(r.id)}
                        onCheckedChange={(v) => {
                          setExcluded((prev) => {
                            const n = new Set(prev);
                            if (v) n.delete(r.id); else n.add(r.id);
                            return n;
                          });
                        }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.supplierName ?? "ingen leverandør"} · indkøb {formatPrice(r.purchase)}
                      </div>
                      <div className="text-xs">
                        {formatPrice(r.currentPrice)} → <span className="font-medium">{formatPrice(r.newPrice)}</span>
                        {r.currentMargin != null && r.newMargin != null && (
                          <span className="text-muted-foreground"> ({r.currentMargin}% → {r.newMargin}%)</span>
                        )}
                      </div>
                      {r.skip && <Badge variant="secondary" className="mt-1 text-[10px]">{r.skip}</Badge>}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="h-9 w-10 px-2"></th>
                    <th className="h-9 px-2 text-left font-medium">Produkt</th>
                    <th className="h-9 px-2 text-left font-medium">Leverandør</th>
                    <th className="h-9 px-2 text-right font-medium">Indkøb</th>
                    <th className="h-9 px-2 text-right font-medium">Nuv. pris</th>
                    <th className="h-9 px-2 text-right font-medium">Ny pris</th>
                    <th className="h-9 px-2 text-right font-medium">Avance</th>
                    <th className="h-9 px-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.id} className={`border-b ${r.skip ? "opacity-60" : ""}`}>
                      <td className="px-2 py-1.5 text-center">
                        {!r.skip && (
                          <Checkbox
                            checked={!excluded.has(r.id)}
                            onCheckedChange={(v) => {
                              setExcluded((prev) => {
                                const n = new Set(prev);
                                if (v) n.delete(r.id); else n.add(r.id);
                                return n;
                              });
                            }}
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5 max-w-[320px] truncate">{r.title}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.supplierName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">{formatPrice(r.purchase)}</td>
                      <td className="px-2 py-1.5 text-right">{formatPrice(r.currentPrice)}</td>
                      <td className="px-2 py-1.5 text-right font-medium">{formatPrice(r.newPrice)}</td>
                      <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
                        {r.currentMargin != null ? `${r.currentMargin}%` : "—"} → {r.newMargin != null ? `${r.newMargin}%` : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.skip ? <Badge variant="secondary" className="text-[10px]">{r.skip}</Badge> : null}
                      </td>
                    </tr>
                  ))}
                  {preview.length === 0 && (
                    <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Ingen varer matcher</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {results && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Resultat</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{results.ok} produkter opdateret og lagt i Shopify-kø.</p>
            {results.failed.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium text-destructive">{results.failed.length} afvist:</p>
                <ul className="list-disc pl-5 text-xs text-muted-foreground">
                  {results.failed.map((f, i) => (
                    <li key={i}><span className="font-medium">{f.title}</span>: {f.error}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
