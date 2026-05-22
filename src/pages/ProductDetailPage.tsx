import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMasterProduct, getCheapestSupplier, getCheapestSupplierAny, getMarginPercent, getRecommendedPriceInclVat, getRecommendedPrice, usePriceSettings, exVat, useProductChangeLog, useProductAnalytics, useProductRecommendations } from "@/hooks/use-products";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, CheckCircle, XCircle, Package, Save, Loader2, Upload, History, TrendingUp, AlertTriangle, Lightbulb, Eye, ShoppingCart, MousePointerClick, ExternalLink, RefreshCw, Check, X, Undo2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import ManualSupplierPriceDialog from "@/components/ManualSupplierPriceDialog";
import ProductTranslationsTab from "@/components/ProductTranslationsTab";
import InlineEditField from "@/components/InlineEditField";
import SyncTagsEditor from "@/components/SyncTagsEditor";
import DescriptionAiActions from "@/components/DescriptionAiActions";
import { LifecycleBadge, SendToShopifyButton, PullFromShopifyButton } from "@/components/LifecycleControls";
import ProductVariantsTab from "@/components/ProductVariantsTab";
import QuickSupplierSyncButton from "@/components/QuickSupplierSyncButton";
import MergeProductDialog from "@/components/MergeProductDialog";
import AiGenerateAllDialog from "@/components/AiGenerateAllDialog";
import { Archive, ArchiveRestore, GitMerge, Sparkles } from "lucide-react";

export default function ProductDetailPage() {
  const [manualPriceOpen, setManualPriceOpen] = useState(false);
  const [manualEditSupplierId, setManualEditSupplierId] = useState<string | undefined>();
  const [manualInitialPrice, setManualInitialPrice] = useState<number | undefined>();
  const [manualInitialStock, setManualInitialStock] = useState<number | null | undefined>();
  const [manualInitialInStock, setManualInitialInStock] = useState<boolean | undefined>();
  const [manualInitialSku, setManualInitialSku] = useState<string | null | undefined>();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: product, isLoading } = useMasterProduct(id!);
  const { data: priceSettings = [] } = usePriceSettings();
  const { data: changeLog = [] } = useProductChangeLog(id!);
  const { data: analytics } = useProductAnalytics(id!);
  const { data: recommendations = [] } = useProductRecommendations(id!);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [markupInput, setMarkupInput] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  type PushResult = { platform: "Shopify" | "WooCommerce"; success: boolean; message: string; updatedFields?: string[] };
  const [pushResults, setPushResults] = useState<PushResult[] | null>(null);
  const [pushPrice, setPushPrice] = useState<string>("");
  const [pushSalePrice, setPushSalePrice] = useState<string>("");
  const [pushStockQty, setPushStockQty] = useState<string>("");
  const [pushStockStatus, setPushStockStatus] = useState<string>("");
  const [pushBackorders, setPushBackorders] = useState<string>("");
  const [pushInitialized, setPushInitialized] = useState(false);
  const [autoStockSync, setAutoStockSync] = useState(false);
  const [stockSyncSupplierIds, setStockSyncSupplierIds] = useState<string[]>([]);
  const [stockSyncInterval, setStockSyncInterval] = useState("daily");
  const [minSyncMargin, setMinSyncMargin] = useState<string>("15");
  const [savingSync, setSavingSync] = useState(false);
  const [syncInitialized, setSyncInitialized] = useState(false);
  const [applyingRec, setApplyingRec] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [togglingLifecycle, setTogglingLifecycle] = useState(false);

  const toggleArchived = async () => {
    if (!product) return;
    const current = (product as any).lifecycle_status ?? "active";
    const next = current === "archived" ? "active" : "archived";
    setTogglingLifecycle(true);
    const { error } = await supabase
      .from("master_products")
      .update({ lifecycle_status: next })
      .eq("id", product.id);
    setTogglingLifecycle(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(next === "archived" ? "Produkt deaktiveret" : "Produkt genaktiveret");
    queryClient.invalidateQueries({ queryKey: ["master_product", id] });
    queryClient.invalidateQueries({ queryKey: ["master_products"] });
  };

  // Load rounding + backorder settings for recommendations
  const roundingMode = priceSettings.find(s => s.scope === "price_rounding")?.scope_value ?? "nearest_5";
  const backorderMode = priceSettings.find(s => s.scope === "default_backorder")?.scope_value ?? "notify";

  function applyRounding(price: number, mode: string): number {
    switch (mode) {
      case "nearest_1": return Math.round(price);
      case "nearest_5": return Math.round(price / 5) * 5;
      case "nearest_10": return Math.round(price / 10) * 10;
      case "nearest_25": return Math.round(price / 25) * 25;
      case "nearest_49": return Math.floor(price / 10) * 10 + 9;
      case "nearest_95": return Math.floor(price) - (Math.floor(price) % 5) + 4.95;
      case "nearest_99": return Math.floor(price / 10) * 10 - 0.01;
      default: return Math.round(price * 100) / 100;
    }
  }

  const applyRecPrice = async (rec: any) => {
    setApplyingRec(rec.id + "_price");
    try {
      const data = rec.data as any;
      if (!data?.suggested_price || !product) { toast.error("Ingen prisforslag"); return; }
      const rounded = applyRounding(data.suggested_price, roundingMode);
      const { error } = await supabase.from("master_products").update({ webshop_price: rounded }).eq("id", product.id);
      if (error) throw error;
      await supabase.from("product_recommendations").update({ resolved_at: new Date().toISOString(), is_dismissed: true }).eq("id", rec.id);
      toast.success(`Pris opdateret til ${rounded} kr.`);
      queryClient.invalidateQueries({ queryKey: ["master_product", id] });
      queryClient.invalidateQueries({ queryKey: ["product_recommendations", id] });
    } catch (err: any) { toast.error(err?.message ?? "Fejl"); }
    finally { setApplyingRec(null); }
  };

  const applyRecStock = async (rec: any) => {
    setApplyingRec(rec.id + "_stock");
    try {
      const data = rec.data as any;
      if (!product) return;
      const updates: any = {};
      if (data?.suggested_stock_status) {
        updates.stock_status = data.suggested_stock_status;
        if (data.suggested_stock_status === "onbackorder") {
          const mode = data.suggested_backorder_mode ?? backorderMode;
          updates.backorders_allowed = mode === "yes" || mode === "notify";
        }
      }
      if (data?.suggested_stock_quantity !== undefined) updates.stock_quantity = data.suggested_stock_quantity;
      if (Object.keys(updates).length === 0) { toast.error("Ingen lagerforslag"); return; }
      const { error } = await supabase.from("master_products").update(updates).eq("id", product.id);
      if (error) throw error;
      await supabase.from("product_recommendations").update({ resolved_at: new Date().toISOString(), is_dismissed: true }).eq("id", rec.id);
      toast.success("Lager opdateret");
      queryClient.invalidateQueries({ queryKey: ["master_product", id] });
      queryClient.invalidateQueries({ queryKey: ["product_recommendations", id] });
    } catch (err: any) { toast.error(err?.message ?? "Fejl"); }
    finally { setApplyingRec(null); }
  };

  const dismissRec = async (recId: string) => {
    await supabase.from("product_recommendations").update({ is_dismissed: true }).eq("id", recId);
    queryClient.invalidateQueries({ queryKey: ["product_recommendations", id] });
  };

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
    // Normalpris defaulter til nuværende webshop pris — anbefalet pris sættes kun
    // når brugeren klikker "Brug anbefalet pris".
    setPushPrice(product.webshop_price?.toString() ?? "");
    setPushSalePrice(product.sale_price?.toString() ?? "");
    // Suggest supplier stock total as stock quantity
    const supplierStockTotal = product.supplier_products.reduce((sum, sp) => sum + (sp.stock_quantity ?? 0), 0);
    const hasSupplierStock = product.supplier_products.some(sp => sp.in_stock);
    // If the current webshop price (ex VAT) is below the cheapest in-stock purchase price,
    // we'd be selling at a loss — force stock to 0 / out of stock instead.
    const activePrice = product.sale_price ?? product.webshop_price;
    const activePriceExVat = activePrice ? activePrice / 1.25 : null;
    const wouldBeLoss = activePriceExVat !== null && cheapestPriceForInit !== null && activePriceExVat < cheapestPriceForInit;
    if (wouldBeLoss) {
      setPushStockQty("0");
      setPushStockStatus("outofstock");
    } else {
      setPushStockQty(supplierStockTotal > 0 ? supplierStockTotal.toString() : (product.stock_quantity?.toString() ?? "0"));
      setPushStockStatus(hasSupplierStock ? "instock" : (product.stock_status ?? "outofstock"));
    }
    setPushBackorders(product.backorders_allowed ? backorderMode : "no");
    setPushInitialized(true);
  };

  // Initialize stock sync fields
  if (product && !syncInitialized) {
    setAutoStockSync((product as any).auto_stock_sync ?? false);
    const ids = (product as any).stock_sync_supplier_ids as string[] | null;
    const legacyId = (product as any).stock_sync_supplier_id as string | null;
    setStockSyncSupplierIds(ids && ids.length > 0 ? ids : legacyId ? [legacyId] : []);
    setStockSyncInterval((product as any).stock_sync_interval ?? "daily");
    setMinSyncMargin(String((product as any).min_sync_margin ?? 15));
    setSyncInitialized(true);
  }

  const saveStockSync = async () => {
    if (!product) return;
    setSavingSync(true);
    try {
      const { error } = await supabase
        .from("master_products")
        .update({
          auto_stock_sync: autoStockSync,
          stock_sync_supplier_ids: stockSyncSupplierIds,
          stock_sync_supplier_id: stockSyncSupplierIds[0] || null,
          stock_sync_interval: stockSyncInterval,
          min_sync_margin: parseFloat(minSyncMargin) || 15,
        } as any)
        .eq("id", product.id);
      if (error) throw error;
      toast.success("Automatisk lager-sync indstillinger gemt");
      queryClient.invalidateQueries({ queryKey: ["master_product", id] });
    } catch (err: any) {
      toast.error(err?.message || "Fejl ved gemning");
    } finally {
      setSavingSync(false);
    }
  };

  const pushToShop = async () => {
    if (!product) return;
    setPushing(true);
    setPushResults(null);
    try {
      const payload: Record<string, any> = {
        master_product_id: product.id,
      };
      if (pushPrice) payload.regular_price = parseFloat(pushPrice);
      payload.sale_price = pushSalePrice ? parseFloat(pushSalePrice) : null;
      if (pushStockQty) payload.stock_quantity = parseInt(pushStockQty, 10);
      if (pushStockStatus) payload.stock_status = pushStockStatus;
      if (pushBackorders) payload.backorders = pushBackorders;

      const targets: { fn: string; platform: "Shopify" | "WooCommerce" }[] = [];
      if (product.shopify_variant_id) targets.push({ fn: "shopify-update-product", platform: "Shopify" });
      if (product.webshop_product_id && product.webshop_platform === "woocommerce") targets.push({ fn: "wc-update-product", platform: "WooCommerce" });
      if (targets.length === 0) throw new Error("Produktet er ikke koblet til hverken Shopify eller WooCommerce");

      const responses = await Promise.all(
        targets.map((t) => supabase.functions.invoke(t.fn, { body: payload }))
      );

      const results: PushResult[] = responses.map((res, i) => {
        const platform = targets[i].platform;
        if (res.error) return { platform, success: false, message: res.error.message };
        if (res.data?.error) return { platform, success: false, message: String(res.data.error) };
        const fields = res.data?.updated_fields ?? [];
        return { platform, success: true, message: `${fields.length} felter opdateret`, updatedFields: fields };
      });
      setPushResults(results);

      const failed = results.filter((r) => !r.success);
      if (failed.length === results.length) toast.error("Opdatering fejlede på alle platforme");
      else if (failed.length > 0) toast.warning(`Delvis opdatering — ${failed.map((f) => f.platform).join(", ")} fejlede`);
      else toast.success(`Produktet er opdateret i ${results.map((r) => r.platform).join(" + ")}`);

      queryClient.invalidateQueries({ queryKey: ["master_product", id] });
    } catch (err: any) {
      toast.error(err?.message || "Fejl ved opdatering af webshop");
    } finally {
      setPushing(false);
    }
  };

  // Pre-compute cheapest IN-STOCK supplier for pricing recommendations.
  // Rationale: pricing must never be derived from a supplier that can't actually deliver,
  // otherwise we risk recommending a sales price below our real purchase cost.
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
  const cheapestAny = getCheapestSupplierAny(product.supplier_products);
  // Display "Indkøb" still reflects the absolute cheapest supplier (incl. out-of-stock),
  // but the recommended sales price uses cheapest IN-STOCK only.
  const cheapestPrice = cheapestAny?.purchase_price ?? null;
  const cheapestInStockPrice = cheapest?.purchase_price ?? null;
  const recommendedPriceExVat = cheapestInStockPrice ? getRecommendedPrice(cheapestInStockPrice, effectiveMarkup) : null;
  const recommendedPriceInclVat = cheapestInStockPrice ? getRecommendedPriceInclVat(cheapestInStockPrice, effectiveMarkup) : null;
  const currentPrice = product.sale_price ?? product.webshop_price;
  const currentPriceExVat = currentPrice ? exVat(currentPrice) : null;
  const margin = currentPriceExVat && cheapestPrice ? getMarginPercent(currentPriceExVat, cheapestPrice) : null;
  const priceDiff = currentPrice && recommendedPriceInclVat ? currentPrice - recommendedPriceInclVat : null;

  const attributes = (product as any).attributes as Record<string, string> | null | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-foreground">{product.title}</h1>
            <LifecycleBadge status={(product as any).lifecycle_status ?? "active"} />
          </div>
          <p className="text-sm text-muted-foreground">
            EAN: {product.ean}
            {(product as any).sku && <> · SKU: <span className="font-mono">{(product as any).sku}</span></>}
            {product.brand && <> · <span className="font-medium text-foreground">{product.brand}</span></>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuickSupplierSyncButton
            productId={product.id}
            supplierIds={product.supplier_products.map((sp) => sp.supplier_id)}
            variant="icon"
          />
          <PullFromShopifyButton productId={product.id} hasShopify={Boolean(product.shopify_product_id)} />
          <SendToShopifyButton product={product} />
          <Button variant="outline" size="sm" onClick={() => setMergeOpen(true)}>
            <GitMerge className="h-4 w-4 mr-2" />
            Flet
          </Button>
          <Button variant="outline" size="sm" onClick={toggleArchived} disabled={togglingLifecycle}>
            {togglingLifecycle ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : ((product as any).lifecycle_status === "archived" ? (
              <ArchiveRestore className="h-4 w-4 mr-2" />
            ) : (
              <Archive className="h-4 w-4 mr-2" />
            ))}
            {(product as any).lifecycle_status === "archived" ? "Genaktivér" : "Deaktivér"}
          </Button>
        </div>
      </div>

      <MergeProductDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        source={{ id: product.id, title: product.title, ean: product.ean }}
      />


      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-7">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Billigste indkøbspris</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{formatPrice(cheapestPrice)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">ex. moms</p>
            {cheapestAny?.suppliers && (
              <p className="text-xs text-muted-foreground">
                {cheapestAny.suppliers.name}
                {!cheapestAny.in_stock && <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0 text-warning border-warning/30">Ikke på lager</Badge>}
              </p>
            )}
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
            <p className="text-2xl font-semibold text-primary mt-1">{formatPrice(recommendedPriceInclVat ? applyRounding(recommendedPriceInclVat, roundingMode) : null)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              inkl. moms · ex. {formatPrice(recommendedPriceExVat)}
            </p>
            {priceDiff !== null && recommendedPriceInclVat && (
              (() => {
                const roundedDiff = currentPrice! - applyRounding(recommendedPriceInclVat, roundingMode);
                return (
                  <p className={`text-xs mt-0.5 ${roundedDiff > 0 ? "text-success" : roundedDiff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {roundedDiff > 0 ? "+" : ""}{formatPrice(roundedDiff)} vs. anbefalet
                  </p>
                );
              })()
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
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-1.5">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Besøg (30d)</p>
            </div>
            <p className="text-2xl font-semibold text-foreground mt-1">{analytics?.page_views ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">sidevisninger</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-1.5">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Konv. % (30d)</p>
            </div>
            <p className={`text-2xl font-semibold mt-1 ${
              analytics?.conversion_rate && analytics.conversion_rate > 0 ? "text-success" : "text-muted-foreground"
            }`}>
              {analytics?.conversion_rate != null ? `${analytics.conversion_rate.toFixed(1)}%` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {analytics?.purchases ? `${analytics.purchases} solgt` : "ingen salg"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="details" className="w-full">
        <TabsList>
          <TabsTrigger value="details">Produktdetaljer</TabsTrigger>
          <TabsTrigger value="attributes">Attributter</TabsTrigger>
          <TabsTrigger value="variants">Varianter</TabsTrigger>
          <TabsTrigger value="pricing">Avance</TabsTrigger>
          <TabsTrigger value="suppliers">Leverandører</TabsTrigger>
          <TabsTrigger value="comparison">Sammenligning</TabsTrigger>
          <TabsTrigger value="push" onClick={initPushFields}>Opdater shop</TabsTrigger>
          <TabsTrigger value="performance">
            <TrendingUp className="h-3.5 w-3.5 mr-1" />
            Performance
            {recommendations.length > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-[10px] px-1 py-0">{recommendations.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
          <TabsTrigger value="translations">Oversættelser</TabsTrigger>
          <TabsTrigger value="changelog">Ændringslog</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4 mt-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Grundoplysninger</CardTitle>
              <p className="text-xs text-muted-foreground">Hover over et felt og klik på blyanten for at redigere. Alle ændringer logges automatisk.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Titel</Label>
                <InlineEditField productId={product.id} field="title" value={product.title} />
              </div>
              <div className="space-y-2">
                <Label>Billede-URL</Label>
                <InlineEditField productId={product.id} field="image_url" value={product.image_url} />
              </div>
              <div className="space-y-2">
                <Label>Kort beskrivelse</Label>
                <InlineEditField productId={product.id} field="short_description" value={(product as any).short_description} type="html" placeholder="Ingen kort beskrivelse" />
              </div>
              <div className="space-y-2">
                <Label>Lang beskrivelse</Label>
                <InlineEditField productId={product.id} field="long_description" value={(product as any).long_description} type="html" placeholder="Ingen lang beskrivelse" />
              </div>
              <DescriptionAiActions
                productId={product.id}
                currentShort={(product as any).short_description}
                currentLong={(product as any).long_description}
              />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <Label className="text-muted-foreground text-xs">Brand</Label>
                  <InlineEditField productId={product.id} field="brand" value={product.brand} />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Kategori</Label>
                  <InlineEditField productId={product.id} field="category" value={product.category} />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">SKU</Label>
                  <InlineEditField productId={product.id} field="sku" value={(product as any).sku} />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">EAN</Label>
                  <InlineEditField productId={product.id} field="ean" value={product.ean} />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Lagerbeholdning</Label>
                  <InlineEditField productId={product.id} field="stock_quantity" value={(product as any).stock_quantity} type="number" />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Lagerstatus</Label>
                  <InlineEditField
                    productId={product.id}
                    field="stock_status"
                    value={(product as any).stock_status}
                    type="select"
                    options={[
                      { value: "instock", label: "På lager" },
                      { value: "onbackorder", label: "Restordre" },
                      { value: "outofstock", label: "Udsolgt" },
                    ]}
                    display={(v) => v === "instock" ? <Badge variant="outline" className="text-success border-success/30">På lager</Badge>
                      : v === "onbackorder" ? <Badge variant="outline" className="text-warning border-warning/30">Restordre</Badge>
                      : <Badge variant="outline" className="text-destructive border-destructive/30">Udsolgt</Badge>}
                  />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Restordre tilladt</Label>
                  <InlineEditField productId={product.id} field="backorders_allowed" value={(product as any).backorders_allowed} type="boolean" />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Webshop pris (inkl. moms)</Label>
                  <InlineEditField productId={product.id} field="webshop_price" value={product.webshop_price} type="number" />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Tilbudspris (inkl. moms)</Label>
                  <InlineEditField productId={product.id} field="sale_price" value={(product as any).sale_price} type="number" />
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <Label className="text-muted-foreground text-xs">Kategorier (komma-separeret)</Label>
                  <InlineEditField
                    productId={product.id}
                    field="categories"
                    value={(product.categories ?? []).join(", ")}
                    parse={(raw) => raw.split(",").map((s) => s.trim()).filter(Boolean)}
                    display={(v) => <span className="text-sm">{v && v.length ? v : "—"}</span>}
                  />
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <Label className="text-muted-foreground text-xs">Synk-tags — interne tags til fx Shopify-synk</Label>
                  <SyncTagsEditor
                    productId={product.id}
                    value={(product as any).sync_tags ?? []}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seo" className="space-y-4 mt-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-medium">SEO</CardTitle>
                  <p className="text-xs text-muted-foreground">Data fra Rank Math SEO plugin</p>
                </div>
                {product.webshop_product_id && (
                  <a
                    href={`https://www.comtek.dk/?p=${product.webshop_product_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Se produkt i webshoppen
                  </a>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Meta titel</Label>
                <InlineEditField productId={product.id} field="meta_title" value={(product as any).meta_title} placeholder="Ingen meta titel" />
              </div>
              <div className="space-y-2">
                <Label>Meta beskrivelse</Label>
                <InlineEditField productId={product.id} field="meta_description" value={(product as any).meta_description} type="textarea" placeholder="Ingen meta beskrivelse" />
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
            <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base font-medium">Leverandøroversigt</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setManualEditSupplierId(undefined);
                  setManualInitialPrice(undefined);
                  setManualInitialStock(undefined);
                  setManualInitialInStock(true);
                  setManualInitialSku(undefined);
                  setManualPriceOpen(true);
                }}
              >
                <Package className="h-4 w-4 mr-1.5" />
                Tilføj manuel indkøbspris
              </Button>
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
                      <TableHead className="text-right">Handling</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {product.supplier_products
                      .sort((a, b) => a.purchase_price - b.purchase_price)
                      .map((sp) => {
                        const isCheapest = cheapest?.id === sp.id;
                        const isManual = (sp.suppliers as any)?.feed_type === "manual";
                        return (
                          <TableRow key={sp.id} className={isCheapest ? "bg-success/5" : ""}>
                            <TableCell className="font-medium text-foreground">
                              {sp.suppliers?.name ?? "Ukendt"}
                              {isCheapest && (
                                <Badge className="ml-2 bg-success/10 text-success border-0 text-xs">Billigst</Badge>
                              )}
                              {isManual && (
                                <Badge variant="outline" className="ml-2 text-xs">Manuel</Badge>
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
                            <TableCell className="text-right">
                              {isManual ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setManualEditSupplierId(sp.supplier_id);
                                    setManualInitialPrice(sp.purchase_price);
                                    setManualInitialStock(sp.stock_quantity);
                                    setManualInitialInStock(sp.in_stock);
                                    setManualInitialSku(sp.supplier_sku);
                                    setManualPriceOpen(true);
                                  }}
                                >
                                  Rediger
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <ManualSupplierPriceDialog
            open={manualPriceOpen}
            onOpenChange={setManualPriceOpen}
            masterProductId={product.id}
            existingBySupplier={Object.fromEntries(
              product.supplier_products.map((sp) => [sp.supplier_id, sp.id])
            )}
            editSupplierId={manualEditSupplierId}
            initialPrice={manualInitialPrice}
            initialStockQty={manualInitialStock}
            initialInStock={manualInitialInStock}
            initialSku={manualInitialSku}
          />

          {/* Auto stock sync */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <RefreshCw className="h-4 w-4" /> Automatisk lager-sync
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="auto-stock-sync"
                  checked={autoStockSync}
                  onCheckedChange={(checked) => setAutoStockSync(!!checked)}
                />
                <Label htmlFor="auto-stock-sync" className="cursor-pointer">
                  Aktiver automatisk lager-sync for dette produkt
                </Label>
              </div>

              {autoStockSync && (
                <div className="space-y-4 pl-7 max-w-lg">
                  <div className="space-y-2">
                    <Label>Leverandører til sync</Label>
                    <div className="space-y-2 rounded-md border border-border p-3">
                      {product.supplier_products.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Ingen leverandører tilknyttet</p>
                      ) : (
                        product.supplier_products.map((sp) => (
                          <div key={sp.supplier_id} className="flex items-center gap-2">
                            <Checkbox
                              id={`sync-${sp.supplier_id}`}
                              checked={stockSyncSupplierIds.includes(sp.supplier_id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setStockSyncSupplierIds((prev) => [...prev, sp.supplier_id]);
                                } else {
                                  setStockSyncSupplierIds((prev) => prev.filter((id) => id !== sp.supplier_id));
                                }
                              }}
                            />
                            <Label htmlFor={`sync-${sp.supplier_id}`} className="cursor-pointer text-sm">
                              {sp.suppliers?.name ?? "Ukendt"}
                            </Label>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Interval</Label>
                      <Select value={stockSyncInterval} onValueChange={setStockSyncInterval}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hourly">Hver time</SelectItem>
                          <SelectItem value="daily">Dagligt</SelectItem>
                          <SelectItem value="weekly">Ugentligt</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Min. avance for sync (%)</Label>
                      <Input
                        type="number"
                        value={minSyncMargin}
                        onChange={(e) => setMinSyncMargin(e.target.value)}
                        placeholder="15"
                      />
                      <p className="text-xs text-muted-foreground">
                        Leverandører med lavere avance end dette springes over
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <Button onClick={saveStockSync} disabled={savingSync} size="sm">
                {savingSync ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Gem sync-indstillinger
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="comparison" className="space-y-4 mt-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Leverandør-sammenligning</CardTitle>
              <p className="text-sm text-muted-foreground">Overblik over alle leverandørers priser, lager og status for dette produkt.</p>
            </CardHeader>
            <CardContent>
              {product.supplier_products.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Ingen leverandørdata tilgængelig.</p>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-secondary/50">
                        <th className="h-10 px-3 text-left font-medium text-muted-foreground">Leverandør</th>
                        <th className="h-10 px-3 text-right font-medium text-muted-foreground">Indkøbspris (ex. moms)</th>
                        <th className="h-10 px-3 text-right font-medium text-muted-foreground">Anbefalet (inkl.)</th>
                        <th className="h-10 px-3 text-right font-medium text-muted-foreground">Avance vs. webshop</th>
                        <th className="h-10 px-3 text-right font-medium text-muted-foreground">Antal på lager</th>
                        <th className="h-10 px-3 text-left font-medium text-muted-foreground">Status</th>
                        <th className="h-10 px-3 text-right font-medium text-muted-foreground">Prisforskel</th>
                        <th className="h-10 px-3 text-left font-medium text-muted-foreground">Sidst opdateret</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...product.supplier_products]
                        .sort((a, b) => a.purchase_price - b.purchase_price)
                        .map((sp) => {
                          const isCheapest = cheapest?.id === sp.id;
                          const spRecommended = getRecommendedPriceInclVat(sp.purchase_price, effectiveMarkup);
                          const spMargin = currentPriceExVat
                            ? getMarginPercent(currentPriceExVat, sp.purchase_price)
                            : null;
                          const diffVsCheapest = cheapestPrice !== null
                            ? sp.purchase_price - cheapestPrice
                            : null;

                          return (
                            <tr key={sp.id} className={`border-b transition-colors ${isCheapest ? "bg-success/5" : "hover:bg-accent/30"}`}>
                              <td className="px-3 py-2.5 font-medium text-foreground">
                                <div className="flex items-center gap-2">
                                  {sp.suppliers?.name ?? "Ukendt"}
                                  {isCheapest && (
                                    <Badge className="bg-success/10 text-success border-0 text-xs">Billigst</Badge>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-foreground">{formatPrice(sp.purchase_price)}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-primary">{formatPrice(spRecommended)}</td>
                              <td className="px-3 py-2.5 text-right">
                                {spMargin !== null ? (
                                  <Badge
                                    variant="outline"
                                    className={
                                      spMargin < 10
                                        ? "text-destructive border-destructive/30"
                                        : spMargin < 20
                                        ? "text-warning border-warning/30"
                                        : "text-success border-success/30"
                                    }
                                  >
                                    {spMargin.toFixed(1)}%
                                  </Badge>
                                ) : "—"}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-foreground">{sp.stock_quantity ?? "—"}</td>
                              <td className="px-3 py-2.5">
                                {sp.in_stock ? (
                                  <span className="flex items-center gap-1 text-success">
                                    <CheckCircle className="h-3.5 w-3.5" /> På lager
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 text-destructive">
                                    <XCircle className="h-3.5 w-3.5" /> Udsolgt
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono">
                                {diffVsCheapest !== null && diffVsCheapest > 0 ? (
                                  <span className="text-destructive">+{formatPrice(diffVsCheapest)}</span>
                                ) : (
                                  <span className="text-success">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-muted-foreground text-xs">
                                {new Date(sp.last_updated).toLocaleDateString("da-DK")}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                    {currentPrice && (
                      <tfoot>
                        <tr className="border-t-2 border-border bg-secondary/30">
                          <td className="px-3 py-2.5 font-medium text-muted-foreground">Din webshop</td>
                          <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{formatPrice(currentPriceExVat)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{formatPrice(currentPrice)}</td>
                          <td className="px-3 py-2.5 text-right">
                            {margin !== null && (
                              <Badge variant="outline" className="text-muted-foreground">{margin.toFixed(1)}%</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{product.stock_quantity ?? "—"}</td>
                          <td className="px-3 py-2.5 text-muted-foreground text-sm">
                            {product.stock_status === "instock" ? "På lager" : "Udsolgt"}
                          </td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="push" className="space-y-4 mt-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Godkend & opdater webshop</CardTitle>
              <p className="text-sm text-muted-foreground">
                Justér værdierne nedenfor og tryk "Opdater shop" for at pushe ændringerne til den forbundne webshop. Intet sker automatisk.
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
                  (() => {
                    const roundedRecommended = applyRounding(recommendedPriceInclVat, roundingMode);
                    return (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-primary border-primary/30">
                          Anbefalet: {formatPrice(roundedRecommended)} inkl. moms
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPushPrice(roundedRecommended.toString())}
                        >
                          Brug anbefalet
                        </Button>
                      </div>
                    );
                  })()
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
                {/* Stock recommendation from suppliers */}
                {(() => {
                  // Sum all in-stock supplier quantities
                  const totalSupplierStock = product.supplier_products
                    .filter(sp => sp.in_stock)
                    .reduce((sum, sp) => sum + (sp.stock_quantity ?? 0), 0);
                  const anyInStock = product.supplier_products.some(sp => sp.in_stock);
                  const suggestedStatus = anyInStock ? "instock" : "outofstock";
                  const suggestedBackorder = backorderMode === "yes" ? "yes" : backorderMode === "notify" ? "notify" : "no";
                  
                  return (
                    <div className="flex items-center gap-2 flex-wrap">
                      {anyInStock && totalSupplierStock > 0 && (
                        <>
                          <Badge variant="outline" className="text-primary border-primary/30">
                            Leverandørlager: {totalSupplierStock} stk.
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setPushStockQty(totalSupplierStock.toString());
                              setPushStockStatus(suggestedStatus);
                              setPushBackorders(suggestedBackorder);
                            }}
                          >
                            Brug leverandørlager
                          </Button>
                        </>
                      )}
                      {!anyInStock && (
                        <>
                          <Badge variant="outline" className="text-warning border-warning/30">
                            Ingen leverandør på lager
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setPushStockQty("0");
                              setPushStockStatus("onbackorder");
                              setPushBackorders(suggestedBackorder);
                            }}
                          >
                            Sæt på restordre
                          </Button>
                        </>
                      )}
                    </div>
                  );
                })()}
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

              {/* Supplier overview */}
              {product.supplier_products.length > 0 && (
                <div className="rounded-md border border-border bg-secondary/30 p-4">
                  <h4 className="text-sm font-medium text-foreground mb-2">Leverandøroverblik</h4>
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="pb-2 text-left font-medium text-muted-foreground">Leverandør</th>
                          <th className="pb-2 text-right font-medium text-muted-foreground">Indkøb (ex.)</th>
                          <th className="pb-2 text-right font-medium text-muted-foreground">Antal</th>
                          <th className="pb-2 text-left font-medium text-muted-foreground pl-3">Status</th>
                          <th className="pb-2 text-right font-medium text-muted-foreground">Avance vs. ny pris</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...product.supplier_products]
                          .sort((a, b) => a.purchase_price - b.purchase_price)
                          .map((sp) => {
                            const isCheapest = cheapest?.id === sp.id;
                            const newPriceExVat = pushPrice ? exVat(parseFloat(pushPrice)) : null;
                            const spMargin = newPriceExVat
                              ? getMarginPercent(newPriceExVat, sp.purchase_price)
                              : null;
                            return (
                              <tr key={sp.id} className={`border-b last:border-0 ${isCheapest ? "bg-success/5" : ""}`}>
                                <td className="py-2 text-foreground">
                                  <span className="flex items-center gap-1.5">
                                    {sp.suppliers?.name ?? "Ukendt"}
                                    {isCheapest && <Badge className="bg-success/10 text-success border-0 text-xs">Billigst</Badge>}
                                  </span>
                                </td>
                                <td className="py-2 text-right font-mono text-foreground">{formatPrice(sp.purchase_price)}</td>
                                <td className="py-2 text-right font-mono text-foreground">{sp.stock_quantity ?? "—"}</td>
                                <td className="py-2 pl-3">
                                  {sp.in_stock ? (
                                    <span className="flex items-center gap-1 text-success text-xs">
                                      <CheckCircle className="h-3 w-3" /> På lager
                                    </span>
                                  ) : (
                                    <span className="flex items-center gap-1 text-destructive text-xs">
                                      <XCircle className="h-3 w-3" /> Udsolgt
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 text-right">
                                  {spMargin !== null ? (
                                    <Badge variant="outline" className={
                                      spMargin < 10 ? "text-destructive border-destructive/30 text-xs"
                                        : spMargin < 20 ? "text-warning border-warning/30 text-xs"
                                        : "text-success border-success/30 text-xs"
                                    }>
                                      {spMargin.toFixed(1)}%
                                    </Badge>
                                  ) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <Button onClick={pushToShop} disabled={pushing} size="lg" className="gap-2">
                {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Opdater shop
              </Button>

              {pushResults && pushResults.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2 mt-2">
                  {pushResults.map((r) => (
                    <div
                      key={r.platform}
                      className={`rounded-lg border p-3 flex items-start gap-3 ${
                        r.success
                          ? "border-success/30 bg-success/5"
                          : "border-destructive/30 bg-destructive/5"
                      }`}
                    >
                      {r.success ? (
                        <CheckCircle className="h-5 w-5 text-success shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{r.platform}</span>
                          <Badge variant={r.success ? "secondary" : "destructive"} className="text-[10px]">
                            {r.success ? "OK" : "Fejl"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 break-words">{r.message}</p>
                        {r.success && r.updatedFields && r.updatedFields.length > 0 && (
                          <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                            {r.updatedFields.join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4 mt-4">
          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div className="space-y-3">
              {recommendations.map((rec) => {
                const recData = rec.data as any;
                const hasPrice = !!recData?.suggested_price;
                const hasStock = !!(recData?.suggested_stock_status || recData?.suggested_stock_quantity !== undefined);
                return (
                  <Card key={rec.id} className={`shadow-sm border-l-4 ${
                    rec.severity === "critical" ? "border-l-destructive" : 
                    rec.severity === "warning" ? "border-l-warning" : "border-l-primary"
                  }`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          {rec.severity === "critical" ? (
                            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                          ) : (
                            <Lightbulb className="h-5 w-5 text-warning mt-0.5 shrink-0" />
                          )}
                          <div>
                            <p className="font-medium text-foreground">{rec.title}</p>
                            <p className="text-sm text-muted-foreground mt-1">{rec.description}</p>
                            {rec.action_suggestion && (
                              <p className="text-sm text-primary mt-2 font-medium">💡 {rec.action_suggestion}</p>
                            )}
                            <div className="flex items-center gap-2 mt-3">
                              {(rec.recommendation_type === "pricing" || rec.recommendation_type === "margin") && hasPrice && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs gap-1"
                                  disabled={applyingRec === rec.id + "_price"}
                                  onClick={() => applyRecPrice(rec)}
                                >
                                  {applyingRec === rec.id + "_price" ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Check className="h-3 w-3" />
                                  )}
                                  Følg prisanbefaling
                                </Button>
                              )}
                              {rec.recommendation_type === "stock" && hasStock && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs gap-1"
                                  disabled={applyingRec === rec.id + "_stock"}
                                  onClick={() => applyRecStock(rec)}
                                >
                                  {applyingRec === rec.id + "_stock" ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Check className="h-3 w-3" />
                                  )}
                                  Følg lageranbefaling
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
                          onClick={() => dismissRec(rec.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Analytics KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Eye className="h-4 w-4" />
                  <span className="text-sm">Sidevisninger</span>
                </div>
                <p className="text-2xl font-semibold text-foreground">{analytics?.page_views ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Sidste {analytics ? `${Math.round((new Date(analytics.period_end).getTime() - new Date(analytics.period_start).getTime()) / 86400000)} dage` : "7 dage"}</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <ShoppingCart className="h-4 w-4" />
                  <span className="text-sm">Tilf. til kurv / Køb</span>
                </div>
                <p className="text-2xl font-semibold text-foreground">
                  {analytics ? `${analytics.add_to_carts} / ${analytics.purchases}` : "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Konverteringsrate: {analytics ? `${analytics.conversion_rate.toFixed(1)}%` : "—"}
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <TrendingUp className="h-4 w-4" />
                  <span className="text-sm">Google Position</span>
                </div>
                <p className="text-2xl font-semibold text-foreground">{analytics?.avg_position ? analytics.avg_position.toFixed(1) : "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {analytics?.impressions ? `${analytics.impressions} visninger i Google` : "Ingen GSC data"}
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <MousePointerClick className="h-4 w-4" />
                  <span className="text-sm">CTR (Google)</span>
                </div>
                <p className="text-2xl font-semibold text-foreground">{analytics?.ctr ? `${analytics.ctr.toFixed(1)}%` : "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {analytics?.clicks ? `${analytics.clicks} klik fra Google` : "Ingen data"}
                </p>
              </CardContent>
            </Card>
          </div>

          {!analytics && recommendations.length === 0 && (
            <Card className="shadow-sm">
              <CardContent className="p-8 text-center text-muted-foreground">
                <TrendingUp className="h-8 w-8 mx-auto mb-3 opacity-40" />
                <p>Ingen performance-data endnu.</p>
                <p className="text-sm mt-1">Kør analytics-synkroniseringen for at hente data fra Google.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="translations" className="space-y-4 mt-4">
          <ProductTranslationsTab product={product} />
        </TabsContent>

        <TabsContent value="variants" className="space-y-4 mt-4">
          <ProductVariantsTab masterProductId={product.id} hasShopify={Boolean(product.shopify_product_id)} shopifyProductId={product.shopify_product_id ?? null} />
        </TabsContent>

        <TabsContent value="changelog" className="space-y-4 mt-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <History className="h-4 w-4" /> Ændringslog
              </CardTitle>
            </CardHeader>
            <CardContent>
              {changeLog.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Ingen ændringer registreret endnu</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/50">
                      <TableHead>Tidspunkt</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Felt</TableHead>
                      <TableHead>Gammel værdi</TableHead>
                      <TableHead>Ny værdi</TableHead>
                      <TableHead>Kilde</TableHead>
                      <TableHead className="text-right">Handling</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changeLog.map((log) => {
                      const REVERTABLE = new Set([
                        "title","image_url","brand","category","sku",
                        "short_description","long_description","meta_title","meta_description",
                        "stock_status","webshop_platform","webshop_product_id","webshop_parent_id",
                        "stock_sync_interval",
                        "webshop_price","sale_price","custom_markup_percentage","min_sync_margin",
                        "stock_quantity",
                        "auto_stock_sync","shopify_sync_enabled","backorders_allowed",
                        "attributes","categories","stock_sync_supplier_ids",
                      ]);
                      const canRevert = REVERTABLE.has(log.field_name) && log.source !== "revert";
                      return (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString("da-DK")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            log.change_type === "price_update" ? "text-primary border-primary/30" :
                            log.change_type === "stock_update" ? "text-warning border-warning/30" :
                            "text-muted-foreground"
                          }>
                            {log.change_type === "price_update" ? "Pris" :
                             log.change_type === "stock_update" ? "Lager" :
                             log.change_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{log.field_name}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{log.old_value ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs text-foreground">{log.new_value ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{log.source}</TableCell>
                        <TableCell className="text-right">
                          {canRevert ? (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 px-2">
                                  <Undo2 className="h-3.5 w-3.5 mr-1" /> Rul tilbage
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Rul ændring tilbage?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Feltet <span className="font-mono">{log.field_name}</span> sættes tilbage til værdien:
                                    <div className="mt-2 p-2 rounded bg-muted font-mono text-xs break-all">
                                      {log.old_value ?? "—"}
                                    </div>
                                    <span className="block mt-2 text-xs text-muted-foreground">
                                      Tilbagerulningen logges som en ny ændring med kilde "revert".
                                    </span>
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annullér</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={async () => {
                                      const { error } = await supabase.rpc("revert_change_log_entry" as any, { p_log_id: log.id });
                                      if (error) {
                                        toast.error("Kunne ikke rulle tilbage: " + error.message);
                                        return;
                                      }
                                      toast.success(`Feltet "${log.field_name}" blev rullet tilbage`);
                                      queryClient.invalidateQueries({ queryKey: ["master_product", id] });
                                      queryClient.invalidateQueries({ queryKey: ["product_change_log", id] });
                                    }}
                                  >
                                    Rul tilbage
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
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
