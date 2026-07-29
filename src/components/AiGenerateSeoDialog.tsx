import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2, Check, RefreshCw } from "lucide-react";
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
    short_description?: string | null;
    long_description?: string | null;
    meta_title?: string | null;
    meta_description?: string | null;
    attributes?: Record<string, unknown> | null;
  };
}

export default function AiGenerateSeoDialog({ open, onOpenChange, product }: Props) {
  const qc = useQueryClient();
  const [extra, setExtra] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{ meta_title: string; meta_description: string } | null>(null);

  const generate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-generate-seo", {
        body: {
          title: product.title ?? "",
          brand: product.brand ?? "",
          category: product.category ?? "",
          short_description: product.short_description ?? "",
          long_description: product.long_description ?? "",
          attributes: product.attributes ?? null,
          extra: extra.trim() || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setDraft({
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
        meta_title: draft.meta_title,
        meta_description: draft.meta_description,
      })
      .eq("id", product.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("SEO gemt i PIM – push til Shopify for at synke");
    qc.invalidateQueries({ queryKey: ["master_product", product.id] });
    qc.invalidateQueries({ queryKey: ["product_change_log", product.id] });
    setDraft(null);
    setExtra("");
    onOpenChange(false);
  };

  const tLen = draft?.meta_title.length ?? 0;
  const dLen = draft?.meta_description.length ?? 0;
  const tOk = tLen >= 50 && tLen <= 60;
  const dOk = dLen >= 140 && dLen <= 160;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> AI – generér SEO
          </DialogTitle>
          <DialogDescription>
            Genererer meta titel (50–60 tegn) og meta beskrivelse (140–160 tegn) ud fra produktets data.
            Gemmes kun i PIM – push til Shopify for at synke.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Ekstra fokus / keywords (valgfri)</Label>
            <Textarea
              rows={2}
              placeholder="F.eks. 'fremhæv PoE+ og fri fragt' eller keywords AI'en skal prioritere"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={generate} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> :
                draft ? <RefreshCw className="h-4 w-4 mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
              {draft ? "Generér igen" : "Generér SEO"}
            </Button>
          </div>
        </div>

        {draft && (
          <div className="space-y-4 border-t pt-4">
            <div className="space-y-1.5">
              <Label className="text-xs flex justify-between">
                <span>Meta titel</span>
                <span className={tOk ? "text-emerald-600" : "text-amber-600"}>{tLen} / 50–60</span>
              </Label>
              <Input value={draft.meta_title} onChange={(e) => setDraft({ ...draft, meta_title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex justify-between">
                <span>Meta beskrivelse</span>
                <span className={dOk ? "text-emerald-600" : "text-amber-600"}>{dLen} / 140–160</span>
              </Label>
              <Textarea rows={3} value={draft.meta_description} onChange={(e) => setDraft({ ...draft, meta_description: e.target.value })} />
            </div>
            <div className="rounded-md border border-border p-4 bg-background">
              <p className="text-[#1a0dab] text-lg leading-snug truncate">{draft.meta_title || product.title}</p>
              <p className="text-[#006621] text-xs mt-0.5">www.comtek.dk › produkt</p>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{draft.meta_description}</p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Annullér</Button>
          <Button onClick={save} disabled={!draft || saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
            Gem SEO i PIM
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
