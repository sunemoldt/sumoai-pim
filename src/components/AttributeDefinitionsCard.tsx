import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Tag } from "lucide-react";
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
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("attribute_definitions")
      .select("id, key, label, unit, type, is_variant_axis, sort_order")
      .order("sort_order").order("label");
    if (error) toast({ title: "Fejl", description: error.message, variant: "destructive" });
    setRows((data ?? []) as Def[]);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Tag className="h-5 w-5" /> Attribut-definitioner</CardTitle>
        <p className="text-sm text-muted-foreground">
          Definer hvilke attributter produkter kan have (Farve, Længde, Materiale, …). Marker som "variant-akse" hvis attributten kan adskille varianter.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Henter…</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
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
                  <TableCell><Input placeholder="farve" value={newKey} onChange={(e) => setNewKey(e.target.value)} className="h-8" /></TableCell>
                  <TableCell><Input placeholder="Farve" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className="h-8" /></TableCell>
                  <TableCell colSpan={3} className="text-sm text-muted-foreground">Type=Tekst, ingen enhed (kan ændres efter oprettelse)</TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={add} disabled={!newKey || !newLabel}><Plus className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
