import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Package, Sparkles, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export default function NewProductPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiBrief, setAiBrief] = useState("");
  const [form, setForm] = useState({
    title: "",
    ean: "",
    sku: "",
    brand: "",
    category: "",
    short_description: "",
    long_description: "",
    meta_title: "",
    meta_description: "",
    webshop_price: "",
    sale_price: "",
    image_url: "",
    weight_kg: "",
    backorder_policy: "no",
  });

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
      categories: form.category.trim() ? [form.category.trim()] : [],
      short_description: form.short_description || null,
      long_description: form.long_description || null,
      meta_title: form.meta_title.trim() || null,
      meta_description: form.meta_description.trim() || null,
      image_url: form.image_url.trim() || null,
      webshop_price: form.webshop_price ? Number(form.webshop_price) : null,
      sale_price: form.sale_price ? Number(form.sale_price) : null,
      lifecycle_status: "draft",
      webshop_platform: "shopify",
      shopify_sync_enabled: false,
    };
    const { data: created, error } = await supabase
      .from("master_products").insert(payload).select("id").single();
    setSaving(false);
    if (error) { toast({ title: "Kunne ikke oprette", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Kladde oprettet i PIM" });

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
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Package className="h-6 w-6" /> Opret nyt produkt</h1>
      </div>

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
