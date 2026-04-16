import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useSuppliers } from "@/hooks/use-products";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  masterProductId: string;
  /** Existing supplier_id => supplier_product row id, to support edit instead of create */
  existingBySupplier: Record<string, string>;
  /** Pre-select supplier for edit mode */
  editSupplierId?: string;
  initialPrice?: number;
  initialStockQty?: number | null;
  initialInStock?: boolean;
  initialSku?: string | null;
}

export default function ManualSupplierPriceDialog({
  open,
  onOpenChange,
  masterProductId,
  existingBySupplier,
  editSupplierId,
  initialPrice,
  initialStockQty,
  initialInStock,
  initialSku,
}: Props) {
  const queryClient = useQueryClient();
  const { data: allSuppliers = [] } = useSuppliers();
  const manualSuppliers = allSuppliers.filter((s) => s.feed_type === "manual" && s.is_active);

  const [supplierId, setSupplierId] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [sku, setSku] = useState<string>("");
  const [stockQty, setStockQty] = useState<string>("");
  const [inStock, setInStock] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSupplierId(editSupplierId ?? "");
      setPrice(initialPrice != null ? String(initialPrice) : "");
      setSku(initialSku ?? "");
      setStockQty(initialStockQty != null ? String(initialStockQty) : "");
      setInStock(initialInStock ?? true);
    }
  }, [open, editSupplierId, initialPrice, initialStockQty, initialInStock, initialSku]);

  const handleSave = async () => {
    if (!supplierId) {
      toast.error("Vælg en leverandør");
      return;
    }
    const priceNum = parseFloat(price.replace(",", "."));
    if (!isFinite(priceNum) || priceNum < 0) {
      toast.error("Ugyldig indkøbspris");
      return;
    }
    setSaving(true);
    try {
      const existingId = existingBySupplier[supplierId];
      const row = {
        master_product_id: masterProductId,
        supplier_id: supplierId,
        purchase_price: priceNum,
        supplier_sku: sku.trim() || null,
        stock_quantity: stockQty.trim() === "" ? null : parseInt(stockQty, 10),
        in_stock: inStock,
        last_updated: new Date().toISOString(),
      };

      if (existingId) {
        const { error } = await supabase.from("supplier_products").update(row).eq("id", existingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("supplier_products").insert(row);
        if (error) throw error;
      }

      toast.success(existingId ? "Indkøbspris opdateret" : "Manuel indkøbspris tilføjet");
      queryClient.invalidateQueries({ queryKey: ["master_product", masterProductId] });
      queryClient.invalidateQueries({ queryKey: ["master_products"] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Fejl ved gemning");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editSupplierId ? "Rediger manuel indkøbspris" : "Tilføj manuel indkøbspris"}</DialogTitle>
          <DialogDescription>
            Angiv en indkøbspris for dette produkt fra en manuel leverandør (uden feed).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Leverandør</Label>
            {manualSuppliers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Ingen manuelle leverandører fundet. Opret én under <strong>Leverandører</strong> med feed-type "Manuel".
              </p>
            ) : (
              <Select value={supplierId} onValueChange={setSupplierId} disabled={!!editSupplierId}>
                <SelectTrigger><SelectValue placeholder="Vælg manuel leverandør..." /></SelectTrigger>
                <SelectContent>
                  {manualSuppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-price">Indkøbspris (ekskl. moms)</Label>
            <Input
              id="manual-price"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0,00"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="manual-sku">SKU (valgfri)</Label>
              <Input id="manual-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="—" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-stock">Lagerantal</Label>
              <Input
                id="manual-stock"
                type="number"
                min="0"
                value={stockQty}
                onChange={(e) => setStockQty(e.target.value)}
                placeholder="—"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="manual-instock" checked={inStock} onCheckedChange={(v) => setInStock(!!v)} />
            <Label htmlFor="manual-instock" className="cursor-pointer">På lager</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuller</Button>
          <Button onClick={handleSave} disabled={saving || manualSuppliers.length === 0}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            {editSupplierId ? "Gem" : "Tilføj"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
