import { useMemo, useState } from "react";
import { useMasterProducts } from "@/hooks/use-products";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Plus, Search, X, Package } from "lucide-react";

type Selected = { id: string; title: string; ean: string | null; image_url: string | null; webshop_price: number | null; sale_price: number | null };

interface Props {
  selectedIds: Set<string>;
  selectedMap: Map<string, Selected>;
  onAdd: (p: Selected) => void;
  onRemove: (id: string) => void;
  discountPercent: number;
}

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" }).format(n);

export default function CampaignProductPicker({ selectedIds, selectedMap, onAdd, onRemove, discountPercent }: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const { data, isLoading } = useMasterProducts(debounced || undefined);

  const results = useMemo(() => (data ?? []).slice(0, 50), [data]);

  const calcSale = (webshop: number | null) =>
    webshop == null ? null : Math.round(webshop * (1 - discountPercent / 100) * 100) / 100;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h3 className="font-medium mb-3">Tilføj produkter</h3>
        <form
          className="flex gap-2 mb-3"
          onSubmit={(e) => { e.preventDefault(); setDebounced(search); }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søg titel, EAN, SKU, brand..."
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="secondary">Søg</Button>
        </form>
        <div className="max-h-[500px] overflow-y-auto space-y-1">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !debounced ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Skriv for at søge produkter</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Ingen resultater</p>
          ) : (
            results.map((p) => {
              const already = selectedIds.has(p.id);
              return (
                <div key={p.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                  <div className="h-10 w-10 flex-shrink-0 rounded bg-secondary/40 flex items-center justify-center overflow-hidden">
                    {p.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-contain" /> : <Package className="h-5 w-5 text-muted-foreground/40" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.ean} · {fmt(p.webshop_price)}{p.sale_price != null && <span className="text-warning"> · nu {fmt(p.sale_price)}</span>}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={already ? "ghost" : "secondary"}
                    disabled={already}
                    onClick={() => onAdd({ id: p.id, title: p.title, ean: p.ean, image_url: p.image_url, webshop_price: p.webshop_price, sale_price: p.sale_price ?? null })}
                  >
                    {already ? "Tilføjet" : <><Plus className="h-3.5 w-3.5 mr-1" />Tilføj</>}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-medium mb-3">Valgte produkter ({selectedIds.size})</h3>
        <div className="max-h-[500px] overflow-y-auto space-y-1">
          {selectedIds.size === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Ingen produkter valgt endnu</p>
          ) : (
            [...selectedMap.values()].map((p) => {
              const newSale = calcSale(p.webshop_price);
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
