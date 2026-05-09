import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sparkles, Eraser, Loader2, Check, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Props {
  productId: string;
  currentShort?: string | null;
  currentLong?: string | null;
}

type Mode = "clean" | "rewrite";

export default function DescriptionAiActions({ productId, currentShort, currentLong }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode | null>(null);
  const [loading, setLoading] = useState(false);
  const [shortDraft, setShortDraft] = useState("");
  const [longDraft, setLongDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const hasPimContent = !!(currentShort?.trim() || currentLong?.trim());

  const syncToShop = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("wc-update-product", {
        body: {
          master_product_id: productId,
          short_description: currentShort ?? "",
          description: currentLong ?? "",
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Beskrivelse synket til WooCommerce");
      qc.invalidateQueries({ queryKey: ["product_change_log", productId] });
    } catch (e: any) {
      toast.error(e?.message || "Kunne ikke synke til shop");
    } finally {
      setSyncing(false);
    }
  };

  const run = async (m: Mode) => {
    setMode(m);
    setLoading(true);
    setShortDraft("");
    setLongDraft("");
    try {
      const { data, error } = await supabase.functions.invoke("ai-rewrite-description", {
        body: { productId, mode: m },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setShortDraft((data as any).short_description ?? "");
      setLongDraft((data as any).long_description ?? "");
    } catch (e: any) {
      toast.error(e?.message || "AI-fejl");
      setMode(null);
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("master_products")
        .update({ short_description: shortDraft, long_description: longDraft })
        .eq("id", productId);
      if (error) throw error;
      toast.success("Beskrivelser gemt – synkes ikke automatisk til shoppen");
      qc.invalidateQueries({ queryKey: ["master_product", productId] });
      qc.invalidateQueries({ queryKey: ["product_change_log", productId] });
      setMode(null);
    } catch (e: any) {
      toast.error(e?.message || "Kunne ikke gemme");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => run("clean")} disabled={loading}>
          <Eraser className="h-3.5 w-3.5" />
          Rens HTML / WooCommerce-kode
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => run("rewrite")} disabled={loading}>
          <Sparkles className="h-3.5 w-3.5" />
          Generér ny beskrivelse
        </Button>
        {loading && (
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> AI arbejder…
          </span>
        )}
        <div className="ml-auto">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                size="sm"
                disabled={!hasPimContent || syncing}
                title={!hasPimContent ? "Gem en beskrivelse i PIM først" : "Skub PIM-beskrivelsen til WooCommerce"}
              >
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Synk beskrivelse til shop
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Skub beskrivelse til WooCommerce?</AlertDialogTitle>
                <AlertDialogDescription>
                  Den nuværende kort + lang beskrivelse fra PIM overskriver det der ligger i shoppen lige nu.
                  Handlingen kan ikke fortrydes automatisk.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annullér</AlertDialogCancel>
                <AlertDialogAction onClick={syncToShop}>Ja, synk nu</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Dialog open={mode !== null && !loading} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {mode === "clean" ? "Renset beskrivelse – preview" : "Ny AI-beskrivelse – preview"}
            </DialogTitle>
            <DialogDescription>
              Sammenlign og redigér før du gemmer. Gem opdaterer kun PIM – beskrivelsen synkes
              <strong> ikke </strong> til webshoppen før du aktivt klikker “Synk til shop” på produktet.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">Nuværende</h4>
              <div className="space-y-2">
                <Label className="text-xs">Kort beskrivelse</Label>
                <div className="rounded border bg-muted/30 p-3 text-xs max-h-48 overflow-auto">
                  <pre className="whitespace-pre-wrap break-words font-mono">{currentShort || "(tom)"}</pre>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Lang beskrivelse</Label>
                <div className="rounded border bg-muted/30 p-3 text-xs max-h-80 overflow-auto">
                  <pre className="whitespace-pre-wrap break-words font-mono">{currentLong || "(tom)"}</pre>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-medium">Forslag (redigerbart)</h4>
              <div className="space-y-2">
                <Label className="text-xs">Kort beskrivelse</Label>
                <Textarea value={shortDraft} onChange={(e) => setShortDraft(e.target.value)} rows={5} className="text-xs font-mono" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Lang beskrivelse</Label>
                <Textarea value={longDraft} onChange={(e) => setLongDraft(e.target.value)} rows={14} className="text-xs font-mono" />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setMode(null)} disabled={saving}>Annullér</Button>
            <Button variant="outline" onClick={() => mode && run(mode)} disabled={saving || loading}>
              Generér igen
            </Button>
            <Button onClick={save} disabled={saving || (!shortDraft && !longDraft)}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Gem i PIM (synker ikke)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
