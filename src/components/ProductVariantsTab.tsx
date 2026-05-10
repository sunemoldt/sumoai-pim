import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, ExternalLink, Link2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
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

type Sibling = {
  id: string;
  ean: string;
  title: string;
  shopify_variant_id: string | null;
};

export default function ProductVariantsTab({ masterProductId, hasShopify, shopifyProductId }: { masterProductId: string; hasShopify: boolean; shopifyProductId: string | null }) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [siblings, setSiblings] = useState<Sibling[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    const [vRes, sRes] = await Promise.all([
      supabase.from("product_variants")
        .select("id, shopify_variant_id, sku, ean, webshop_price, sale_price, stock_quantity, weight, attributes, position")
        .eq("master_product_id", masterProductId).order("position"),
      shopifyProductId
        ? supabase.from("master_products")
            .select("id, ean, title, shopify_variant_id")
            .eq("shopify_product_id", shopifyProductId)
        : Promise.resolve({ data: [] as Sibling[] }),
    ]);
    setVariants((vRes.data ?? []) as Variant[]);
    setSiblings(((sRes as any).data ?? []) as Sibling[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [masterProductId, shopifyProductId]);

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

  const otherSiblings = siblings.filter((s) => s.id !== masterProductId);

  return (
    <div className="space-y-4">
      {shopifyProductId && otherSiblings.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="h-4 w-4 text-warning" />
              Søsterprodukter i PIM ({otherSiblings.length})
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Disse PIM-produkter deler samme Shopify-produkt-ID (<span className="font-mono text-xs">{shopifyProductId}</span>) — i Shopify er de varianter af ét moderprodukt. PIM viser dem som separate rækker fordi de har forskellige EAN.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>EAN</TableHead>
                  <TableHead>Titel</TableHead>
                  <TableHead>Shopify-variant-ID</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {otherSiblings.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.ean}</TableCell>
                    <TableCell>{s.title}</TableCell>
                    <TableCell className="font-mono text-xs">{s.shopify_variant_id ?? "—"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/products/${s.id}`)}>
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Shopify-varianter ({variants.length})</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Alle varianter under dette Shopify-produkt-ID, hentet via "Træk fra Shopify".</p>
          </div>
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
            <p className="text-sm text-muted-foreground">Ingen varianter registreret endnu. {hasShopify ? "Klik 'Træk varianter fra Shopify'." : "Forbind Shopify for at hente varianter."}</p>
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
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map((v) => {
                  const matchedSibling = siblings.find((s) => s.shopify_variant_id === v.shopify_variant_id);
                  return (
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
                      <TableCell>
                        {matchedSibling ? (
                          <Badge variant="outline" className="cursor-pointer" onClick={() => navigate(`/products/${matchedSibling.id}`)}>
                            PIM-match <ExternalLink className="h-3 w-3 ml-1" />
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Ingen PIM-række</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
