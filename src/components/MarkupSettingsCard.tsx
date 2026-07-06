import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Save, Trash2, Percent } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type Row = {
  id: string;
  scope: "global" | "brand" | "product";
  scope_value: string | null;
  markup_percentage: number;
  minimum_margin: number;
};

/**
 * Full CRUD on price_settings markup rows (global + brand overrides) + the
 * global default for min_sync_margin (stored in analytics_settings).
 * Rows used for other purposes (price_rounding, default_backorder, wc_schedule)
 * are filtered out here so this stays focused on markup.
 */
export default function MarkupSettingsCard() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [minSyncMargin, setMinSyncMargin] = useState("15");
  const [savingSync, setSavingSync] = useState(false);

  // New brand row inputs
  const [newBrand, setNewBrand] = useState("");
  const [newMarkup, setNewMarkup] = useState("30");
  const [newMinMargin, setNewMinMargin] = useState("10");

  const load = async () => {
    setLoading(true);
    const [{ data: ps }, { data: as }] = await Promise.all([
      supabase
        .from("price_settings")
        .select("id, scope, scope_value, markup_percentage, minimum_margin")
        .in("scope", ["global", "brand", "product"])
        .order("scope"),
      supabase
        .from("analytics_settings")
        .select("setting_value")
        .eq("setting_key", "min_sync_margin_default")
        .maybeSingle(),
    ]);
    setRows((ps ?? []) as Row[]);
    setMinSyncMargin(as?.setting_value ?? "15");
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const patch = (id: string, key: "markup_percentage" | "minimum_margin", value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: Number(value) } : r)));
  };

  const saveRow = async (row: Row) => {
    if (Number.isNaN(row.markup_percentage) || Number.isNaN(row.minimum_margin)) {
      toast.error("Ugyldige tal");
      return;
    }
    setSaving(row.id);
    const { error } = await supabase
      .from("price_settings")
      .update({
        markup_percentage: row.markup_percentage,
        minimum_margin: row.minimum_margin,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    setSaving(null);
    if (error) return toast.error(error.message);
    toast.success("Gemt");
    qc.invalidateQueries({ queryKey: ["price_settings"] });
  };

  const deleteRow = async (row: Row) => {
    if (row.scope === "global") {
      toast.error("Global markup kan ikke slettes");
      return;
    }
    if (!confirm(`Slet override for ${row.scope_value}?`)) return;
    setSaving(row.id);
    const { error } = await supabase.from("price_settings").delete().eq("id", row.id);
    setSaving(null);
    if (error) return toast.error(error.message);
    toast.success("Slettet");
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    qc.invalidateQueries({ queryKey: ["price_settings"] });
  };

  const addBrand = async () => {
    const brand = newBrand.trim();
    if (!brand) return toast.error("Angiv brand");
    if (rows.some((r) => r.scope === "brand" && r.scope_value?.toLowerCase() === brand.toLowerCase())) {
      return toast.error("Brand-override findes allerede");
    }
    setSaving("new");
    const { data, error } = await supabase
      .from("price_settings")
      .insert({
        scope: "brand",
        scope_value: brand,
        markup_percentage: Number(newMarkup) || 0,
        minimum_margin: Number(newMinMargin) || 0,
      } as any)
      .select("id, scope, scope_value, markup_percentage, minimum_margin")
      .single();
    setSaving(null);
    if (error) return toast.error(error.message);
    setRows((prev) => [...prev, data as Row]);
    setNewBrand("");
    toast.success("Brand-override tilføjet");
    qc.invalidateQueries({ queryKey: ["price_settings"] });
  };

  const saveMinSync = async () => {
    const n = Number(minSyncMargin);
    if (Number.isNaN(n) || n < 0 || n > 100) return toast.error("Skal være 0-100");
    setSavingSync(true);
    const { error } = await supabase
      .from("analytics_settings")
      .upsert({ setting_key: "min_sync_margin_default", setting_value: String(n) }, { onConflict: "setting_key" });
    setSavingSync(false);
    if (error) return toast.error(error.message);
    toast.success("Standard min. sync-margin gemt");
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Percent className="h-4 w-4" /> Avanceprocenter (Markup)
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Global markup bruges for alle produkter uden egen tærskel. Brand-overrides bruges automatisk når produktets brand matcher.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Indlæser …
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/50">
                  <TableHead>Niveau</TableHead>
                  <TableHead>Værdi</TableHead>
                  <TableHead className="w-[140px]">Markup %</TableHead>
                  <TableHead className="w-[140px]">Min. avance %</TableHead>
                  <TableHead className="w-[180px] text-right">Handlinger</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant="secondary">{r.scope === "global" ? "Global" : r.scope === "brand" ? "Brand" : "Produkt"}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.scope_value ?? "Alle"}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.1"
                        value={r.markup_percentage}
                        onChange={(e) => patch(r.id, "markup_percentage", e.target.value)}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.1"
                        value={r.minimum_margin}
                        onChange={(e) => patch(r.id, "minimum_margin", e.target.value)}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="secondary" disabled={saving === r.id} onClick={() => saveRow(r)}>
                          {saving === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        </Button>
                        {r.scope !== "global" && (
                          <Button size="sm" variant="ghost" disabled={saving === r.id} onClick={() => deleteRow(r)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-3">
              <p className="text-sm font-medium">Tilføj brand-override</p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">Brand</Label>
                  <Input value={newBrand} onChange={(e) => setNewBrand(e.target.value)} placeholder="fx Kingston" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Markup %</Label>
                  <Input type="number" step="0.1" value={newMarkup} onChange={(e) => setNewMarkup(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Min. avance %</Label>
                  <Input type="number" step="0.1" value={newMinMargin} onChange={(e) => setNewMinMargin(e.target.value)} />
                </div>
                <Button onClick={addBrand} disabled={saving === "new"}>
                  {saving === "new" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                  Tilføj
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-border p-3 space-y-2">
              <Label className="text-sm font-medium">Global standard for min. sync-margin</Label>
              <p className="text-xs text-muted-foreground">
                Bruges af auto-lagersync når produktet ikke har sin egen tærskel. Var tidligere fastlåst til 15 %.
              </p>
              <div className="flex gap-2 items-center max-w-xs">
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={100}
                  value={minSyncMargin}
                  onChange={(e) => setMinSyncMargin(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">%</span>
                <Button onClick={saveMinSync} disabled={savingSync}>
                  {savingSync ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Gem
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
