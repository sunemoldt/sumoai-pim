import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Variant = {
  id: string;
  shopify_variant_id: string | null;
  sku: string | null;
  ean: string | null;
  webshop_price: number | null;
  sale_price: number | null;
  stock_quantity: number | null;
  weight: number | null;
  attributes: Record<string, string> | null;
  position: number;
};

export default function ProductVariantsTab({ masterProductId, hasShopify }: { masterProductId: string; hasShopify: boolean }) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("product_variants")
      .select("id, shopify_variant_id, sku, ean, webshop_price, sale_price, stock_quantity, weight, attributes, position")
      .eq("master_product_id", masterProductId)
      .order("position");
    setVariants((data ?? []) as Variant[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [masterProductId]);

  const pullFromShopify = async () => {
    setPulling(true);
    const { data, error } = await supabase.functions.invoke("shopify-pull", {
      body: { master_product_id: masterProductId },
    });
    setPulling(false);
    if (error || (data as any)?.error) {
      toast({ title: "Pull fejlede", description: error?.message ?? (data as any)?.error, variant: "destructive" });
    } else {
      const r = (data as any)?.results?.[0];
      toast({ title: "Hentet fra Shopify", description: `${r?.variants ?? 0} variant(er) synkroniseret.` });
      load();
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Varianter ({variants.length})</CardTitle>
        {hasShopify && (
          <Button size="sm" variant="outline" onClick={pullFromShopify} disabled={pulling}>
            {pulling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Træk varianter fra Shopify
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Henter…</div>
        ) : variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ingen varianter registreret. {hasShopify ? "Klik 'Træk varianter fra Shopify' for at synkronisere." : "Forbind Shopify for at hente varianter."}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>EAN</TableHead>
                <TableHead>Attributter</TableHead>
                <TableHead className="text-right">Pris</TableHead>
                <TableHead className="text-right">Tilbud</TableHead>
                <TableHead className="text-right">Lager</TableHead>
                <TableHead className="text-right">Vægt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variants.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs">{v.sku ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{v.ean ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    {v.attributes && Object.keys(v.attributes).length > 0
                      ? Object.entries(v.attributes).map(([k, val]) => `${k}: ${val}`).join(", ")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">{v.webshop_price != null ? `${v.webshop_price} kr` : "—"}</TableCell>
                  <TableCell className="text-right">{v.sale_price != null ? `${v.sale_price} kr` : "—"}</TableCell>
                  <TableCell className="text-right">{v.stock_quantity ?? 0}</TableCell>
                  <TableCell className="text-right">{v.weight != null ? `${v.weight} kg` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
