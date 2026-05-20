import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Package, ExternalLink, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  type MasterProductWithSuppliers,
  getCheapestSupplierAny,
  getMarginPercent,
  getRecommendedPriceInclVat,
  exVat,
} from "@/hooks/use-products";

type Props = {
  product: MasterProductWithSuppliers;
  globalMarkup: number;
  pageViews?: number;
  convRate?: number;
  selected: boolean;
  onToggleSelect: (id: string) => void;
};

const formatPrice = (price: number | null | undefined) => {
  if (price === null || price === undefined) return "—";
  return new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" }).format(price);
};

export default function ProductCard({
  product,
  globalMarkup,
  pageViews = 0,
  convRate = 0,
  selected,
  onToggleSelect,
}: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const supplierIds = Array.from(
    new Set(product.supplier_products.map((sp) => sp.supplier_id).filter(Boolean))
  );

  const handleQuickSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (supplierIds.length === 0) {
      toast({ title: "Ingen leverandører", description: "Produktet er ikke koblet til nogen leverandører.", variant: "destructive" });
      return;
    }
    setSyncing(true);
    const results = await Promise.allSettled(
      supplierIds.map((supplier_id) =>
        supabase.functions.invoke("supplier-feed-import", { body: { supplier_id } })
      )
    );
    setSyncing(false);
    const ok = results.filter((r) => r.status === "fulfilled" && !(r.value as any)?.error).length;
    const failed = results.length - ok;
    toast({
      title: failed === 0 ? "Synk fuldført" : "Synk delvist gennemført",
      description: `${ok}/${results.length} leverandør-feeds opdateret${failed > 0 ? `, ${failed} fejlede` : ""}.`,
      variant: failed === 0 ? "default" : "destructive",
    });
    qc.invalidateQueries({ queryKey: ["master_products"] });
    qc.invalidateQueries({ queryKey: ["master_product", product.id] });
  };

  const cheapestAny = getCheapestSupplierAny(product.supplier_products);
  const cheapestPrice = cheapestAny?.purchase_price ?? null;
  // Recommendation is based on the cheapest IN-STOCK supplier (avoid pricing below cost)
  const cheapestInStock = product.supplier_products
    .filter((sp) => sp.in_stock)
    .reduce<typeof product.supplier_products[number] | null>(
      (min, sp) => (!min || sp.purchase_price < min.purchase_price ? sp : min),
      null
    );
  const recommendedBasePrice = cheapestInStock?.purchase_price ?? null;
  const recommended = recommendedBasePrice
    ? getRecommendedPriceInclVat(recommendedBasePrice, product.custom_markup_percentage ?? globalMarkup)
    : null;
  const activePrice = product.sale_price ?? product.webshop_price;
  const margin =
    activePrice && cheapestPrice ? getMarginPercent(exVat(activePrice), cheapestPrice) : null;
  const allOut =
    product.supplier_products.length > 0 && product.supplier_products.every((sp) => !sp.in_stock);

  const marginColor =
    margin === null
      ? "text-muted-foreground border-border"
      : margin < 10
        ? "text-destructive border-destructive/30"
        : margin < 20
          ? "text-warning border-warning/30"
          : "text-success border-success/30";

  return (
    <Card
      className={`group relative flex cursor-pointer flex-col overflow-hidden border transition-all hover:border-primary/40 hover:shadow-md ${
        selected ? "ring-2 ring-primary" : ""
      }`}
      onClick={() => navigate(`/products/${product.id}`)}
    >
      <div className="absolute left-2 top-2 z-10" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(product.id)}
          className="bg-background shadow-sm"
          aria-label="Vælg produkt"
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 z-10 h-7 w-7 bg-background/80 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          window.open(`/products/${product.id}`, "_blank");
        }}
        title="Åbn i nyt vindue"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </Button>

      <div className="flex aspect-square w-full items-center justify-center bg-secondary/40">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.title}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        ) : (
          <Package className="h-12 w-12 text-muted-foreground/40" />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {product.brand && (
              <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                {product.brand}
              </p>
            )}
            <h3 className="line-clamp-2 text-sm font-medium text-foreground">{product.title}</h3>
          </div>
        </div>

        <p className="font-mono text-[10px] text-muted-foreground">{product.ean}</p>

        <div className="mt-auto space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">Webshop</span>
            <span className="font-mono text-sm font-semibold text-foreground">
              {product.sale_price ? (
                <span className="text-warning">{formatPrice(product.sale_price)}</span>
              ) : (
                formatPrice(product.webshop_price)
              )}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">Indkøb</span>
            <span className="font-mono text-xs text-muted-foreground">
              {formatPrice(cheapestPrice)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">Anbef.</span>
            <span className="font-mono text-xs text-primary">{formatPrice(recommended)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {margin !== null && (
            <Badge variant="outline" className={`text-[10px] ${marginColor}`}>
              {margin.toFixed(1)}%
            </Badge>
          )}
          {allOut ? (
            <Badge variant="destructive" className="text-[10px]">
              Udsolgt
            </Badge>
          ) : product.supplier_products.length > 0 ? (
            <Badge variant="outline" className="border-success/30 text-[10px] text-success">
              På lager
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">
              Ingen data
            </Badge>
          )}
          {pageViews > 0 && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {pageViews} besøg · {convRate.toFixed(1)}%
            </Badge>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="mt-2 h-7 w-full text-[11px]"
          onClick={handleQuickSync}
          disabled={syncing || supplierIds.length === 0}
          title="Hent friske data fra alle leverandører der har dette produkt"
        >
          {syncing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {syncing ? "Synker…" : `Synk leverandører (${supplierIds.length})`}
        </Button>
      </div>
    </Card>
  );
}
