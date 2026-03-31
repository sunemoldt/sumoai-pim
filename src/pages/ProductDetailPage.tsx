import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMasterProduct, getCheapestSupplier, getMarginPercent, getRecommendedPrice, usePriceSettings } from "@/hooks/use-products";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, CheckCircle, XCircle, Package, Save, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: product, isLoading } = useMasterProduct(id!);
  const { data: priceSettings = [] } = usePriceSettings();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [markupInput, setMarkupInput] = useState<string | null>(null);

  const globalMarkup = priceSettings.find((s) => s.scope === "global")?.markup_percentage ?? 30;

  // Use product-specific markup if set, otherwise global
  const effectiveMarkup = product?.custom_markup_percentage != null
    ? product.custom_markup_percentage
    : globalMarkup;

  // Initialize markup input when product loads
  const displayMarkup = markupInput ?? (product?.custom_markup_percentage?.toString() ?? "");

  const formatPrice = (price: number | null | undefined) => {
    if (price === null || price === undefined) return "—";
    return new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" }).format(price);
  };

  const saveMarkup = async () => {
    if (!product) return;
    setSaving(true);
    try {
      const val = displayMarkup.trim() === "" ? null : parseFloat(displayMarkup);
      if (val !== null && isNaN(val)) {
        toast.error("Ugyldig værdi");
        return;
      }
      const { error } = await supabase
        .from("master_products")
        .update({ custom_markup_percentage: val })
        .eq("id", product.id);
      if (error) throw error;
      toast.success(val !== null ? `Avance sat til ${val}%` : "Avance nulstillet til global");
      queryClient.invalidateQueries({ queryKey: ["master_product", id] });
      setMarkupInput(null);
    } catch (err: any) {
      toast.error(err?.message || "Fejl ved gemning");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">Indlæser produkt...</div>
    );
  }

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Package className="h-12 w-12 mb-4 opacity-40" />
        <p>Produkt ikke fundet</p>
        <Button variant="ghost" onClick={() => navigate("/products")} className="mt-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Tilbage til produkter
        </Button>
      </div>
    );
  }

  const cheapest = getCheapestSupplier(product.supplier_products);
  const cheapestPrice = cheapest?.purchase_price ?? null;
  const recommendedPrice = cheapestPrice ? getRecommendedPrice(cheapestPrice, effectiveMarkup) : null;
  const currentPrice = product.sale_price ?? product.webshop_price;
  const margin = currentPrice && cheapestPrice ? getMarginPercent(currentPrice, cheapestPrice) : null;
  const priceDiff = currentPrice && recommendedPrice ? currentPrice - recommendedPrice : null;

  const attributes = (product as any).attributes as Record<string, string> | null | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/products")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-foreground">{product.title}</h1>
          <p className="text-sm text-muted-foreground">
            EAN: {product.ean}
            {(product as any).sku && <> · SKU: <span className="font-mono">{(product as any).sku}</span></>}
            {product.brand && <> · <span className="font-medium text-foreground">{product.brand}</span></>}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Billigste indkøbspris</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{formatPrice(cheapestPrice)}</p>
            {cheapest?.suppliers && <p className="text-xs text-muted-foreground mt-0.5">{cheapest.suppliers.name}</p>}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Normal salgspris</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{formatPrice(product.webshop_price)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{product.webshop_platform}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Tilbudspris</p>
            <p className={`text-2xl font-semibold mt-1 ${product.sale_price ? "text-warning" : "text-muted-foreground"}`}>
              {formatPrice(product.sale_price)}
            </p>
            {product.sale_price && product.webshop_price && (
              <p className="text-xs text-muted-foreground mt-0.5">
                -{Math.round(((product.webshop_price - product.sale_price) / product.webshop_price) * 100)}% rabat
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Anbefalet salgspris</p>
            <p className="text-2xl font-semibold text-primary mt-1">{formatPrice(recommendedPrice)}</p>
            {priceDiff !== null && (
              <p className={`text-xs mt-0.5 ${priceDiff > 0 ? "text-success" : priceDiff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                {priceDiff > 0 ? "+" : ""}{formatPrice(priceDiff)} vs. anbefalet
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Aktuel avance</p>
            <p className={`text-2xl font-semibold mt-1 ${
              margin !== null ? (margin < 10 ? "text-destructive" : margin < 20 ? "text-warning" : "text-success") : "text-foreground"
            }`}>
              {margin !== null ? `${margin.toFixed(1)}%` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {product.custom_markup_percentage != null ? `Produkt-markup: ${product.custom_markup_percentage}%` : `Global markup: ${globalMarkup}%`}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="details" className="w-full">
        <TabsList>
          <TabsTrigger value="details">Produktdetaljer</TabsTrigger>
          <TabsTrigger value="seo">SEO / Meta</TabsTrigger>
          <TabsTrigger value="attributes">Attributter</TabsTrigger>
          <TabsTrigger value="pricing">Avance</TabsTrigger>
          <TabsTrigger value="suppliers">Leverandører</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4 mt-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Beskrivelser</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Kort beskrivelse</Label>
                <div
                  className="rounded-md border border-border bg-secondary/30 p-3 text-sm text-foreground min-h-[60px] prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: (product as any).short_description || "<span class='text-muted-foreground'>Ingen kort beskrivelse</span>" }}
                />
              </div>
              <div className="space-y-2">
                <Label>Lang beskrivelse</Label>
                <div
                  className="rounded-md border border-border bg-secondary/30 p-3 text-sm text-foreground min-h-[100px] prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: (product as any).long_description || "<span class='text-muted-foreground'>Ingen lang beskrivelse</span>" }}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground text-xs">Brand</Label>
                  <p className="text-sm text-foreground">{product.brand || "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Kategori</Label>
                  <p className="text-sm text-foreground">{product.category || "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">SKU</Label>
                  <p className="text-sm font-mono text-foreground">{(product as any).sku || "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">EAN</Label>
                  <p className="text-sm font-mono text-foreground">{product.ean}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seo" className="space-y-4 mt-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Meta / SEO</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Meta titel</Label>
                <p className="rounded-md border border-border bg-secondary/30 p-3 text-sm text-foreground">
                  {(product as any).meta_title || <span className="text-muted-foreground">Ingen meta titel</span>}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Meta beskrivelse</Label>
                <p className="rounded-md border border-border bg-secondary/30 p-3 text-sm text-foreground min-h-[60px]">
                  {(product as any).meta_description || <span className="text-muted-foreground">Ingen meta beskrivelse</span>}
                </p>
              </div>
              {/* SEO preview */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Google-forhåndsvisning</Label>
                <div className="rounded-md border border-border p-4 bg-background">
                  <p className="text-[#1a0dab] text-lg leading-snug truncate">
                    {(product as any).meta_title || product.title}
                  </p>
                  <p className="text-[#006621] text-xs mt-0.5">www.comtek.dk › produkt</p>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {(product as any).meta_description || (product as any).short_description || "Ingen beskrivelse tilgængelig."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attributes" className="space-y-4 mt-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Produktattributter</CardTitle>
            </CardHeader>
            <CardContent>
              {attributes && Object.keys(attributes).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/50">
                      <TableHead>Attribut</TableHead>
                      <TableHead>Værdi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(attributes).map(([key, value]) => (
                      <TableRow key={key}>
                        <TableCell className="font-medium text-foreground">{key}</TableCell>
                        <TableCell className="text-muted-foreground">{value}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground py-4">Ingen attributter registreret</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pricing" className="space-y-4 mt-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Avanceindstilling for dette produkt</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3 max-w-md">
                <div className="space-y-2 flex-1">
                  <Label>Markup % (lad tom for global: {globalMarkup}%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={displayMarkup}
                    onChange={(e) => setMarkupInput(e.target.value)}
                    placeholder={`${globalMarkup} (global)`}
                  />
                </div>
                <Button onClick={saveMarkup} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Gem
                </Button>
              </div>
              {product.custom_markup_percentage != null && (
                <p className="text-xs text-muted-foreground mt-2">
                  Produktet bruger egen markup på {product.custom_markup_percentage}% i stedet for global ({globalMarkup}%)
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-4 mt-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Leverandøroversigt</CardTitle>
            </CardHeader>
            <CardContent>
              {product.supplier_products.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Ingen leverandørdata tilgængelig</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/50">
                      <TableHead>Leverandør</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Indkøbspris</TableHead>
                      <TableHead className="text-right">Lager</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sidst opdateret</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {product.supplier_products
                      .sort((a, b) => a.purchase_price - b.purchase_price)
                      .map((sp) => {
                        const isCheapest = cheapest?.id === sp.id;
                        return (
                          <TableRow key={sp.id} className={isCheapest ? "bg-success/5" : ""}>
                            <TableCell className="font-medium text-foreground">
                              {sp.suppliers?.name ?? "Ukendt"}
                              {isCheapest && (
                                <Badge className="ml-2 bg-success/10 text-success border-0 text-xs">Billigst</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground font-mono text-xs">{sp.supplier_sku ?? "—"}</TableCell>
                            <TableCell className="text-right font-mono text-foreground">{formatPrice(sp.purchase_price)}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{sp.stock_quantity ?? "—"}</TableCell>
                            <TableCell>
                              {sp.in_stock ? (
                                <span className="flex items-center gap-1 text-success text-sm">
                                  <CheckCircle className="h-3.5 w-3.5" /> På lager
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-destructive text-sm">
                                  <XCircle className="h-3.5 w-3.5" /> Udsolgt
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs">
                              {new Date(sp.last_updated).toLocaleDateString("da-DK")}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
