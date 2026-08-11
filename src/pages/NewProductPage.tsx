import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Copy, Loader2, Package, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type VariantRow = {
  value: string;
  ean: string;
  sku: string;
  webshop_price: string;
  sale_price: string;
  stock_quantity: string;
  weight_kg: string;
  image_url: string;
};

const emptyVariant = (): VariantRow => ({
  value: "", ean: "", sku: "", webshop_price: "", sale_price: "", stock_quantity: "", weight_kg: "", image_url: "",
});

const stripLeadingZeros = (v: string) => v.replace(/^0+/, "") || v;

export default function NewProductPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const duplicateFrom = (location.state as any)?.duplicateFrom ?? null;
  const prefill = (location.state as any)?.prefill ?? null;
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiBrief, setAiBrief] = useState(
    prefill
      ? [prefill.title, prefill.brand, prefill.ean ? `EAN ${prefill.ean}` : ""].filter(Boolean).join(", ")
      : "",
  );

  const [variantMode, setVariantMode] = useState(false);
  const [optionName, setOptionName] = useState("Farve");
  const [variants, setVariants] = useState<VariantRow[]>([emptyVariant(), emptyVariant()]);

  const [form, setForm] = useState(() => {
    const d = duplicateFrom;
    const numStr = (v: any) => (v === null || v === undefined || v === "" ? "" : String(v));
    return {
      title: prefill?.title ?? (d?.title ? `${d.title} (kopi)` : ""),
      ean: prefill?.ean ?? searchParams.get("ean") ?? "",
      sku: prefill?.sku ?? "",
      brand: prefill?.brand ?? d?.brand ?? "",
      category: d?.category ?? "",
      short_description: d?.short_description ?? "",
      long_description: d?.long_description ?? "",
      meta_title: d?.meta_title ?? "",
      meta_description: d?.meta_description ?? "",
      webshop_price: prefill?.webshop_price ?? numStr(d?.webshop_price),
      sale_price: numStr(d?.sale_price),
      image_url: prefill?.image_url ?? d?.image_url ?? "",
      weight_kg: numStr(d?.weight_kg),
      backorder_policy: d?.backorder_policy ?? "no",
    };
  });
  const [extras] = useState(() => ({
    categories: (duplicateFrom?.categories as string[] | null) ?? null,
    attributes: (duplicateFrom?.attributes as Record<string, any> | null) ?? null,
    custom_markup_percentage: duplicateFrom?.custom_markup_percentage ?? null,
  }));

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const setVar = (idx: number, k: keyof VariantRow, v: string) =>
    setVariants((prev) => prev.map((row, i) => (i === idx ? { ...row, [k]: v } : row)));
  const addVariant = () => setVariants((prev) => [...prev, emptyVariant()]);
  const removeVariant = (idx: number) =>
    setVariants((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx)));

  const generateWithAi = async () => {
    if (aiBrief.trim().length < 3) {
      toast({ title: "Skriv lidt om produktet først", variant: "destructive" });
      return;
    }
    setGenerating(true);
    const { data, error } = await supabase.functions.invoke("ai-generate-product", {
      body: { input: aiBrief, brand: form.brand, category: form.category, ean: form.ean, sku: form.sku },
    });
    setGenerating(false);
    if (error || (data as any)?.error) {
      toast({ title: "AI-generering fejlede", description: error?.message ?? (data as any)?.error, variant: "destructive" });
      return;
    }
    setForm((p) => ({
      ...p,
      title: data.title || p.title,
      short_description: data.short_description || p.short_description,
      long_description: data.long_description || p.long_description,
      meta_title: data.meta_title || p.meta_title,
      meta_description: data.meta_description || p.meta_description,
    }));
    toast({ title: "AI har udfyldt felterne" });
  };

  const commonPayload = () => ({
    title: form.title.trim(),
    brand: form.brand.trim() || null,
    category: form.category.trim() || null,
    categories: extras.categories && extras.categories.length > 0
      ? extras.categories
      : (form.category.trim() ? [form.category.trim()] : []),
    custom_markup_percentage: extras.custom_markup_percentage ?? null,
    short_description: form.short_description || null,
    long_description: form.long_description || null,
    meta_title: form.meta_title.trim() || null,
    meta_description: form.meta_description.trim() || null,
    backorder_policy: form.backorder_policy || "no",
    lifecycle_status: "draft" as const,
    webshop_platform: "shopify" as const,
    shopify_sync_enabled: false,
  });

  const createSingle = async (alsoPush: boolean) => {
    if (!form.ean.trim()) { toast({ title: "EAN påkrævet", variant: "destructive" }); return; }
    const ean = stripLeadingZeros(form.ean.trim());
    const { data: existing } = await supabase
      .from("master_products").select("id").eq("ean", ean).maybeSingle();
    if (existing) {
      toast({ title: "EAN findes allerede", variant: "destructive" });
      return;
    }
    const payload = {
      ...commonPayload(),
      ean,
      sku: form.sku.trim() || null,
      attributes: extras.attributes ?? null,
      image_url: form.image_url.trim() || null,
      webshop_price: form.webshop_price ? Number(form.webshop_price) : null,
      sale_price: form.sale_price ? Number(form.sale_price) : null,
      weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
    };
    const { data: created, error } = await supabase
      .from("master_products").insert(payload).select("id").single();
    if (error) { toast({ title: "Kunne ikke oprette", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Kladde oprettet i PIM" });

    if (created) {
      await supabase.functions.invoke("supplier-rematch-product", { body: { master_product_id: created.id } });
    }

    if (alsoPush && created) {
      setPushing(true);
      const { data: matchData } = await supabase.functions.invoke("shopify-match", { body: { ean } });
      const newlyMatched = (matchData as any)?.pim?.newly_updated ?? 0;
      const alreadyMatched = (matchData as any)?.pim?.already_matched ?? 0;
      if (newlyMatched > 0 || alreadyMatched > 0) {
        toast({ title: "Koblet til eksisterende Shopify-produkt" });
      } else {
        const { data, error: pErr } = await supabase.functions.invoke("shopify-create-product", {
          body: { master_product_id: created.id },
        });
        if (pErr || (data as any)?.error) {
          toast({ title: "Push fejlede", description: pErr?.message ?? (data as any)?.error, variant: "destructive" });
        } else {
          toast({ title: "Sendt til Shopify som KLADDE" });
        }
      }
      setPushing(false);
    }
    navigate(`/products/${created!.id}`);
  };

  const createWithVariants = async (alsoPush: boolean) => {
    const axis = optionName.trim();
    if (!axis) { toast({ title: "Akse-navn påkrævet (fx Farve)", variant: "destructive" }); return; }
    if (variants.length < 2) { toast({ title: "Mindst 2 varianter påkrævet", variant: "destructive" }); return; }

    // Validate rows
    const cleaned = variants.map((v) => ({
      ...v,
      value: v.value.trim(),
      ean: stripLeadingZeros(v.ean.trim()),
      sku: v.sku.trim(),
    }));
    const values = new Set<string>();
    for (const [i, v] of cleaned.entries()) {
      if (!v.value) { toast({ title: `Variant ${i + 1}: værdi mangler`, variant: "destructive" }); return; }
      if (values.has(v.value.toLowerCase())) { toast({ title: `Duplikeret værdi: ${v.value}`, variant: "destructive" }); return; }
      values.add(v.value.toLowerCase());
      if (!/^\d{12}$|^\d{13}$/.test(v.ean)) {
        toast({ title: `Variant "${v.value}": ugyldigt EAN (12 eller 13 cifre)`, variant: "destructive" }); return;
      }
      if (alsoPush && !v.webshop_price) {
        toast({ title: `Variant "${v.value}": salgspris påkrævet for Shopify-push`, variant: "destructive" }); return;
      }
    }

    // Dup check
    const eans = cleaned.map((v) => v.ean);
    if (new Set(eans).size !== eans.length) {
      toast({ title: "Duplikerede EAN i varianterne", variant: "destructive" }); return;
    }
    const { data: existingRows } = await supabase
      .from("master_products").select("ean").in("ean", eans);
    if (existingRows && existingRows.length > 0) {
      toast({
        title: "EAN findes allerede",
        description: existingRows.map((r: any) => r.ean).join(", "),
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const base = commonPayload();
    const insertedIds: string[] = [];
    for (const v of cleaned) {
      const attrs = { ...(extras.attributes ?? {}), [axis]: v.value };
      const payload = {
        ...base,
        title: `${base.title} - ${v.value}`,
        ean: v.ean,
        sku: v.sku || null,
        attributes: attrs,
        image_url: v.image_url.trim() || form.image_url.trim() || null,
        webshop_price: v.webshop_price ? Number(v.webshop_price) : null,
        sale_price: v.sale_price ? Number(v.sale_price) : null,
        weight_kg: v.weight_kg ? Number(v.weight_kg) : null,
        stock_quantity: v.stock_quantity ? Number(v.stock_quantity) : null,
      };
      const { data: created, error } = await supabase
        .from("master_products").insert(payload).select("id").single();
      if (error || !created) {
        setSaving(false);
        toast({ title: `Kunne ikke oprette variant "${v.value}"`, description: error?.message, variant: "destructive" });
        return;
      }
      insertedIds.push(created.id);
    }
    setSaving(false);
    toast({ title: `${insertedIds.length} variant-kladder oprettet i PIM` });

    // Fire rematch in parallel (non-blocking)
    Promise.all(insertedIds.map((id) =>
      supabase.functions.invoke("supplier-rematch-product", { body: { master_product_id: id } })
    )).catch(() => {});

    if (alsoPush) {
      setPushing(true);
      const { data, error: pErr } = await supabase.functions.invoke("shopify-create-product-with-variants", {
        body: { master_product_ids: insertedIds, option_name: axis },
      });
      setPushing(false);
      if (pErr || (data as any)?.error) {
        toast({
          title: "Shopify-push fejlede",
          description: (pErr?.message ?? (data as any)?.error) + " — kladderne findes i PIM, du kan prøve igen fra produktsiden.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Sendt til Shopify som KLADDE med varianter" });
      }
    }
    navigate(`/products/${insertedIds[0]}`);
  };

  const create = async (alsoPush: boolean) => {
    if (!form.title.trim()) { toast({ title: "Titel påkrævet", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (variantMode) await createWithVariants(alsoPush);
      else await createSingle(alsoPush);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4 mr-1" /> Tilbage</Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Package className="h-6 w-6" /> {duplicateFrom ? "Dupliker produkt" : "Opret nyt produkt"}</h1>
      </div>

      {duplicateFrom && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-3 flex items-start gap-2 text-sm">
            <Copy className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
            <div>
              <div><strong>Duplikat af:</strong> {duplicateFrom.title}</div>
              <div className="text-muted-foreground text-xs mt-0.5">Felter er forudfyldt. Udfyld EAN og SKU.</div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-primary/40 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> AI-assistent</CardTitle>
          <p className="text-sm text-muted-foreground">Beskriv produktet — AI udfylder titel, beskrivelser og meta.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={3} placeholder="F.eks. Blackview Tab 90, 11&quot; tablet, 8GB/256GB, Android 14"
            value={aiBrief} onChange={(e) => setAiBrief(e.target.value)} />
          <div className="flex justify-end">
            <Button onClick={generateWithAi} disabled={generating}>
              {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Generér med AI
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Grundoplysninger</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Produktet oprettes som <strong>kladde</strong>.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Switch id="variantMode" checked={variantMode} onCheckedChange={setVariantMode} />
            <Label htmlFor="variantMode" className="cursor-pointer">Opret med varianter</Label>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label>Titel *</Label><Input value={form.title} onChange={(e) => set("title", e.target.value)} /></div>

          {!variantMode && (
            <>
              <div className="space-y-1.5"><Label>EAN *</Label><Input value={form.ean} onChange={(e) => set("ean", e.target.value)} placeholder="12 eller 13 cifre" /></div>
              <div className="space-y-1.5"><Label>SKU</Label><Input value={form.sku} onChange={(e) => set("sku", e.target.value)} /></div>
            </>
          )}

          <div className="space-y-1.5"><Label>Brand</Label><Input value={form.brand} onChange={(e) => set("brand", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Kategori</Label><Input value={form.category} onChange={(e) => set("category", e.target.value)} /></div>

          {!variantMode && (
            <>
              <div className="space-y-1.5"><Label>Salgspris (inkl. moms)</Label><Input type="number" step="0.01" value={form.webshop_price} onChange={(e) => set("webshop_price", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Tilbudspris (inkl. moms)</Label><Input type="number" step="0.01" value={form.sale_price} onChange={(e) => set("sale_price", e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Vægt (kg) <span className="text-xs text-muted-foreground">(1 kg hvis tom)</span></Label>
                <Input type="number" step="0.01" min="0" value={form.weight_kg} onChange={(e) => set("weight_kg", e.target.value)} />
              </div>
            </>
          )}

          <div className="space-y-1.5 sm:col-span-2 sm:col-start-1">
            <Label>Restordre</Label>
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={form.backorder_policy}
              onChange={(e) => set("backorder_policy", e.target.value)}
            >
              <option value="no">Nej (kan ikke købes når udsolgt)</option>
              <option value="yes">Ja (kan købes når udsolgt)</option>
              <option value="notify">Ja, med besked (kan ikke købes)</option>
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Billede-URL{variantMode ? " (fælles fallback)" : ""}</Label><Input value={form.image_url} onChange={(e) => set("image_url", e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Kort beskrivelse</Label><Textarea rows={2} value={form.short_description} onChange={(e) => set("short_description", e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Lang beskrivelse</Label><Textarea rows={6} value={form.long_description} onChange={(e) => set("long_description", e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Meta titel <span className="text-xs text-muted-foreground">(~60 tegn) — {form.meta_title.length}</span></Label>
            <Input value={form.meta_title} onChange={(e) => set("meta_title", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Meta beskrivelse <span className="text-xs text-muted-foreground">(140–160 tegn) — {form.meta_description.length}</span></Label>
            <Textarea rows={2} value={form.meta_description} onChange={(e) => set("meta_description", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {variantMode && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Varianter</CardTitle>
            <p className="text-sm text-muted-foreground">
              Én række pr. variant. Hver får sit eget PIM-produkt, men samme Shopify-produkt.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5 max-w-xs">
              <Label>Akse-navn *</Label>
              <Input value={optionName} onChange={(e) => setOptionName(e.target.value)} placeholder="Farve, Størrelse, Model" />
            </div>

            <div className="space-y-3">
              {variants.map((v, idx) => (
                <div key={idx} className="rounded-md border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">Variant {idx + 1}</div>
                    <Button variant="ghost" size="sm" onClick={() => removeVariant(idx)} disabled={variants.length <= 2}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>{optionName || "Værdi"} *</Label>
                      <Input value={v.value} onChange={(e) => setVar(idx, "value", e.target.value)} placeholder="fx Hvid" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>EAN *</Label>
                      <Input value={v.ean} onChange={(e) => setVar(idx, "ean", e.target.value)} placeholder="12/13 cifre" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>SKU</Label>
                      <Input value={v.sku} onChange={(e) => setVar(idx, "sku", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Vægt (kg)</Label>
                      <Input type="number" step="0.01" min="0" value={v.weight_kg} onChange={(e) => setVar(idx, "weight_kg", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Salgspris (inkl. moms)</Label>
                      <Input type="number" step="0.01" value={v.webshop_price} onChange={(e) => setVar(idx, "webshop_price", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Tilbudspris (inkl. moms)</Label>
                      <Input type="number" step="0.01" value={v.sale_price} onChange={(e) => setVar(idx, "sale_price", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Lager (start)</Label>
                      <Input type="number" min="0" value={v.stock_quantity} onChange={(e) => setVar(idx, "stock_quantity", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Billede-URL</Label>
                      <Input value={v.image_url} onChange={(e) => setVar(idx, "image_url", e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Button variant="outline" size="sm" onClick={addVariant}>
              <Plus className="h-4 w-4 mr-1" /> Tilføj variant
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-2 flex-wrap">
        <Button variant="outline" onClick={() => create(false)} disabled={saving || pushing}>
          {saving && !pushing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Gem som kladde
        </Button>
        <Button onClick={() => create(true)} disabled={saving || pushing}>
          {(saving || pushing) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
          Gem og send til Shopify
        </Button>
      </div>

      {!variantMode && (
        <Card>
          <CardHeader><CardTitle className="text-base">Skal det være en variant af et eksisterende produkt?</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Hvis produktet skal være en variant af noget der allerede findes i Shopify:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Opret varianten direkte i Shopify-admin under det eksisterende moderprodukt.</li>
              <li>Klik <em>"Træk alle fra Shopify"</em> i Indstillinger.</li>
            </ol>
            <p className="pt-2">Skal du oprette et nyt produkt med flere varianter fra bunden? Slå <strong>"Opret med varianter"</strong> til øverst.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
