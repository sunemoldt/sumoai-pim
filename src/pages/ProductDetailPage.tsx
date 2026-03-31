import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMasterProduct, getCheapestSupplier, getMarginPercent, getRecommendedPriceInclVat, getRecommendedPrice, usePriceSettings, exVat } from "@/hooks/use-products";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, CheckCircle, XCircle, Package, Save, Loader2, Upload } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  const [pushing, setPushing] = useState(false);
  const [pushPrice, setPushPrice] = useState<string>("");
  const [pushSalePrice, setPushSalePrice] = useState<string>("");
  const [pushStockQty, setPushStockQty] = useState<string>("");
  const [pushStockStatus, setPushStockStatus] = useState<string>("");
  const [pushBackorders, setPushBackorders] = useState<string>("");
  const [pushInitialized, setPushInitialized] = useState(false);

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

  // Initialize push fields when product loads and tab is first opened
  const initPushFields = () => {
    if (pushInitialized || !product) return;
    const recPrice = cheapestPriceForInit
      ? getRecommendedPriceInclVat(cheapestPriceForInit, product.custom_markup_percentage ?? globalMarkup)
      : product.webshop_price;
    setPushPrice(recPrice?.toString() ?? product.webshop_price?.toString() ?? "");
    setPushSalePrice(product.sale_price?.toString() ?? "");
    setPushStockQty(product.stock_quantity?.toString() ?? "0");
    setPushStockStatus(product.stock_status ?? "instock");
    setPushBackorders(product.backorders_allowed ? "yes" : "no");
    setPushInitialized(true);
  };

  const pushToShop = async () => {
    if (!product) return;
    setPushing(true);
    try {
      const payload: Record<string, any> = {
        master_product_id: product.id,
      };
      if (pushPrice) payload.regular_price = parseFloat(pushPrice);
      payload.sale_price = pushSalePrice ? parseFloat(pushSalePrice) : null;
      if (pushStockQty) payload.stock_quantity = parseInt(pushStockQty, 10);
      if (pushStockStatus) payload.stock_status = pushStockStatus;
      if (pushBackorders) payload.backorders = pushBackorders;

      const { data, error } = await supabase.functions.invoke("wc-update-product", {
        body: payload,
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(`Produktet er opdateret i webshoppen (${data.updated_fields?.length ?? 0} felter)`);
      queryClient.invalidateQueries({ queryKey: ["master_product", id] });
    } catch (err: any) {
      toast.error(err?.message || "Fejl ved opdatering af webshop");
    } finally {
      setPushing(false);
    }
  };

  // Pre-compute cheapest for init (before early returns)
  const cheapestPriceForInit = (() => {
    if (!product) return null;
    const c = getCheapestSupplier(product.supplier_products);
    return c?.purchase_price ?? null;
  })();

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
  const recommendedPriceExVat = cheapestPrice ? getRecommendedPrice(cheapestPrice, effectiveMarkup) : null;
  const recommendedPriceInclVat = cheapestPrice ? getRecommendedPriceInclVat(cheapestPrice, effectiveMarkup) : null;
  const currentPrice = product.sale_price ?? product.webshop_price;
  const currentPriceExVat = currentPrice ? exVat(currentPrice) : null;
  const margin = currentPriceExVat && cheapestPrice ? getMarginPercent(currentPriceExVat, cheapestPrice) : null;
  const priceDiff = currentPrice && recommendedPriceInclVat ? currentPrice - recommendedPriceInclVat : null;

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
            <p className="text-xs text-muted-foreground mt-0.5">ex. moms</p>
            {cheapest?.suppliers && <p className="text-xs text-muted-foreground">{cheapest.suppliers.name}</p>}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Webshop pris</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{formatPrice(product.webshop_price)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              inkl. moms · ex. {formatPrice(product.webshop_price ? exVat(product.webshop_price) : null)}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Tilbudspris</p>
            <p className={`text-2xl font-semibold mt-1 ${product.sale_price ? "text-warning" : "text-muted-foreground"}`}>
              {formatPrice(product.sale_price)}
            </p>
            {product.sale_price && (
              <p className="text-xs text-muted-foreground mt-0.5">
                inkl. moms · ex. {formatPrice(exVat(product.sale_price))}
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Anbefalet pris</p>
            <p className="text-2xl font-semibold text-primary mt-1">{formatPrice(recommendedPriceInclVat)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              inkl. moms · ex. {formatPrice(recommendedPriceExVat)}
            </p>
            {priceDiff !== null && (
              <p className={`text-xs mt-0.5 ${priceDiff > 0 ? "text-success" : priceDiff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                {priceDiff > 0 ? "+" : ""}{formatPrice(priceDiff)} vs. anbefalet
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Avance (ex. moms)</p>
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
          <TabsTrigger value="push" onClick={initPushFields}>Opdater shop</TabsTrigger>
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
                <div>
                  <Label className="text-muted-foreground text-xs">Lagerbeholdning</Label>
                  <p className="text-sm font-mono text-foreground">
                    {(product as any).stock_quantity !== null && (product as any).stock_quantity !== undefined
                      ? (product as any).stock_quantity
                      : "—"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Lagerstatus</Label>
                  <p className="text-sm text-foreground">
                    {(product as any).stock_status === "instock" ? (
                      <Badge variant="outline" className="text-success border-success/30">På lager</Badge>
                    ) : (product as any).stock_status === "onbackorder" ? (
                      <Badge variant="outline" className="text-warning border-warning/30">Restordre</Badge>
                    ) : (
                      <Badge variant="outline" className="text-destructive border-destructive/30">Udsolgt</Badge>
                    )}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Restordre tilladt</Label>
                  <p className="text-sm text-foreground">
                    {(product as any).backorders_allowed ? (
                      <Badge variant="outline" className="text-success border-success/30">Ja</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">Nej</Badge>
                    )}
                  </p>
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

        <TabsContent value="push" className="space-y-4 mt-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Godkend & opdater webshop</CardTitle>
              <p className="text-sm text-muted-foreground">
                Justér værdierne nedenfor og tryk "Opdater shop" for at pushe ændringerne til WooCommerce. Intet sker automatisk.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Price section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-foreground">Priser (inkl. moms)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
                  <div className="space-y-2">
                    <Label>Normalpris (inkl. moms)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={pushPrice}
                      onChange={(e) => setPushPrice(e.target.value)}
                    />
                    {pushPrice && (
                      <p className="text-xs text-muted-foreground">
                        Ex. moms: {formatPrice(exVat(parseFloat(pushPrice)))}
                        {cheapestPrice !== null && (
                          <> · Avance: {getMarginPercent(exVat(parseFloat(pushPrice)), cheapestPrice).toFixed(1)}%</>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Tilbudspris (inkl. moms)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={pushSalePrice}
                      onChange={(e) => setPushSalePrice(e.target.value)}
                      placeholder="Lad tom = ingen tilbud"
                    />
                    {pushSalePrice && cheapestPrice !== null && (
                      <p className="text-xs text-muted-foreground">
                        Ex. moms: {formatPrice(exVat(parseFloat(pushSalePrice)))}
                        · Avance: {getMarginPercent(exVat(parseFloat(pushSalePrice)), cheapestPrice).toFixed(1)}%
                      </p>
                    )}
                  </div>
                </div>
                {recommendedPriceInclVat && (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-primary border-primary/30">
                      Anbefalet: {formatPrice(recommendedPriceInclVat)} inkl. moms
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPushPrice(recommendedPriceInclVat.toString())}
                    >
                      Brug anbefalet
                    </Button>
                  </div>
                )}
              </div>

              {/* Stock section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-foreground">Lagerstyring</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-xl">
                  <div className="space-y-2">
                    <Label>Lagerantal</Label>
                    <Input
                      type="number"
                      value={pushStockQty}
                      onChange={(e) => setPushStockQty(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Lagerstatus</Label>
                    <Select value={pushStockStatus} onValueChange={setPushStockStatus}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="instock">På lager</SelectItem>
                        <SelectItem value="outofstock">Udsolgt</SelectItem>
                        <SelectItem value="onbackorder">Restordre</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Restordre</Label>
                    <Select value={pushBackorders} onValueChange={setPushBackorders}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no">Nej</SelectItem>
                        <SelectItem value="yes">Ja</SelectItem>
                        <SelectItem value="notify">Ja, med besked</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Current vs new comparison */}
              <div className="rounded-md border border-border bg-secondary/30 p-4">
                <h4 className="text-sm font-medium text-foreground mb-2">Sammenligning</h4>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="text-muted-foreground">Felt</div>
                  <div className="text-muted-foreground">Nuværende</div>
                  <div className="text-muted-foreground">Ny værdi</div>

                  <div>Normalpris</div>
                  <div className="font-mono">{formatPrice(product.webshop_price)}</div>
                  <div className="font-mono text-primary">{pushPrice ? formatPrice(parseFloat(pushPrice)) : "—"}</div>

                  <div>Tilbudspris</div>
                  <div className="font-mono">{formatPrice(product.sale_price)}</div>
                  <div className="font-mono text-warning">{pushSalePrice ? formatPrice(parseFloat(pushSalePrice)) : "Ingen"}</div>

                  <div>Lagerantal</div>
                  <div className="font-mono">{product.stock_quantity ?? "—"}</div>
                  <div className="font-mono">{pushStockQty || "—"}</div>

                  <div>Lagerstatus</div>
                  <div>{product.stock_status}</div>
                  <div>{pushStockStatus}</div>
                </div>
              </div>

              <Button onClick={pushToShop} disabled={pushing} size="lg" className="gap-2">
                {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Opdater shop
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
