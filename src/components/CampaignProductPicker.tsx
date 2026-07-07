import { useMemo, useState } from "react";
import { useMasterProducts } from "@/hooks/use-products";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Search, X, Package, ListPlus } from "lucide-react";

type Selected = { id: string; title: string; ean: string | null; image_url: string | null; webshop_price: number | null; sale_price: number | null; cheapest_purchase_price?: number | null };
const VAT_RATE = 0.25;

interface Props {
  selectedIds: Set<string>;
  selectedMap: Map<string, Selected>;
  onAdd: (p: Selected) => void;
  onAddMany: (ps: Selected[]) => void;
  onRemove: (id: string) => void;
  discountPercent: number;
}

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" }).format(n);

function getCats(p: any): string[] {
  const arr = p.categories;
  if (Array.isArray(arr) && arr.length > 0) return arr.filter(Boolean);
  return p.category ? [p.category] : [];
}

function getCheapestPurchase(p: any): number | null {
  const rows = (p.supplier_products ?? [])
    .map((sp: any) => ({
      purchase: sp.purchase_price == null ? null : Number(sp.purchase_price),
      inStock: sp.in_stock === true && (sp.stock_quantity == null || Number(sp.stock_quantity) > 0),
    }))
    .filter((sp: { purchase: number | null }) => sp.purchase != null && Number.isFinite(sp.purchase) && sp.purchase > 0);
  if (rows.length === 0) return null;
  const inStockRows = rows.filter((sp: { inStock: boolean }) => sp.inStock);
  const pool = inStockRows.length > 0 ? inStockRows : rows;
  return Math.min(...pool.map((sp: { purchase: number }) => sp.purchase));
}

export default function CampaignProductPicker({ selectedIds, selectedMap, onAdd, onAddMany, onRemove, discountPercent }: Props) {
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  // Load full catalogue once so brand/category dropdowns are populated
  const { data, isLoading } = useMasterProducts();

  const products = data ?? [];

  const brands = useMemo(() => {
    const pool = category === "all" ? products : products.filter((p) => getCats(p).includes(category));
    return [...new Set(pool.map((p) => p.brand).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "da"));
  }, [products, category]);

  const categories = useMemo(() => {
    const pool = brand === "all" ? products : products.filter((p) => p.brand === brand);
    const set = new Set<string>();
    pool.forEach((p) => getCats(p).forEach((c) => set.add(c)));
    return [...set].sort((a, b) => a.localeCompare(b, "da"));
  }, [products, brand]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (brand !== "all" && p.brand !== brand) return false;
      if (category !== "all" && !getCats(p).includes(category)) return false;
      if (q) {
        const hay = `${p.title ?? ""} ${p.ean ?? ""} ${p.brand ?? ""} ${(p as any).sku ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, search, brand, category]);

  const results = filtered.slice(0, 100);
  const anyFilter = search.trim() !== "" || brand !== "all" || category !== "all";

  const toSelected = (p: any): Selected => ({
    id: p.id, title: p.title, ean: p.ean, image_url: p.image_url,
    webshop_price: p.webshop_price, sale_price: p.sale_price ?? null,
    cheapest_purchase_price: getCheapestPurchase(p),
  });

  const addAll = () => {
    const toAdd = filtered.filter((p) => !selectedIds.has(p.id)).map(toSelected);
    if (toAdd.length === 0) return;
    onAddMany(toAdd);
  };

  const calcSale = (webshop: number | null) =>
    webshop == null ? null : Math.round(webshop * (1 - discountPercent / 100) * 100) / 100;

  const isBelowPurchase = (sale: number | null, purchase: number | null | undefined) =>
    sale != null && purchase != null && sale / (1 + VAT_RATE) + 0.005 < purchase;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Tilføj produkter</h3>
          {anyFilter && (
            <Button size="sm" variant="secondary" onClick={addAll} disabled={filtered.length === 0}>
              <ListPlus className="h-3.5 w-3.5 mr-1" /> Tilføj alle ({filtered.length})
            </Button>
          )}
        </div>

        <div className="space-y-2 mb-3">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søg titel, EAN, SKU, brand..."
              className="pl-8"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={brand} onValueChange={setBrand}>
              <SelectTrigger><SelectValue placeholder="Brand" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle brands</SelectItem>
                {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Kategori" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle kategorier</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(brand !== "all" || category !== "all" || search) && (
            <Button size="sm" variant="ghost" onClick={() => { setBrand("all"); setCategory("all"); setSearch(""); }}>
              Nulstil filtre
            </Button>
          )}
        </div>

        <div className="max-h-[500px] overflow-y-auto space-y-1">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !anyFilter ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Vælg et brand, en kategori eller søg for at se produkter</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Ingen resultater</p>
          ) : (
            <>
              {results.map((p) => {
                const already = selectedIds.has(p.id);
                const newSale = calcSale(p.webshop_price);
                const cheapestPurchase = getCheapestPurchase(p);
                const belowPurchase = isBelowPurchase(newSale, cheapestPurchase);
                return (
                  <div key={p.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                    <div className="h-10 w-10 flex-shrink-0 rounded bg-secondary/40 flex items-center justify-center overflow-hidden">
                      {p.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-contain" /> : <Package className="h-5 w-5 text-muted-foreground/40" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{p.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.brand} · {fmt(p.webshop_price)}
                        {p.sale_price != null && <span className="text-warning"> · nu {fmt(p.sale_price)}</span>}
                        {belowPurchase && <span className="text-destructive"> · under indkøb ({fmt(cheapestPurchase)})</span>}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={already ? "ghost" : "secondary"}
                      disabled={already || belowPurchase}
                      onClick={() => onAdd(toSelected(p))}
                    >
                      {already ? "Tilføjet" : belowPurchase ? "Blokeret" : <><Plus className="h-3.5 w-3.5 mr-1" />Tilføj</>}
                    </Button>
                  </div>
                );
              })}
              {filtered.length > results.length && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Viser {results.length} af {filtered.length} — indsnævr filtre eller brug "Tilføj alle"
                </p>
              )}
            </>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Valgte produkter ({selectedIds.size})</h3>
          {selectedIds.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => [...selectedIds].forEach(onRemove)}>Ryd alle</Button>
          )}
        </div>
        <div className="max-h-[500px] overflow-y-auto space-y-1">
          {selectedIds.size === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Ingen produkter valgt endnu</p>
          ) : (
            [...selectedMap.values()].map((p) => {
              const newSale = calcSale(p.webshop_price);
              const belowPurchase = isBelowPurchase(newSale, p.cheapest_purchase_price);
              return (
                <div key={p.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                  <div className="h-10 w-10 flex-shrink-0 rounded bg-secondary/40 flex items-center justify-center overflow-hidden">
                    {p.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-contain" /> : <Package className="h-5 w-5 text-muted-foreground/40" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {fmt(p.webshop_price)} → <span className="text-primary font-semibold">{fmt(newSale)}</span>
                      {p.sale_price != null && <span className="text-warning"> · allerede på tilbud ({fmt(p.sale_price)})</span>}
                      {belowPurchase && <span className="text-destructive"> · under indkøb ({fmt(p.cheapest_purchase_price)})</span>}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => onRemove(p.id)} aria-label="Fjern">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
