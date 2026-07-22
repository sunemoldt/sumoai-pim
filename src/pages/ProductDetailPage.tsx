import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMasterProduct, getCheapestSupplier, getCheapestSupplierAny, getMarginPercent, getRecommendedPriceInclVat, getRecommendedPrice, usePriceSettings, exVat, useProductChangeLog, useProductAnalytics, useProductRecommendations } from "@/hooks/use-products";
import { applyRounding } from "@/lib/price-rounding";
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
import ProductLowMarginGuardCard from "@/components/ProductLowMarginGuardCard";
import ProductCollectionsTab from "@/components/ProductCollectionsTab";
import { Archive, ArchiveRestore, Copy, GitMerge, Sparkles, Rss, FolderTree } from "lucide-react";

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
  const [stockSupplierOrderOverride, setStockSupplierOrderOverride] = useState(false);
  const [stockSyncInterval, setStockSyncInterval] = useState("daily");
  const [minSyncMargin, setMinSyncMargin] = useState<string>("15");
  const [savingSync, setSavingSync] = useState(false);
  const [syncInitialized, setSyncInitialized] = useState(false);
  const [applyingRec, setApplyingRec] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [aiGenOpen, setAiGenOpen] = useState(false);
  const [togglingLifecycle, setTogglingLifecycle] = useState(false);
  const [rematchingSuppliers, setRematchingSuppliers] = useState(false);
  const [siblingCount, setSiblingCount] = useState<number>(0);
  const [seoPulling, setSeoPulling] = useState(false);

  useEffect(() => {
    if (!product?.shopify_product_id || !product?.id) { setSiblingCount(0); return; }
    let active = true;
    supabase
      .from("master_products")
      .select("id", { count: "exact", head: true })
      .eq("shopify_product_id", product.shopify_product_id)
      .neq("id", product.id)
      .then(({ count }) => { if (active) setSiblingCount(count ?? 0); });
    return () => { active = false; };
  }, [product?.shopify_product_id, product?.id]);

  const pullSeoFromShopify = async () => {
    if (!product?.ean) return;
    setSeoPulling(true);
    const { data, error } = await supabase.functions.invoke("shopify-seo-backfill", {
      body: { mode: "apply", eans: [product.ean], overwriteEmptyOnly: false, limit: 5 },
    });
    setSeoPulling(false);
    if (error || (data as any)?.error) {
      toast.error(`Hent fra Shopify fejlede: ${error?.message ?? (data as any)?.error}`);
      return;
    }
    const applied = (data as any)?.summary?.applied ?? 0;
    toast.success(applied > 0 ? `Hentede SEO fra Shopify (${applied} felt(er))` : "Ingen SEO-data fundet i Shopify");
    queryClient.invalidateQueries({ queryKey: ["master_product", product.id] });
  };


  useEffect(() => {
    const prev = document.title;
    if (product?.title) document.title = `${product.title} · Comtek PIM`;
    return () => { document.title = prev; };
  }, [product?.title]);


  const rematchSuppliers = async () => {
    if (!product) return;
    setRematchingSuppliers(true);
    const { data, error } = await supabase.functions.invoke("supplier-rematch-product", {
      body: { master_product_id: product.id },
    });
    setRematchingSuppliers(false);
    if (error || (data as any)?.error) {
      toast.error(`Genmatch fejlede: ${error?.message ?? (data as any)?.error}`);
      return;
    }
    const imported = (data as any)?.total_imported ?? 0;
    const started = (data as any)?.started ?? 0;
    toast.success(imported > 0
      ? `Fandt ${imported} leverand\u00f8r-match`
      : started > 0
        ? `S\u00f8ger hos ${started} leverand\u00f8r${started === 1 ? "" : "er"} i baggrunden`
        : "Ingen leverand\u00f8rer havde dette EAN i deres feed");
    queryClient.invalidateQueries({ queryKey: ["master_product", product.id] });
    if (started > 0) {
      window.setTimeout(() => queryClient.invalidateQueries({ queryKey: ["master_product", product.id] }), 8000);
      window.setTimeout(() => queryClient.invalidateQueries({ queryKey: ["master_product", product.id] }), 20000);
    }
  };

  const rematchSuppliersAfterEanSave = async () => {
    if (!product) return;
    const { data, error } = await supabase.functions.invoke("supplier-rematch-product", {
      body: { master_product_id: product.id },
    });
    if (error || (data as any)?.error) {
      toast.error(`Leverandør-søgning fejlede: ${error?.message ?? (data as any)?.error}`);
      return;
    }
    const imported = (data as any)?.total_imported ?? 0;
    const started = (data as any)?.started ?? 0;
    if (imported > 0) {
      toast.success(`Fandt ${imported} leverandør-match på EAN`);
    } else if (started > 0) {
      toast.success(`Søger hos ${started} leverandør${started === 1 ? "" : "er"} i baggrunden`);
    } else {
      toast.info("Ingen leverandører havde dette EAN i deres feed");
    }
    queryClient.invalidateQueries({ queryKey: ["master_product", product.id] });
    if (started > 0) {
      window.setTimeout(() => queryClient.invalidateQueries({ queryKey: ["master_product", product.id] }), 8000);
      window.setTimeout(() => queryClient.invalidateQueries({ queryKey: ["master_product", product.id] }), 20000);
    }
  };

  const toggleArchived = async () => {
    if (!product) return;
    const current = (product as any).lifecycle_status ?? "active";
    const next = current === "archived" ? "active" : "archived";
    setTogglingLifecycle(true);
    const { error } = await supabase
      .from("master_products")
      .update({ lifecycle_status: next })
      .eq("id", product.id);
    if (error) {
      setTogglingLifecycle(false);
      toast.error(error.message);
      return;
    }

    // Also push status to Shopify if connected
    let shopifyMsg = "";
    if (product.shopify_product_id) {
      const shopifyStatus = next === "archived" ? "ARCHIVED" : "ACTIVE";
      const { data, error: fnErr } = await supabase.functions.invoke("shopify-update-product", {
        body: { master_product_id: product.id, status: shopifyStatus, force: true },
      });
      if (fnErr || (data as any)?.error) {
        shopifyMsg = ` (Shopify-opdatering fejlede: ${fnErr?.message ?? (data as any)?.error})`;
      } else {
        shopifyMsg = next === "archived" ? " og arkiveret i Shopify" : " og aktiveret i Shopify";
      }
    }

    setTogglingLifecycle(false);
    toast.success((next === "archived" ? "Produkt deaktiveret" : "Produkt genaktiveret") + shopifyMsg);
    queryClient.invalidateQueries({ queryKey: ["master_product", id] });
    queryClient.invalidateQueries({ queryKey: ["master_products"] });
  };

  // Load rounding + backorder settings for recommendations
  const roundingMode = priceSettings.find(s => s.scope === "price_rounding")?.scope_value ?? "nearest_5";
  const backorderMode = priceSettings.find(s => s.scope === "default_backorder")?.scope_value ?? "notify";


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
    // Suggest supplier stock — only from suppliers explicitly selected as stock sources.
    const selectedIds = ((product as any).stock_sync_supplier_ids as string[] | null) ?? [];
    const relevantSuppliers = selectedIds.length > 0
      ? product.supplier_products.filter(sp => selectedIds.includes(sp.supplier_id))
      : [];
    const supplierStockTotal = relevantSuppliers
      .filter(sp => sp.in_stock)
      .reduce((sum, sp) => sum + (sp.stock_quantity ?? 0), 0);
    const hasSupplierStock = relevantSuppliers.some(sp => sp.in_stock);
    // If the current webshop price (ex VAT) is below the cheapest in-stock purchase price,
    // we'd be selling at a loss — force stock to 0 / out of stock instead.
    const activePrice = product.sale_price ?? product.webshop_price;
    const activePriceExVat = activePrice ? activePrice / 1.25 : null;
    const wouldBeLoss = activePriceExVat !== null && cheapestPriceForInit !== null && activePriceExVat < cheapestPriceForInit;
    if (wouldBeLoss) {
      setPushStockQty("0");
      setPushStockStatus("outofstock");
    } else if (selectedIds.length === 0) {
      // No stock source selected — fall back to product's own current stock.
      setPushStockQty(product.stock_quantity?.toString() ?? "0");
      setPushStockStatus(product.stock_status ?? "outofstock");
    } else {
      setPushStockQty(supplierStockTotal.toString());
      setPushStockStatus(hasSupplierStock ? "instock" : "outofstock");
    }

    setPushBackorders((product as any).backorder_policy ?? (product.backorders_allowed ? "yes" : "no"));
    setPushInitialized(true);
  };

  // Initialize stock sync fields
  if (product && !syncInitialized) {
    setAutoStockSync((product as any).auto_stock_sync ?? false);
    const ids = (product as any).stock_sync_supplier_ids as string[] | null;
    const legacyId = (product as any).stock_sync_supplier_id as string | null;
    setStockSyncSupplierIds(ids && ids.length > 0 ? ids : legacyId ? [legacyId] : []);
    setStockSupplierOrderOverride(!!(product as any).stock_supplier_order_override);
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
          stock_supplier_order_override: stockSupplierOrderOverride,
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
      // WooCommerce is legacy — kept in code, but auto-target is disabled.
      // Re-enable via Settings → "WooCommerce-sync" if needed.
      // if (product.webshop_product_id && product.webshop_platform === "woocommerce") targets.push({ fn: "wc-update-product", platform: "WooCommerce" });
      if (targets.length === 0) throw new Error("Produktet er ikke koblet til hverken Shopify eller WooCommerce");

      const responses = await Promise.all(
        targets.map((t) => supabase.functions.invoke(t.fn, { body: payload }))
      );

      const results: PushResult[] = responses.map((res, i) => {
        const platform = targets[i].platform;
        if (res.error) return { platform, success: false, message: res.error.message };
        if (res.data?.error) return { platform, success: false, message: String(res.data.error) };
        if (res.data?.skipped) return { platform, success: false, message: res.data.message ?? `Sprunget over (${res.data.reason ?? "ukendt"})` };
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
  // Display "Indkøb" still reflects the absolute cheapest supplier (incl. out-of-stock).
  // Recommended price prefers cheapest IN-STOCK but falls back to cheapest any so we
  // always show a guideline price, even when all suppliers are out of stock.
  const cheapestPrice = cheapestAny?.purchase_price ?? null;
  const cheapestInStockPrice = cheapest?.purchase_price ?? null;
  const recommendedBasePrice = cheapestInStockPrice ?? cheapestPrice;
  const recommendedPriceExVat = recommendedBasePrice ? getRecommendedPrice(recommendedBasePrice, effectiveMarkup) : null;
  const recommendedPriceInclVat = recommendedBasePrice ? getRecommendedPriceInclVat(recommendedBasePrice, effectiveMarkup) : null;
  const currentPrice = product.sale_price ?? product.webshop_price;
  const currentPriceExVat = currentPrice ? exVat(currentPrice) : null;
  const margin = currentPriceExVat && cheapestPrice ? getMarginPercent(currentPriceExVat, cheapestPrice) : null;
  const priceDiff = currentPrice && recommendedPriceInclVat ? currentPrice - recommendedPriceInclVat : null;

  const attributes = (product as any).attributes as Record<string, string> | null | undefined;

  return (
    <div>
      <MergeProductDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        source={{ id: product.id, title: product.title, ean: product.ean }}
      />

      <AiGenerateAllDialog
        open={aiGenOpen}
        onOpenChange={setAiGenOpen}
        product={{
          id: product.id,
          title: product.title,
          brand: (product as any).brand,
          category: (product as any).category,
          ean: product.ean,
          sku: (product as any).sku,
          short_description: (product as any).short_description,
          long_description: (product as any).long_description,
          meta_title: (product as any).meta_title,
          meta_description: (product as any).meta_description,
          attributes: (product as any).attributes,
        }}
      />

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {/* Header */}
        <header className="px-6 lg:px-8 py-5 border-b border-border">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1 min-w-0">
              <button
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors mb-2"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Produkter
                {product.brand && (
                  <>
                    <span className="mx-1 text-border">/</span>
                    <span className="text-primary normal-case tracking-normal">{product.brand}</span>
                  </>
                )}
              </button>
              <h1 className="font-display text-2xl lg:text-3xl font-bold text-foreground leading-tight max-w-3xl">
                {product.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground/70">EAN:</span> {product.ean}
                </span>
                {(product as any).sku && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-border" />
                    <span>
                      <span className="font-medium text-foreground/70">SKU:</span>{" "}
                      <span className="font-mono">{(product as any).sku}</span>
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/products/new", { state: { duplicateFrom: product } })}
                title="Opret et nyt produkt baseret på dette"
              >
                <Copy className="h-4 w-4 mr-1.5" />
                Dupliker
              </Button>
              <LifecycleBadge status={(product as any).lifecycle_status ?? "active"} />
            </div>
          </div>
        </header>

        {/* 60/40 split: content + utility rail */}
        <div className="grid grid-cols-1 lg:grid-cols-10">
          {/* Left rail (60%) */}
          <main className="lg:col-span-6 lg:border-r border-border min-w-0 p-6 lg:p-8">
            <Tabs defaultValue="details" className="w-full">

        <TabsList className="h-auto flex-wrap justify-start gap-1 p-1 w-full">
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
          <TabsTrigger value="collections"><FolderTree className="h-3.5 w-3.5 mr-1" />Kategorier</TabsTrigger>
          <TabsTrigger value="translations">Oversættelser</TabsTrigger>
          <TabsTrigger value="changelog">Ændringslog</TabsTrigger>
        </TabsList>

        <TabsContent value="collections" className="space-y-4 mt-4">
          <ProductCollectionsTab
            masterProductId={product.id}
            shopifyLinked={!!product.shopify_product_id}
          />
        </TabsContent>


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
                shopifyProductId={(product as any).shopify_product_id}
                webshopPlatform={(product as any).webshop_platform}
                webshopProductId={(product as any).webshop_product_id}
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
                  <InlineEditField productId={product.id} field="ean" value={product.ean} onSaved={rematchSuppliersAfterEanSave} />
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
                  <Label className="text-muted-foreground text-xs">Restordre</Label>
                  <InlineEditField
                    productId={product.id}
                    field="backorder_policy"
                    value={(product as any).backorder_policy ?? ((product as any).backorders_allowed ? "yes" : "no")}
                    type="select"
                    options={[
                      { value: "no", label: "Nej (kan ikke købes når udsolgt)" },
                      { value: "yes", label: "Ja (kan købes når udsolgt)" },
                      { value: "notify", label: "Ja, med besked (kan ikke købes)" },
                    ]}
                    display={(v) => v === "yes" ? <Badge variant="outline" className="text-success border-success/30">Ja</Badge>
                      : v === "notify" ? <Badge variant="outline" className="text-warning border-warning/30">Ja, med besked</Badge>
                      : <Badge variant="outline">Nej</Badge>}
                  />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Vægt (kg) — standard 1 kg hvis tom</Label>
                  <InlineEditField productId={product.id} field="weight_kg" value={(product as any).weight_kg} type="number" />
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
                  <p className="text-xs text-muted-foreground">PIM er master — ændringer pushes til Shopify (Page title / Meta description)</p>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={pullSeoFromShopify} disabled={seoPulling || !product.shopify_product_id}>
                    {seoPulling ? "Henter…" : "Hent fra Shopify"}
                  </Button>
                  {product.webshop_product_id && (
                    <a
                      href={`https://www.comtek.dk/?p=${product.webshop_product_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Se i webshop
                    </a>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {siblingCount > 0 && (
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
                  Deles med {siblingCount} variant(er) på samme Shopify-produkt — ændringer gælder alle.
                </div>
              )}
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
                    <p className="text-xs text-muted-foreground">
                      Rækkefølge = prioritet. Uden override bruges leverandørens globale prioritet (lavere tal = højere prioritet). Første match der er på lager og clearer margin bliver aktiv kilde.
                    </p>
                    <div className="space-y-2 rounded-md border border-border p-3">
                      {product.supplier_products.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Ingen leverandører tilknyttet</p>
                      ) : (
                        (() => {
                          const sortedSuppliers = [...product.supplier_products].sort((a, b) => {
                            const ai = stockSyncSupplierIds.indexOf(a.supplier_id);
                            const bi = stockSyncSupplierIds.indexOf(b.supplier_id);
                            if (stockSupplierOrderOverride) {
                              if (ai !== -1 && bi !== -1) return ai - bi;
                              if (ai !== -1) return -1;
                              if (bi !== -1) return 1;
                            }
                            const ap = (a.suppliers as any)?.priority ?? 100;
                            const bp = (b.suppliers as any)?.priority ?? 100;
                            if (ap !== bp) return ap - bp;
                            return (a.suppliers?.name ?? "").localeCompare(b.suppliers?.name ?? "");
                          });
                          return sortedSuppliers.map((sp) => {
                            const isSelected = stockSyncSupplierIds.includes(sp.supplier_id);
                            const orderIdx = stockSyncSupplierIds.indexOf(sp.supplier_id);
                            const globalPriority = (sp.suppliers as any)?.priority ?? 100;
                            return (
                              <div key={sp.supplier_id} className="flex items-center gap-2">
                                <Checkbox
                                  id={`sync-${sp.supplier_id}`}
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    if (checked) setStockSyncSupplierIds((prev) => [...prev, sp.supplier_id]);
                                    else setStockSyncSupplierIds((prev) => prev.filter((id) => id !== sp.supplier_id));
                                  }}
                                />
                                <Label htmlFor={`sync-${sp.supplier_id}`} className="cursor-pointer text-sm flex-1">
                                  {sp.suppliers?.name ?? "Ukendt"}
                                  <span className="ml-2 text-xs text-muted-foreground">(global prio {globalPriority})</span>
                                </Label>
                                {stockSupplierOrderOverride && isSelected && (
                                  <>
                                    <span className="text-xs text-muted-foreground w-6 text-right">#{orderIdx + 1}</span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6"
                                      disabled={orderIdx <= 0}
                                      onClick={() => {
                                        setStockSyncSupplierIds((prev) => {
                                          const next = [...prev];
                                          [next[orderIdx - 1], next[orderIdx]] = [next[orderIdx], next[orderIdx - 1]];
                                          return next;
                                        });
                                      }}
                                      title="Op"
                                    >↑</Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6"
                                      disabled={orderIdx === -1 || orderIdx >= stockSyncSupplierIds.length - 1}
                                      onClick={() => {
                                        setStockSyncSupplierIds((prev) => {
                                          const next = [...prev];
                                          [next[orderIdx], next[orderIdx + 1]] = [next[orderIdx + 1], next[orderIdx]];
                                          return next;
                                        });
                                      }}
                                      title="Ned"
                                    >↓</Button>
                                  </>
                                )}
                              </div>
                            );
                          });
                        })()
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Checkbox
                        id="stock-order-override"
                        checked={stockSupplierOrderOverride}
                        onCheckedChange={(checked) => setStockSupplierOrderOverride(!!checked)}
                      />
                      <Label htmlFor="stock-order-override" className="cursor-pointer text-sm">
                        Brug egen rækkefølge for dette produkt (ignorér global prioritet)
                      </Label>
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

          <ProductLowMarginGuardCard
            productId={product.id}
            initialMode={((product as any).low_margin_guard ?? "inherit") as "inherit" | "on" | "off"}
            initialThreshold={(product as any).low_margin_threshold ?? null}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["master_product", id] })}
          />

          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Rss className="h-4 w-4" /> Affiliate-feeds (Partner-ads m.fl.)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="text-sm">Ekskluder fra affiliate-feeds</Label>
                  <p className="text-xs text-muted-foreground">
                    Når slået til kommer produktet ikke med i Partner-ads XML-feedet.
                  </p>
                </div>
                <InlineEditField
                  productId={product.id}
                  field="exclude_from_feeds"
                  value={(product as any).exclude_from_feeds ?? false}
                  type="boolean"
                />
              </div>
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
                                  {/^comtek\s*-?\s*eget lager/i.test(sp.suppliers?.name ?? "") && (
                                    <Badge variant="outline" className="border-primary/40 text-primary text-xs">Eget lager</Badge>
                                  )}
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
                {/* Stock recommendation from suppliers — priority-based (override or global) */}
                {(() => {
                  const selectedIds = stockSyncSupplierIds ?? [];
                  if (selectedIds.length === 0) {
                    return (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30">
                          Ingen lagerkilde valgt — lager sat til 0
                        </Badge>
                      </div>
                    );
                  }
                  const activePriceIncl = product.sale_price ?? product.webshop_price ?? 0;
                  const activeEx = activePriceIncl > 0 ? activePriceIncl / 1.25 : 0;
                  const minMargin = product.min_sync_margin ?? 15;
                  const relevant = product.supplier_products
                    .filter(sp => selectedIds.includes(sp.supplier_id))
                    .map(sp => {
                      const price = Number(sp.purchase_price ?? 0);
                      const margin = activeEx > 0 && price > 0 ? ((activeEx - price) / activeEx) * 100 : null;
                      const safe = margin === null ? true : margin >= minMargin;
                      const globalPriority = (sp.suppliers as any)?.priority ?? 100;
                      const overridePos = selectedIds.indexOf(sp.supplier_id);
                      return { sp, price, margin, safe, globalPriority, overridePos };
                    })
                    .sort((a, b) => {
                      if (stockSupplierOrderOverride) return a.overridePos - b.overridePos;
                      if (a.globalPriority !== b.globalPriority) return a.globalPriority - b.globalPriority;
                      return a.price - b.price;
                    });
                  const inStockSafe = relevant.filter(r => r.sp.in_stock && (r.sp.stock_quantity == null || r.sp.stock_quantity > 0) && r.safe);
                  const active = inStockSafe[0] ?? null;
                  const suggestedQty = active ? (active.sp.stock_quantity ?? 1) : 0;
                  const suggestedStatus = active ? "instock" : "outofstock";
                  const suggestedBackorder = backorderMode === "yes" ? "yes" : backorderMode === "notify" ? "notify" : "no";
                  const activeEx = activePriceIncl > 0 ? activePriceIncl / 1.25 : 0;
                  const minMargin = product.min_sync_margin ?? 15;
                  const relevant = product.supplier_products
                    .filter(sp => selectedIds.includes(sp.supplier_id))
                    .map(sp => {
                      const price = Number(sp.purchase_price ?? 0);
                      const margin = activeEx > 0 && price > 0 ? ((activeEx - price) / activeEx) * 100 : null;
                      const safe = margin === null ? true : margin >= minMargin;
                      return { sp, price, margin, safe };
                    })
                    .sort((a, b) => a.price - b.price);
                  const inStockSafe = relevant.filter(r => r.sp.in_stock && (r.sp.stock_quantity == null || r.sp.stock_quantity > 0) && r.safe);
                  const active = inStockSafe[0] ?? null;
                  const suggestedQty = active ? (active.sp.stock_quantity ?? 1) : 0;
                  const suggestedStatus = active ? "instock" : "outofstock";
                  const suggestedBackorder = backorderMode === "yes" ? "yes" : backorderMode === "notify" ? "notify" : "no";

                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {active ? (
                          <>
                            <Badge variant="outline" className="text-primary border-primary/30">
                              Leverandørlager: {suggestedQty} stk. (billigste sikre kilde)
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setPushStockQty(String(suggestedQty));
                                setPushStockStatus(suggestedStatus);
                                setPushBackorders(suggestedBackorder);
                              }}
                            >
                              Brug leverandørlager
                            </Button>
                          </>
                        ) : (
                          <>
                            <Badge variant="outline" className="text-warning border-warning/30">
                              Ingen valgt leverandør på lager med sikker margin
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setPushStockQty("0");
                                setPushStockStatus("outofstock");
                                setPushBackorders(suggestedBackorder);
                              }}
                            >
                              Sæt udsolgt
                            </Button>
                          </>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {relevant.map((r, i) => {
                          const isActive = active && r.sp.id === active.sp.id;
                          const qty = r.sp.stock_quantity ?? (r.sp.in_stock ? "?" : 0);
                          const marginTxt = r.margin === null ? "—" : `${r.margin.toFixed(1)}%`;
                          let label = "";
                          if (!r.sp.in_stock || (r.sp.stock_quantity != null && r.sp.stock_quantity <= 0)) label = " · udsolgt";
                          else if (!r.safe) label = ` · margin < ${minMargin}%`;
                          else if (isActive) label = " · aktiv kilde";
                          return (
                            <div key={r.sp.id} className={isActive ? "text-primary font-medium" : ""}>
                              {(r.sp as any).suppliers?.name ?? "Leverandør"} — {qty} stk. @ {r.price.toFixed(2)} kr · margin {marginTxt}{label}
                            </div>
                          );
                        })}
                      </div>
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
          </main>

          {/* Right rail (40%): actions + KPIs */}
          <aside className="lg:col-span-4 bg-muted/30 p-6 lg:p-8 flex flex-col gap-6">
            {/* Actions */}
            <section className="space-y-3">
              <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-1">
                Handlinger
              </h3>
              <div className="flex flex-wrap gap-2">
                <PullFromShopifyButton productId={product.id} hasShopify={Boolean(product.shopify_product_id)} />
                <SendToShopifyButton product={product} />
                {!product.shopify_product_id && product.ean && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      toast.info("Søger efter match i Shopify...");
                      const { data, error } = await supabase.functions.invoke("shopify-match", {
                        body: { ean: product.ean },
                      });
                      if (error || (data as any)?.error) {
                        toast.error(`Match fejlede: ${error?.message ?? (data as any)?.error}`);
                        return;
                      }
                      const newly = (data as any)?.pim?.newly_updated ?? 0;
                      const already = (data as any)?.pim?.already_matched ?? 0;
                      if (newly > 0 || already > 0) {
                        toast.success("Koblet til Shopify — produktet er nu linket.");
                        window.location.reload();
                      } else {
                        toast.error("Ingen match: EAN findes ikke som barcode i Shopify.");
                      }
                    }}
                  >
                    Match til eksisterende Shopify
                  </Button>
                )}
                {product.shopify_product_id && (
                  <div className="basis-full text-xs text-muted-foreground">
                    {(() => {
                      const ts = (product as { last_shopify_sync_at?: string | null }).last_shopify_sync_at;
                      const st = (product as { last_shopify_sync_status?: string | null }).last_shopify_sync_status;
                      if (!ts && !st) return <span>Endnu ikke synket via ny logik</span>;
                      const when = ts ? new Date(ts).toLocaleString("da-DK") : "—";
                      const icon = st === "ok" ? "✓" : st === "failed" ? "✗" : "⏱";
                      const color = st === "ok" ? "text-green-600" : st === "failed" ? "text-red-600" : "text-amber-600";
                      return <span className={color}>Shopify: {icon} sidst synket {when}{st !== "ok" ? ` (${st})` : ""}</span>;
                    })()}
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={() => setAiGenOpen(true)}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  AI: generér felter
                </Button>
                <Button variant="outline" size="sm" onClick={() => setMergeOpen(true)}>
                  <GitMerge className="h-4 w-4 mr-2" />
                  Flet
                </Button>
                <Button variant="outline" size="sm" onClick={rematchSuppliers} disabled={rematchingSuppliers}>
                  {rematchingSuppliers ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Genmatch leverandører
                </Button>
                <QuickSupplierSyncButton
                  productId={product.id}
                  supplierIds={product.supplier_products.map((sp) => sp.supplier_id)}
                  variant="icon"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-destructive border-destructive/20 hover:bg-destructive/5 hover:text-destructive"
                onClick={toggleArchived}
                disabled={togglingLifecycle}
              >
                {togglingLifecycle ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (product as any).lifecycle_status === "archived" ? (
                  <ArchiveRestore className="h-4 w-4 mr-2" />
                ) : (
                  <Archive className="h-4 w-4 mr-2" />
                )}
                {(product as any).lifecycle_status === "archived" ? "Genaktivér produkt" : "Deaktivér produkt"}
              </Button>
            </section>

            {/* KPI matrix */}
            <section className="space-y-3">
              <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-1">
                Pris & Performance
              </h3>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-4 bg-card border border-border rounded-xl">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight mb-1">Indkøb</p>
                  <p className="font-display text-lg font-semibold text-foreground leading-tight">{formatPrice(cheapestPrice)}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {cheapestAny?.suppliers?.name ?? "ex. moms"}
                  </p>
                </div>

                <div className="p-4 bg-card border border-primary/20 ring-1 ring-primary/5 rounded-xl">
                  <p className="text-[10px] font-bold text-primary uppercase tracking-tight mb-1">Webshop</p>
                  <p className="font-display text-lg font-semibold text-foreground leading-tight">{formatPrice(product.webshop_price)}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    ex. {formatPrice(product.webshop_price ? exVat(product.webshop_price) : null)}
                  </p>
                </div>

                <div className="p-4 bg-card border border-border rounded-xl">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight mb-1">Tilbud</p>
                  <p className={`font-display text-lg font-semibold leading-tight ${product.sale_price ? "text-warning" : "text-muted-foreground"}`}>
                    {formatPrice(product.sale_price)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {product.sale_price ? `ex. ${formatPrice(exVat(product.sale_price))}` : "ingen"}
                  </p>
                </div>

                <div className="p-4 bg-card border border-border rounded-xl">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight mb-1">Avance</p>
                  <p className={`font-display text-lg font-semibold leading-tight ${
                    margin !== null ? (margin < 10 ? "text-destructive" : margin < 20 ? "text-warning" : "text-success") : "text-foreground"
                  }`}>
                    {margin !== null ? `${margin.toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {product.custom_markup_percentage != null ? `markup ${product.custom_markup_percentage}%` : `markup ${globalMarkup}%`}
                  </p>
                </div>

                <div className="col-span-2 p-4 bg-card border border-dashed border-border rounded-xl flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">Anbefalet pris</p>
                    <p className="font-display text-base font-semibold text-primary leading-tight mt-0.5">
                      {formatPrice(recommendedPriceInclVat ? applyRounding(recommendedPriceInclVat, roundingMode) : null)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      ex. {formatPrice(recommendedPriceExVat)}
                    </p>
                  </div>
                  {priceDiff !== null && recommendedPriceInclVat && (() => {
                    const roundedDiff = currentPrice! - applyRounding(recommendedPriceInclVat, roundingMode);
                    return (
                      <span className={`text-xs font-semibold whitespace-nowrap ${roundedDiff > 0 ? "text-success" : roundedDiff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {roundedDiff > 0 ? "+" : ""}{formatPrice(roundedDiff)}
                      </span>
                    );
                  })()}
                </div>

                <div className="p-4 bg-card border border-border rounded-xl">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Eye className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">Besøg 30d</p>
                  </div>
                  <p className="font-display text-lg font-semibold text-foreground leading-tight">{analytics?.page_views ?? "—"}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">sidevisninger</p>
                </div>

                <div className="p-4 bg-card border border-border rounded-xl">
                  <div className="flex items-center gap-1.5 mb-1">
                    <ShoppingCart className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">Konv. 30d</p>
                  </div>
                  <p className={`font-display text-lg font-semibold leading-tight ${
                    analytics?.conversion_rate && analytics.conversion_rate > 0 ? "text-success" : "text-muted-foreground"
                  }`}>
                    {analytics?.conversion_rate != null ? `${analytics.conversion_rate.toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {analytics?.purchases ? `${analytics.purchases} solgt` : "ingen salg"}
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

