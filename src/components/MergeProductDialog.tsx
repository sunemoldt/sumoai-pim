import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Package, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

type Candidate = {
  id: string;
  title: string;
  ean: string;
  brand: string | null;
  image_url: string | null;
  shopify_product_id: string | null;
  webshop_product_id: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: { id: string; title: string; ean: string };
};

export default function MergeProductDialog({ open, onOpenChange, source }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<Candidate | null>(null);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const search = async () => {
    const term = q.trim();
    if (term.length < 2) return;
    setSearching(true);
    const { data, error } = await supabase
      .from("master_products")
      .select("id,title,ean,brand,image_url,shopify_product_id,webshop_product_id")
      .or(`title.ilike.%${term}%,ean.ilike.%${term}%,sku.ilike.%${term}%`)
      .neq("id", source.id)
      .limit(20);
    setSearching(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setResults((data ?? []) as Candidate[]);
  };

  const merge = async () => {
    if (!target || !primaryId) return;
    // Primary = beholdes, other = slettes
    const keep = primaryId === source.id ? { id: source.id, title: source.title } : { id: target.id, title: target.title };
    const drop = primaryId === source.id ? { id: target.id, title: target.title } : { id: source.id, title: source.title };
    setMerging(true);
    try {
      // Move supplier_products: skip rows that already exist on keep for same supplier
      const { data: keepSps } = await supabase
        .from("supplier_products")
        .select("supplier_id")
        .eq("master_product_id", keep.id);
      const taken = new Set((keepSps ?? []).map((r: any) => r.supplier_id));

      const { data: dropSps } = await supabase
        .from("supplier_products")
        .select("id, supplier_id")
        .eq("master_product_id", drop.id);

      const toMove = (dropSps ?? []).filter((r: any) => !taken.has(r.supplier_id)).map((r: any) => r.id);
      const toDelete = (dropSps ?? []).filter((r: any) => taken.has(r.supplier_id)).map((r: any) => r.id);

      if (toMove.length > 0) {
        const { error } = await supabase
          .from("supplier_products")
          .update({ master_product_id: keep.id })
          .in("id", toMove);
        if (error) throw error;
      }
      if (toDelete.length > 0) {
        await supabase.from("supplier_products").delete().in("id", toDelete);
      }

      // Move variants
      await supabase
        .from("product_variants")
        .update({ master_product_id: keep.id })
        .eq("master_product_id", drop.id);

      // Delete other master product
      const { error: delErr } = await supabase.from("master_products").delete().eq("id", drop.id);
      if (delErr) throw delErr;

      toast.success(`Flettet ind i "${keep.title}"`);
      qc.invalidateQueries({ queryKey: ["master_products"] });
      qc.invalidateQueries({ queryKey: ["master_product", keep.id] });
      onOpenChange(false);
      if (keep.id !== source.id) navigate(`/products/${keep.id}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Fletning fejlede");

    } finally {
      setMerging(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Flet produkt</DialogTitle>
          <DialogDescription>
            Flyt alle leverandør-priser og varianter fra <span className="font-medium text-foreground">{source.title}</span> (EAN {source.ean}) over på et andet produkt. Dette produkt slettes derefter.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            placeholder="Søg på titel, EAN eller SKU…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <Button onClick={search} disabled={searching || q.trim().length < 2}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>

        <div className="max-h-72 overflow-y-auto space-y-1 border rounded-md p-1">
          {results.length === 0 && (
            <p className="text-sm text-muted-foreground p-3 text-center">Ingen resultater — søg ovenfor.</p>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => setTarget(r)}
              className={`w-full flex items-center gap-3 p-2 rounded-md text-left hover:bg-accent transition-colors ${target?.id === r.id ? "bg-accent ring-1 ring-primary" : ""}`}
            >
              <div className="h-10 w-10 rounded bg-secondary flex items-center justify-center shrink-0">
                {r.image_url ? <img src={r.image_url} alt="" className="h-full w-full object-contain" /> : <Package className="h-4 w-4 text-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{r.title}</p>
                <p className="text-xs text-muted-foreground font-mono">{r.ean} {r.shopify_product_id && "· Shopify"}</p>
              </div>
            </button>
          ))}
        </div>

        {target && (
          <div className="text-sm bg-warning/10 border border-warning/30 rounded-md p-3 flex items-center gap-2">
            <span className="font-medium">{source.title}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{target.title}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={merging}>Annullér</Button>
          <Button variant="destructive" onClick={merge} disabled={!target || merging}>
            {merging && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Flet og slet kildeprodukt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
