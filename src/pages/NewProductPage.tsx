import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Copy, Loader2, Package, Sparkles, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export default function NewProductPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const duplicateFrom = (location.state as any)?.duplicateFrom ?? null;
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiBrief, setAiBrief] = useState("");
  const [form, setForm] = useState(() => {
    const d = duplicateFrom;
    const numStr = (v: any) => (v === null || v === undefined || v === "" ? "" : String(v));
    return {
      title: d?.title ? `${d.title} (kopi)` : "",
      ean: searchParams.get("ean") ?? "",
      sku: "",
      brand: d?.brand ?? "",
      category: d?.category ?? "",
      short_description: d?.short_description ?? "",
      long_description: d?.long_description ?? "",
      meta_title: d?.meta_title ?? "",
      meta_description: d?.meta_description ?? "",
      webshop_price: numStr(d?.webshop_price),
      sale_price: numStr(d?.sale_price),
      image_url: d?.image_url ?? "",
      weight_kg: numStr(d?.weight_kg),
      backorder_policy: d?.backorder_policy ?? "no",
    };
  });
  // Carry over extra fields that aren't in the form UI
  const [extras] = useState(() => ({
    categories: (duplicateFrom?.categories as string[] | null) ?? null,
    attributes: (duplicateFrom?.attributes as Record<string, any> | null) ?? null,
    custom_markup_percentage: duplicateFrom?.custom_markup_percentage ?? null,
  }));

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const stripLeadingZeros = (v: string) => v.replace(/^0+/, "") || v;

  const generateWithAi = async () => {
    if (aiBrief.trim().length < 3) {
      toast({ title: "Skriv lidt om produktet først", description: "F.eks. 'Blackview Tab 90 tablet 11\" 8GB/256GB Android 14'", variant: "destructive" });
      return;
    }
    setGenerating(true);
    const { data, error } = await supabase.functions.invoke("ai-generate-product", {
      body: {
        input: aiBrief,
        brand: form.brand,
        category: form.category,
        ean: form.ean,
        sku: form.sku,
      },
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
    toast({ title: "AI har udfyldt felterne", description: "Tjek og ret efter behov før du gemmer." });
  };

  const create = async (alsoPush: boolean) => {
    if (!form.title.trim()) { toast({ title: "Titel påkrævet", variant: "destructive" }); return; }
    if (!form.ean.trim()) { toast({ title: "EAN påkrævet", variant: "destructive" }); return; }
    setSaving(true);
    const ean = stripLeadingZeros(form.ean.trim());
    const { data: existing } = await supabase
      .from("master_products").select("id").eq("ean", ean).maybeSingle();
    if (existing) {
      setSaving(false);
      toast({ title: "EAN findes allerede", description: "Et produkt med dette EAN eksisterer i PIM.", variant: "destructive" });
      return;
    }
    const payload = {
      title: form.title.trim(),
      ean,
      sku: form.sku.trim() || null,
      brand: form.brand.trim() || null,
      category: form.category.trim() || null,
      categories: extras.categories && extras.categories.length > 0
        ? extras.categories
        : (form.category.trim() ? [form.category.trim()] : []),
      attributes: extras.attributes ?? null,
      custom_markup_percentage: extras.custom_markup_percentage ?? null,
      short_description: form.short_description || null,
      long_description: form.long_description || null,
      meta_title: form.meta_title.trim() || null,
      meta_description: form.meta_description.trim() || null,
      image_url: form.image_url.trim() || null,
      webshop_price: form.webshop_price ? Number(form.webshop_price) : null,
      sale_price: form.sale_price ? Number(form.sale_price) : null,
      weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
      backorder_policy: form.backorder_policy || "no",
      lifecycle_status: "draft",
      webshop_platform: "shopify",
      shopify_sync_enabled: false,
    };
    const { data: created, error } = await supabase
      .from("master_products").insert(payload).select("id").single();
    setSaving(false);
    if (error) { toast({ title: "Kunne ikke oprette", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Kladde oprettet i PIM" });

    if (created) {
      const { data: rematchData, error: rematchError } = await supabase.functions.invoke("supplier-rematch-product", {
        body: { master_product_id: created.id },
      });
      if (rematchError || (rematchData as any)?.error) {
        toast({ title: "Leverandør-søgning fejlede", description: rematchError?.message ?? (rematchData as any)?.error, variant: "destructive" });
      } else {
        const imported = (rematchData as any)?.total_imported ?? 0;
        const started = (rematchData as any)?.started ?? 0;
        if (imported > 0) {
          toast({ title: `Fandt ${imported} leverandør-match`, description: "Produktet er koblet til leverandørpris og lager." });
        } else if (started > 0) {
          toast({ title: "Leverandør-søgning startet", description: `Søger hos ${started} leverandør${started === 1 ? "" : "er"} i baggrunden.` });
        } else {
          toast({ title: "Ingen leverandør-match", description: "Ingen leverandører havde dette EAN i deres feed." });
        }
      }
    }

    if (alsoPush && created) {
      setPushing(true);
      const { data, error: pErr } = await supabase.functions.invoke("shopify-create-product", {
        body: { master_product_id: created.id },
      });
      setPushing(false);
      if (pErr || (data as any)?.error) {
        toast({ title: "Push fejlede", description: pErr?.message ?? (data as any)?.error, variant: "destructive" });
      } else {
        toast({ title: "Sendt til Shopify som KLADDE", description: "Aktivér i Shopify-admin når klar." });
      }
    }
    navigate(`/products/${created!.id}`);
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
              <div className="text-muted-foreground text-xs mt-0.5">Felter er forudfyldt. Udfyld EAN og SKU (de er bevidst tomme — EAN skal være unikt).</div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-primary/40 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> AI-assistent</CardTitle>
          <p className="text-sm text-muted-foreground">
            Indtast lidt basisinfo om produktet (model, hovedfunktioner, specs) — så genererer AI titel, kort/lang beskrivelse samt meta-titel og meta-beskrivelse på dansk.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={4}
            placeholder="F.eks.: Blackview Tab 90, 11&quot; tablet, 8GB RAM, 256GB lagring, Android 14, 8800 mAh batteri, 4G LTE, til arbejde og underholdning"
            value={aiBrief}
            onChange={(e) => setAiBrief(e.target.value)}
          />
          <div className="flex justify-end">
            <Button onClick={generateWithAi} disabled={generating}>
              {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Generér med AI
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grundoplysninger</CardTitle>
          <p className="text-sm text-muted-foreground">Produktet oprettes som <strong>kladde</strong>. Det aktiveres først i Shopify når du sender det til Shopify og aktiverer det i Shopify-admin.</p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label>Titel *</Label><Input value={form.title} onChange={(e) => set("title", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>EAN *</Label><Input value={form.ean} onChange={(e) => set("ean", e.target.value)} placeholder="f.eks. 856963007033" /></div>
          <div className="space-y-1.5"><Label>SKU</Label><Input value={form.sku} onChange={(e) => set("sku", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Brand</Label><Input value={form.brand} onChange={(e) => set("brand", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Kategori</Label><Input value={form.category} onChange={(e) => set("category", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Salgspris (inkl. moms)</Label><Input type="number" step="0.01" value={form.webshop_price} onChange={(e) => set("webshop_price", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Tilbudspris (inkl. moms)</Label><Input type="number" step="0.01" value={form.sale_price} onChange={(e) => set("sale_price", e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Vægt (kg) <span className="text-xs text-muted-foreground">(valgfri — 1 kg bruges hvis tom)</span></Label>
            <Input type="number" step="0.01" min="0" value={form.weight_kg} onChange={(e) => set("weight_kg", e.target.value)} placeholder="1.0" />
          </div>
          <div className="space-y-1.5">
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
          <div className="space-y-1.5 sm:col-span-2"><Label>Billede-URL</Label><Input value={form.image_url} onChange={(e) => set("image_url", e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Kort beskrivelse</Label><Textarea rows={2} value={form.short_description} onChange={(e) => set("short_description", e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Lang beskrivelse</Label><Textarea rows={6} value={form.long_description} onChange={(e) => set("long_description", e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Meta titel <span className="text-xs text-muted-foreground">(SEO, max ~60 tegn) — {form.meta_title.length}</span></Label>
            <Input value={form.meta_title} onChange={(e) => set("meta_title", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Meta beskrivelse <span className="text-xs text-muted-foreground">(SEO, 140–160 tegn) — {form.meta_description.length}</span></Label>
            <Textarea rows={2} value={form.meta_description} onChange={(e) => set("meta_description", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={() => create(false)} disabled={saving || pushing}>
          {saving && !pushing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Gem som kladde
        </Button>
        <Button onClick={() => create(true)} disabled={saving || pushing}>
          {(saving || pushing) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
          Gem og send til Shopify
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Skal det være en variant af et eksisterende produkt?</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>I Shopify er varianter (f.eks. Hvid/Sort) altid del af ét moderprodukt. Hvis dette produkt er en variant af noget eksisterende:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Opret produktet i Shopify-admin direkte under det eksisterende moderprodukt som en ny variant.</li>
            <li>Klik på <em>"Træk alle fra Shopify"</em> i Indstillinger — så kommer varianten ind i PIM under det rigtige moderprodukt.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
