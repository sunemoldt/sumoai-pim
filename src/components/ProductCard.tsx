import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Package, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const cheapestAny = getCheapestSupplierAny(product.supplier_products);
  const cheapestPrice = cheapestAny?.purchase_price ?? null;
  const recommended = cheapestPrice
    ? getRecommendedPriceInclVat(cheapestPrice, product.custom_markup_percentage ?? globalMarkup)
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
      </div>
    </Card>
  );
}
