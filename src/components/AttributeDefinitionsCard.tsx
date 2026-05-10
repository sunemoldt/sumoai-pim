import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Tag, Merge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Def = {
  id: string;
  key: string;
  label: string;
  unit: string | null;
  type: string;
  is_variant_axis: boolean;
  sort_order: number;
};

export default function AttributeDefinitionsCard() {
  const [rows, setRows] = useState<Def[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [targetId, setTargetId] = useState<string>("");
  const [merging, setMerging] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("attribute_definitions")
      .select("id, key, label, unit, type, is_variant_axis, sort_order")
      .order("sort_order").order("label");
    if (error) toast({ title: "Fejl", description: error.message, variant: "destructive" });
    setRows((data ?? []) as Def[]);
    setSelected(new Set());
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!newKey.trim() || !newLabel.trim()) return;
    const { error } = await supabase.from("attribute_definitions").insert({
      key: newKey.trim().toLowerCase().replace(/\s+/g, "_"),
      label: newLabel.trim(),
      type: "text",
    });
    if (error) { toast({ title: "Kunne ikke oprette", description: error.message, variant: "destructive" }); return; }
    setNewKey(""); setNewLabel("");
    load();
  };

  const update = async (id: string, patch: Partial<Def>) => {
    const { error } = await supabase.from("attribute_definitions").update(patch).eq("id", id);
    if (error) { toast({ title: "Fejl", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Slet denne attribut-definition?")) return;
    await supabase.from("attribute_definitions").delete().eq("id", id);
    load();
  };

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);

  const openMerge = () => {
    if (selectedRows.length < 2) {
      toast({ title: "Vælg mindst 2", description: "Marker mindst to attributter for at flette.", variant: "destructive" });
      return;
    }
    setTargetId(selectedRows[0].id);
    setMergeOpen(true);
  };

  const doMerge = async () => {
    if (!targetId) return;
    const sources = selectedRows.filter((r) => r.id !== targetId);
    if (sources.length === 0) return;
    setMerging(true);
    let totalProducts = 0, totalVariants = 0;
    try {
      for (const src of sources) {
        const { data, error } = await supabase.rpc("merge_attribute_definitions" as any, {
          p_source_id: src.id,
          p_target_id: targetId,
        });
        if (error) throw error;
        const d = data as any;
        totalProducts += d?.products_updated ?? 0;
        totalVariants += d?.variants_updated ?? 0;
      }
      toast({
        title: "Flettet",
        description: `${sources.length} attribut(ter) flettet. ${totalProducts} produkter og ${totalVariants} varianter opdateret.`,
      });
      setMergeOpen(false);
      load();
    } catch (e: any) {
      toast({ title: "Fejl ved fletning", description: e.message, variant: "destructive" });
    } finally {
      setMerging(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Tag className="h-5 w-5" /> Attribut-definitioner</CardTitle>
        <p className="text-sm text-muted-foreground">
          Definer hvilke attributter produkter kan have (Farve, Længde, Materiale, …). Marker som "variant-akse" hvis attributten kan adskille varianter. Marker flere rækker for at flette dubletter sammen.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Henter…</div>
        ) : (
          <>
            <div className="flex justify-end mb-3">
              <Button size="sm" variant="outline" onClick={openMerge} disabled={selected.size < 2}>
                <Merge className="h-4 w-4" /> Flet valgte ({selected.size})
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead>Nøgle</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead className="w-[110px]">Type</TableHead>
                  <TableHead className="w-[100px]">Enhed</TableHead>
                  <TableHead className="w-[140px] text-center">Variant-akse</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.key}</TableCell>
                    <TableCell>
                      <Input defaultValue={r.label} onBlur={(e) => { if (e.target.value !== r.label) update(r.id, { label: e.target.value }); }} className="h-8" />
                    </TableCell>
                    <TableCell>
                      <Select value={r.type} onValueChange={(v) => update(r.id, { type: v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Tekst</SelectItem>
                          <SelectItem value="number">Tal</SelectItem>
                          <SelectItem value="boolean">Ja/nej</SelectItem>
                          <SelectItem value="select">Liste</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input defaultValue={r.unit ?? ""} placeholder="kg, cm…" onBlur={(e) => { const v = e.target.value || null; if (v !== r.unit) update(r.id, { unit: v }); }} className="h-8" />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={r.is_variant_axis} onCheckedChange={(v) => update(r.id, { is_variant_axis: v })} />
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell></TableCell>
                  <TableCell><Input placeholder="farve" value={newKey} onChange={(e) => setNewKey(e.target.value)} className="h-8" /></TableCell>
                  <TableCell><Input placeholder="Farve" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className="h-8" /></TableCell>
                  <TableCell colSpan={3} className="text-sm text-muted-foreground">Type=Tekst, ingen enhed (kan ændres efter oprettelse)</TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={add} disabled={!newKey || !newLabel}><Plus className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </>
        )}

        <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Flet attribut-definitioner</DialogTitle>
              <DialogDescription>
                Vælg hvilken definition der skal beholdes. De øvrige slettes, og deres værdier flyttes på alle produkter og varianter til den valgte nøgle. Eksisterende værdier på målet overskrives ikke.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <label className="text-sm font-medium">Behold denne (mål):</label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {selectedRows.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label} <span className="text-muted-foreground font-mono text-xs ml-2">({r.key})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-sm text-muted-foreground pt-2">
                Slettes: {selectedRows.filter((r) => r.id !== targetId).map((r) => `${r.label} (${r.key})`).join(", ") || "—"}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMergeOpen(false)} disabled={merging}>Annullér</Button>
              <Button onClick={doMerge} disabled={merging || !targetId || selectedRows.length < 2}>
                {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />}
                Flet
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
