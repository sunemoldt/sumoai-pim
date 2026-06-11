import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, Save, ArrowLeftRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Policy = {
  field_name: string;
  master: "pim" | "shopify";
  direction: "push" | "pull" | "two_way" | "off";
  description: string | null;
};

const FIELD_LABELS: Record<string, string> = {
  title: "Titel",
  short_description: "Kort beskrivelse",
  long_description: "Lang beskrivelse",
  meta_title: "SEO titel",
  meta_description: "SEO beskrivelse",
  image_url: "Hovedbillede",
  webshop_price: "Salgspris",
  sale_price: "Tilbudspris",
  stock_quantity: "Lagerantal",
  stock_status: "Lagerstatus",
  backorders_allowed: "Restordre (legacy bool)",
  backorder_policy: "Restordre-politik",
  purchase_price: "Indkøbspris",
  ean: "EAN",
  sku: "SKU",
  brand: "Brand",
  category: "Kategori",
  weight: "Vægt (legacy)",
  weight_kg: "Vægt (kg)",
  attributes: "Attributter",
};

export default function FieldSyncPolicyCard() {
  const [rows, setRows] = useState<Policy[]>([]);
  const [original, setOriginal] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("field_sync_policy")
      .select("field_name, master, direction, description")
      .order("field_name");
    if (error) {
      toast({ title: "Kunne ikke hente policy", description: error.message, variant: "destructive" });
    } else {
      const list = (data ?? []) as Policy[];
      setRows(list);
      setOriginal(JSON.parse(JSON.stringify(list)));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const update = (field: string, patch: Partial<Policy>) => {
    setRows((prev) => prev.map((r) => (r.field_name === field ? { ...r, ...patch } : r)));
  };

  const dirty = JSON.stringify(rows) !== JSON.stringify(original);

  const save = async () => {
    setSaving(true);
    const changed = rows.filter((r) => {
      const o = original.find((x) => x.field_name === r.field_name);
      return !o || o.master !== r.master || o.direction !== r.direction;
    });
    if (changed.length === 0) { setSaving(false); return; }
    const { error } = await supabase
      .from("field_sync_policy")
      .upsert(changed.map(({ field_name, master, direction }) => ({ field_name, master, direction })));
    if (error) {
      toast({ title: "Fejl ved gem", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Sync-policy gemt", description: `${changed.length} felt(er) opdateret` });
      await load();
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5" />
          Master-felter (PIM ↔ Shopify)
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Bestem hvilket system der ejer hvert felt. <strong>Master = PIM</strong> betyder PIM skubber værdien til Shopify.
          <strong> Master = Shopify</strong> betyder PIM henter værdien fra Shopify og overskriver aldrig.
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
                  <TableHead>Felt</TableHead>
                  <TableHead className="w-[140px]">Master</TableHead>
                  <TableHead className="w-[160px]">Retning</TableHead>
                  <TableHead>Beskrivelse</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.field_name}>
                    <TableCell className="font-medium">{FIELD_LABELS[r.field_name] ?? r.field_name}</TableCell>
                    <TableCell>
                      <Select value={r.master} onValueChange={(v) => update(r.field_name, { master: v as "pim" | "shopify" })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pim">PIM</SelectItem>
                          <SelectItem value="shopify">Shopify</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={r.direction} onValueChange={(v) => update(r.field_name, { direction: v as Policy["direction"] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="push">Push (PIM → Shopify)</SelectItem>
                          <SelectItem value="pull">Pull (Shopify → PIM)</SelectItem>
                          <SelectItem value="two_way">To-vejs</SelectItem>
                          <SelectItem value="off">Slukket</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 flex justify-end">
              <Button onClick={save} disabled={!dirty || saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Gem ændringer
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
