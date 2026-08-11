import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Search, ScanBarcode, ExternalLink, Package, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { inclVat, getRecommendedPriceInclVat, VAT_RATE } from "@/hooks/use-products";
import { applyRoundingWithMinMargin } from "@/lib/price-rounding";

export type EanLookupOffer = {
  supplier_id: string;
  supplier_name: string;
  purchase_price: number;
  in_stock: boolean;
  stock_quantity: number | null;
  supplier_sku: string | null;
  last_updated: string | null;
  product_title?: string | null;
  brand?: string | null;
  image_url?: string | null;
  source?: "linked" | "feed";
};

export type EanLookupResult = {
  ean: string;
  ean_normalized: string;
  master_product: {
    id: string;
    title: string;
    ean: string;
    image_url: string | null;
    webshop_price: number | null;
    sale_price: number | null;
    brand: string | null;
    sku: string | null;
  } | null;
  offers: EanLookupOffer[];
};

export type EanLookupSelection = {
  ean: string;
  offer: EanLookupOffer;
  master_product: EanLookupResult["master_product"];
  sellingPriceInclVat: number;
  markupPct: number;
};

type Props = {
  /** Render inline (as a page) instead of a modal. */
  asPage?: boolean;
  /** Only used when asPage=false. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional label for the "use price" action, e.g. "Tilføj til tilbud". */
  useLabel?: string;
  onUse?: (selection: EanLookupSelection) => void;
  /** Prefill the EAN input. */
  initialEan?: string;
};

type PriceRules = { markupPct: number; roundingMode: string; minMarginPct: number };

async function fetchPriceRules(): Promise<PriceRules> {
  const { data } = await supabase
    .from("price_settings")
    .select("scope, scope_value, markup_percentage, minimum_margin");
  const rows = (data ?? []) as any[];
  const global = rows.find((r) => r.scope === "global");
  const rounding = rows.find((r) => r.scope === "price_rounding");
  return {
    markupPct: Number(global?.markup_percentage ?? 25),
    roundingMode: String(rounding?.scope_value ?? "nearest_5"),
    minMarginPct: Number(global?.minimum_margin ?? 15),
  };
}

export function SupplierEanLookupPanel({ useLabel, onUse, initialEan }: Omit<Props, "asPage" | "open" | "onOpenChange">) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [ean, setEan] = useState(initialEan ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EanLookupResult | null>(null);
  const [markupPct, setMarkupPct] = useState<number>(25);
  const [rules, setRules] = useState<PriceRules>({ markupPct: 25, roundingMode: "nearest_5", minMarginPct: 15 });
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  useEffect(() => {
    fetchPriceRules()
      .then((r) => { setRules(r); setMarkupPct(r.markupPct); })
      .catch(() => {});
  }, []);

  const suggestedPrice = (purchasePrice: number) =>
    applyRoundingWithMinMargin(
      getRecommendedPriceInclVat(purchasePrice, markupPct),
      rules.roundingMode,
      purchasePrice,
      rules.minMarginPct,
    );

  const startCreate = (offer: EanLookupOffer) => {
    if (!result) return;
    navigate("/products/new", {
      state: {
        prefill: {
          ean: result.ean_normalized,
          title: offer.product_title ?? "",
          brand: offer.brand ?? "",
          sku: offer.supplier_sku ?? "",
          image_url: offer.image_url ?? "",
          webshop_price: suggestedPrice(offer.purchase_price).toFixed(2),
          purchase_price: offer.purchase_price,
          supplier_name: offer.supplier_name,
        },
      },
    });
  };

  const runSearch = async () => {
    const q = ean.trim();
    if (!q) return;
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("supplier-ean-lookup", { body: { ean: q } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error(JSON.stringify((data as any).error));
      setResult(data as EanLookupResult);
    } catch (err: any) {
      toast({ title: "Fejl", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <Label className="text-xs">EAN</Label>
          <Input
            autoFocus
            inputMode="numeric"
            placeholder="Scan eller indtast EAN…"
            value={ean}
            onChange={(e) => setEan(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            className="font-mono"
          />
        </div>
        <div className="sm:w-40">
          <Label className="text-xs">Avance %</Label>
          <Input
            type="number"
            step="0.1"
            value={markupPct}
            onChange={(e) => setMarkupPct(parseFloat(e.target.value) || 0)}
            className="font-mono"
          />
        </div>
        <div className="flex items-end">
          <Button onClick={runSearch} disabled={loading || !ean.trim()} className="w-full sm:w-auto">
            {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
            Søg
          </Button>
        </div>
      </div>

      {result && (
        <div className="space-y-3">
          {result.master_product ? (
            <div className="flex items-center gap-3 rounded-md border border-border bg-secondary/30 p-3">
              {result.master_product.image_url ? (
                <img src={result.master_product.image_url} alt="" className="h-12 w-12 rounded object-cover bg-background" />
              ) : (
                <div className="h-12 w-12 rounded bg-background flex items-center justify-center"><Package className="h-5 w-5 text-muted-foreground" /></div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{result.master_product.title}</div>
                <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                  <span>EAN: {result.master_product.ean}</span>
                  {result.master_product.brand && <span>{result.master_product.brand}</span>}
                  {result.master_product.webshop_price != null && (
                    <span>Webshop: {Number(result.master_product.webshop_price).toFixed(2)} kr.</span>
                  )}
                </div>
              </div>
              <Link to={`/products/${result.master_product.id}`}>
                <Button variant="outline" size="sm">
                  <ExternalLink className="h-3.5 w-3.5 mr-1" /> Åbn
                </Button>
              </Link>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-secondary/20 p-4 text-sm space-y-3">
              <div>
                <p className="font-medium">Intet produkt oprettet med EAN {result.ean_normalized}</p>
                <p className="text-muted-foreground mt-1">
                  {result.offers.length > 0
                    ? `Fundet ${result.offers.length} leverandør-tilbud fra feed-cachen nedenfor.`
                    : "Ingen leverandører har dette EAN i deres feed endnu."}
                </p>
              </div>

              {result.offers.length > 0 && (() => {
                const chosen =
                  result.offers.find((o) => o.supplier_id === selectedSupplierId) ?? result.offers[0];
                return (
                  <div className="rounded-md border border-border bg-background p-3 space-y-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground tracking-wide">
                      Opret produkt i PIM
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Brug data fra leverandør</Label>
                      <select
                        className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={chosen.supplier_id}
                        onChange={(e) => setSelectedSupplierId(e.target.value)}
                      >
                        {result.offers.map((o) => (
                          <option key={o.supplier_id} value={o.supplier_id}>
                            {o.supplier_name} — {o.purchase_price.toFixed(2)} kr.
                            {o.in_stock ? "" : " (ikke på lager)"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-3">
                      {chosen.image_url ? (
                        <img src={chosen.image_url} alt="" className="h-16 w-16 rounded object-contain bg-secondary/40 border border-border" />
                      ) : (
                        <div className="h-16 w-16 rounded bg-secondary/40 border border-border flex items-center justify-center">
                          <Package className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 text-xs space-y-0.5">
                        <div className="font-medium text-sm truncate">{chosen.product_title || "(ingen titel i feed)"}</div>
                        <div className="text-muted-foreground">
                          {[chosen.brand, chosen.supplier_sku && `SKU ${chosen.supplier_sku}`].filter(Boolean).join(" · ") || "—"}
                        </div>
                        <div className="text-muted-foreground">
                          Indkøb {chosen.purchase_price.toFixed(2)} kr. → foreslået salgspris{" "}
                          <span className="font-mono font-semibold text-primary">
                            {suggestedPrice(chosen.purchase_price).toFixed(2)} kr.
                          </span>{" "}
                          inkl. moms
                        </div>
                        {!chosen.image_url && (
                          <div className="text-muted-foreground italic">Feedet har intet billede — du kan indsætte en URL selv.</div>
                        )}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => startCreate(chosen)}>
                      <Sparkles className="h-4 w-4 mr-1" /> Opret produkt med AI-tekster
                    </Button>
                  </div>
                );
              })()}

              {result.offers.length === 0 && (
                <div>
                  <Link to={`/products/new?ean=${encodeURIComponent(result.ean_normalized)}`}>
                    <Button size="sm"><Package className="h-4 w-4 mr-1" /> Opret produkt</Button>
                  </Link>
                </div>
              )}
            </div>
          )}

          {(result.master_product || result.offers.length > 0) && (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase text-muted-foreground tracking-wide">
                Leverandørpriser ({result.offers.length})
              </div>
              {result.offers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
                  Ingen leverandører har dette produkt endnu.
                </p>
              ) : (
                <div className="space-y-2">
                  {result.offers.map((offer) => {
                    const sellingEx = offer.purchase_price * (1 + markupPct / 100);
                    const sellingIncl = getRecommendedPriceInclVat(offer.purchase_price, markupPct);
                    return (
                      <div
                        key={offer.supplier_id + (offer.supplier_sku ?? "")}
                        className="rounded-md border border-border p-3 flex flex-col sm:flex-row sm:items-center gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{offer.supplier_name}</span>
                            {offer.in_stock ? (
                              <Badge variant="outline" className="text-green-700 border-green-400 bg-green-50">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> På lager{offer.stock_quantity != null ? ` (${offer.stock_quantity})` : ""}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">
                                <XCircle className="h-3 w-3 mr-1" /> Ikke på lager
                              </Badge>
                            )}
                          </div>
                          {(offer.product_title || offer.brand) && !result.master_product && (
                            <div className="text-xs text-foreground/80 mt-0.5 truncate">
                              {[offer.brand, offer.product_title].filter(Boolean).join(" · ")}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                            {offer.supplier_sku && <span>SKU: {offer.supplier_sku}</span>}
                            {offer.last_updated && <span>Opdateret: {new Date(offer.last_updated).toLocaleDateString("da-DK")}</span>}
                            {offer.source === "feed" && <span className="italic">fra feed-cache</span>}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 sm:gap-6 text-sm">
                          <div>
                            <div className="text-xs text-muted-foreground">Indkøb ex.moms</div>
                            <div className="font-mono font-medium">{offer.purchase_price.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Udsalg ex.moms</div>
                            <div className="font-mono">{sellingEx.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Udsalg inkl. moms</div>
                            <div className="font-mono font-semibold text-primary">{sellingIncl.toFixed(2)}</div>
                          </div>
                        </div>
                        {onUse && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onUse({
                              ean: result.ean_normalized,
                              offer,
                              master_product: result.master_product,
                              sellingPriceInclVat: sellingIncl,
                              markupPct,
                            })}
                          >
                            {useLabel ?? "Brug"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-muted-foreground pt-1">
                Priser ex. moms. Udsalg beregnet med {markupPct}% avance + {(VAT_RATE * 100).toFixed(0)}% moms.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SupplierEanLookupDialog({ asPage, open, onOpenChange, useLabel, onUse, initialEan }: Props) {
  if (asPage) {
    return <SupplierEanLookupPanel useLabel={useLabel} onUse={onUse} initialEan={initialEan} />;
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5" /> EAN-opslag på tværs af leverandører
          </DialogTitle>
        </DialogHeader>
        <SupplierEanLookupPanel useLabel={useLabel} onUse={onUse} initialEan={initialEan} />
      </DialogContent>
    </Dialog>
  );
}
