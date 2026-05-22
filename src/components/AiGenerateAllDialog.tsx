import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: {
    id: string;
    title?: string | null;
    brand?: string | null;
    category?: string | null;
    ean?: string | null;
    sku?: string | null;
    short_description?: string | null;
    long_description?: string | null;
    meta_title?: string | null;
    meta_description?: string | null;
    attributes?: Record<string, unknown> | null;
  };
}

export default function AiGenerateAllDialog({ open, onOpenChange, product }: Props) {
  const qc = useQueryClient();
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<{
    title: string;
    short_description: string;
    long_description: string;
    meta_title: string;
    meta_description: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const seedBrief = () => {
    const parts: string[] = [];
    if (product.title) parts.push(product.title);
    if (product.brand) parts.push(`Brand: ${product.brand}`);
    if (product.category) parts.push(`Kategori: ${product.category}`);
    if (product.short_description) parts.push(product.short_description);
    if (product.attributes && Object.keys(product.attributes).length) {
      parts.push("Specs: " + JSON.stringify(product.attributes));
    }
    setBrief(parts.join("\n"));
  };

  const generate = async () => {
    if (brief.trim().length < 3) {
      toast.error("Skriv lidt basisinfo først");
      return;
    }
    setLoading(true);
    setDraft(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-generate-product", {
        body: {
          input: brief,
          brand: product.brand ?? "",
          category: product.category ?? "",
          ean: product.ean ?? "",
          sku: product.sku ?? "",
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setDraft({
        title: data.title ?? "",
        short_description: data.short_description ?? "",
        long_description: data.long_description ?? "",
        meta_title: data.meta_title ?? "",
        meta_description: data.meta_description ?? "",
      });
    } catch (e: any) {
      toast.error(e?.message ?? "AI-fejl");
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    const { error } = await supabase
      .from("master_products")
      .update({
        title: draft.title || product.title,
        short_description: draft.short_description,
        long_description: draft.long_description,
        meta_title: draft.meta_title,
        meta_description: draft.meta_description,
      })
      .eq("id", product.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Felter gemt i PIM – synkes ikke automatisk til shop");
    qc.invalidateQueries({ queryKey: ["master_product", product.id] });
    qc.invalidateQueries({ queryKey: ["product_change_log", product.id] });
    setDraft(null);
    setBrief("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> AI – generér alle produktfelter
          </DialogTitle>
          <DialogDescription>
            Beskriv produktet med basisinfo (model, specs, key features). AI'en genererer titel, kort/lang beskrivelse,
            meta-titel og meta-beskrivelse. Gemmes kun i PIM – synkes ikke automatisk til Shopify.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Basisinfo</Label>
            <Button type="button" variant="ghost" size="sm" onClick={seedBrief}>
              Brug eksisterende produktdata
            </Button>
          </div>
          <Textarea
            rows={5}
            placeholder="F.eks.: Seagate STKM5000400 ekstern harddisk 5TB USB 3.0, kompakt, til Windows/Mac/Chromebook, Rescue Data Recovery inkluderet"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
          <div className="flex justify-end">
            <Button onClick={generate} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Generér med AI
            </Button>
          </div>
        </div>

        {draft && (
          <div className="space-y-4 border-t pt-4">
            <h4 className="text-sm font-medium">Forslag (redigerbart)</h4>
            <div className="space-y-1.5">
              <Label className="text-xs">Titel</Label>
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Kort beskrivelse ({draft.short_description.length})</Label>
              <Textarea rows={3} value={draft.short_description} onChange={(e) => setDraft({ ...draft, short_description: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Lang beskrivelse (HTML)</Label>
              <Textarea rows={10} className="font-mono text-xs" value={draft.long_description} onChange={(e) => setDraft({ ...draft, long_description: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Meta titel ({draft.meta_title.length} / ~60)</Label>
              <Input value={draft.meta_title} onChange={(e) => setDraft({ ...draft, meta_title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Meta beskrivelse ({draft.meta_description.length} / 140–160)</Label>
              <Textarea rows={2} value={draft.meta_description} onChange={(e) => setDraft({ ...draft, meta_description: e.target.value })} />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Annullér</Button>
          <Button onClick={save} disabled={!draft || saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
            Gem alle felter i PIM
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
