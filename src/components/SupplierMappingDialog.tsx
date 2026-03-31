import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import type { Supplier } from "@/hooks/use-products";
import { Badge } from "@/components/ui/badge";

const SYSTEM_FIELDS = [
  { key: "ean", label: "EAN / Stregkode", required: true },
  { key: "sku", label: "Leverandør SKU", required: false },
  { key: "title", label: "Produktnavn", required: false },
  { key: "purchase_price", label: "Indkøbspris", required: true },
  { key: "stock_quantity", label: "Lagerantal", required: false },
  { key: "in_stock", label: "På lager (ja/nej)", required: false },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: Supplier;
}

export default function SupplierMappingDialog({ open, onOpenChange, supplier }: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedColumns, setFeedColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [delimiter, setDelimiter] = useState(";");

  // Load existing mapping
  useEffect(() => {
    if (supplier.column_mapping && typeof supplier.column_mapping === "object") {
      const existing = supplier.column_mapping as Record<string, string>;
      setMapping(existing);
      if (existing._delimiter) setDelimiter(existing._delimiter);
    } else {
      setMapping({});
    }
  }, [supplier, open]);

  // Fetch column headers from feed
  const fetchColumns = async () => {
    if (!supplier.feed_url) {
      toast.error("Ingen feed URL konfigureret");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("supplier-feed-preview", {
        body: { feed_url: supplier.feed_url, feed_type: supplier.feed_type, delimiter },
      });
      if (error) throw error;
      if (data?.columns) {
        setFeedColumns(data.columns);
        toast.success(`${data.columns.length} kolonner fundet`);
      } else if (data?.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      toast.error(err?.message || "Kunne ikke hente kolonner");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!mapping.ean) {
      toast.error("EAN-mapping er påkrævet");
      return;
    }
    if (!mapping.purchase_price) {
      toast.error("Indkøbspris-mapping er påkrævet");
      return;
    }
    setSaving(true);
    try {
      const fullMapping = { ...mapping, _delimiter: delimiter };
      const { error } = await supabase
        .from("suppliers")
        .update({ column_mapping: fullMapping })
        .eq("id", supplier.id);
      if (error) throw error;
      toast.success("Mapping gemt");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Fejl ved gemning");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Kolonne-mapping: {supplier.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-end gap-3">
            <div className="space-y-2 flex-1">
              <Label>CSV-separator</Label>
              <Input value={delimiter} onChange={(e) => setDelimiter(e.target.value)} className="w-20" />
            </div>
            <Button variant="outline" onClick={fetchColumns} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Hent kolonner fra feed
            </Button>
          </div>

          {feedColumns.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-xs text-muted-foreground mr-1">Kolonner:</span>
              {feedColumns.map((c) => (
                <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>
              ))}
            </div>
          )}

          <div className="space-y-3 border rounded-md p-4">
            <p className="text-sm font-medium text-foreground">Map feedkolonner → systemfelter</p>
            {SYSTEM_FIELDS.map((field) => (
              <div key={field.key} className="grid grid-cols-2 gap-3 items-center">
                <Label className="text-sm">
                  {field.label}
                  {field.required && <span className="text-destructive ml-1">*</span>}
                </Label>
                {feedColumns.length > 0 ? (
                  <Select
                    value={mapping[field.key] ?? ""}
                    onValueChange={(v) => setMapping((prev) => ({ ...prev, [field.key]: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Vælg kolonne..." />
                    </SelectTrigger>
                    <SelectContent>
                      {feedColumns.map((col) => (
                        <SelectItem key={col} value={col}>{col}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={mapping[field.key] ?? ""}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder="Kolonnenavn"
                  />
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Kun produkter med EAN der allerede findes i produktkataloget (fra WooCommerce) vil blive importeret.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuller</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Gem mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
