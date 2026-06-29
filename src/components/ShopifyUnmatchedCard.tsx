import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Loader2, Search, Link2, Plus, ExternalLink, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

interface UnmatchedVariant {
  shopify_product_id: string;
  shopify_variant_id: string;
  product_title: string;
  variant_title: string;
  sku: string;
  barcode: string;
  price: string | null;
  inventory_quantity: number | null;
  image_url: string | null;
  status: string;
  pim_ean_conflict: { id: string; title: string } | null;
  pim_sku_conflict: { id: string; title: string } | null;
}

interface ScanResult {
  shop_domain: string;
  total_variants: number;
  linked_in_pim: number;
  unmatched_count: number;
  unmatched: UnmatchedVariant[];
}

interface PimSearchResult { id: string; title: string; ean: string | null; sku: string | null; }

export function ShopifyUnmatchedCard() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linkDialogFor, setLinkDialogFor] = useState<UnmatchedVariant | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<PimSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const scan = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke<ScanResult & { error?: string }>("shopify-find-unmatched", { body: {} });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      setResult(data as ScanResult);
      toast({ title: "Scanning færdig", description: `${data!.unmatched_count} umatchede varianter af ${data!.total_variants} totalt.` });
    } catch (e) {
      toast({ title: "Fejl ved scanning", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const removeRowFromState = (variantId: string) => {
    setResult((r) => r ? { ...r, unmatched: r.unmatched.filter(v => v.shopify_variant_id !== variantId), unmatched_count: r.unmatched_count - 1 } : r);
  };

  const createInPim = async (v: UnmatchedVariant) => {
    setBusyId(v.shopify_variant_id);
    try {
      const { data, error } = await supabase.functions.invoke<{ success?: boolean; master_product_id?: string; error?: string; conflict_id?: string }>(
        "shopify-create-from-variant",
        { body: { shopify_product_id: v.shopify_product_id, shopify_variant_id: v.shopify_variant_id } },
      );
      if (error || data?.error) throw new Error(error?.message || data?.error);
      toast({ title: "Produkt oprettet", description: `${v.product_title} er oprettet i PIM.` });
      removeRowFromState(v.shopify_variant_id);
    } catch (e) {
      toast({ title: "Kunne ikke oprette", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const linkToExisting = async (v: UnmatchedVariant, masterProductId: string) => {
    setBusyId(v.shopify_variant_id);
    try {
      const { data, error } = await supabase.functions.invoke<{ success?: boolean; error?: string }>(
        "shopify-link-variant",
        { body: { shopify_product_id: v.shopify_product_id, shopify_variant_id: v.shopify_variant_id, master_product_id: masterProductId } },
      );
      if (error || data?.error) throw new Error(error?.message || data?.error);
      toast({ title: "Linket", description: `${v.product_title} er linket til PIM.` });
      removeRowFromState(v.shopify_variant_id);
      setLinkDialogFor(null);
      setSearchTerm("");
      setSearchResults([]);
    } catch (e) {
      toast({ title: "Kunne ikke linke", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const searchPim = async (term: string) => {
    setSearchTerm(term);
    if (term.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const t = term.trim();
      const { data } = await supabase
        .from("master_products")
        .select("id, title, ean, sku")
        .or(`title.ilike.%${t}%,ean.ilike.%${t}%,sku.ilike.%${t}%`)
        .limit(20);
      setSearchResults((data ?? []) as PimSearchResult[]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Umatchede Shopify-produkter</CardTitle>
        <CardDescription>
          Find Shopify-varianter, der ikke er linket til et PIM-produkt. Link til eksisterende eller opret nye.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Button onClick={scan} disabled={scanning}>
            {scanning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
            Scan Shopify for umatchede
          </Button>
          {result && (
            <span className="text-sm text-muted-foreground">
              {result.unmatched_count} umatchede af {result.total_variants} varianter ({result.linked_in_pim} linket).
            </span>
          )}
        </div>

        {result && result.unmatched.length > 0 && (
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2">Produkt</th>
                  <th className="p-2">SKU</th>
                  <th className="p-2">EAN</th>
                  <th className="p-2">Pris</th>
                  <th className="p-2">Lager</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Handling</th>
                </tr>
              </thead>
              <tbody>
                {result.unmatched.map((v) => {
                  const conflict = v.pim_ean_conflict ?? v.pim_sku_conflict;
                  const conflictKind = v.pim_ean_conflict ? "EAN" : v.pim_sku_conflict ? "SKU" : null;
                  return (
                    <tr key={v.shopify_variant_id} className="border-t align-top">
                      <td className="p-2">
                        <div className="flex items-start gap-2">
                          {v.image_url && <img src={v.image_url} alt="" className="h-10 w-10 rounded object-cover" />}
                          <div>
                            <div className="font-medium">{v.product_title}</div>
                            {v.variant_title && v.variant_title !== "Default Title" && (
                              <div className="text-xs text-muted-foreground">{v.variant_title}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-2 font-mono text-xs">{v.sku || "—"}</td>
                      <td className="p-2 font-mono text-xs">{v.barcode || "—"}</td>
                      <td className="p-2">{v.price ?? "—"}</td>
                      <td className="p-2">{v.inventory_quantity ?? "—"}</td>
                      <td className="p-2">
                        {conflict ? (
                          <Badge variant="outline" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {conflictKind} findes
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Ny</Badge>
                        )}
                        {conflict && (
                          <Link to={`/products/${conflict.id}`} className="block text-xs text-muted-foreground hover:underline mt-1">
                            <ExternalLink className="h-3 w-3 inline mr-1" />{conflict.title}
                          </Link>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        <div className="flex flex-col gap-1 items-end">
                          {conflict ? (
                            <Button size="sm" variant="default" disabled={busyId === v.shopify_variant_id}
                              onClick={() => linkToExisting(v, conflict.id)}>
                              {busyId === v.shopify_variant_id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Link2 className="h-3 w-3 mr-1" />}
                              Link til {conflictKind}-match
                            </Button>
                          ) : (
                            <Button size="sm" variant="default" disabled={busyId === v.shopify_variant_id}
                              onClick={() => createInPim(v)}>
                              {busyId === v.shopify_variant_id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
                              Opret i PIM
                            </Button>
                          )}
                          <Button size="sm" variant="outline" disabled={busyId === v.shopify_variant_id}
                            onClick={() => { setLinkDialogFor(v); setSearchTerm(""); setSearchResults([]); }}>
                            <Search className="h-3 w-3 mr-1" />Søg & link
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {result && result.unmatched.length === 0 && (
          <div className="text-sm text-muted-foreground">Alle Shopify-varianter er linket til PIM. 🎉</div>
        )}
      </CardContent>

      <Dialog open={!!linkDialogFor} onOpenChange={(open) => { if (!open) setLinkDialogFor(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Link Shopify-variant til PIM-produkt</DialogTitle>
            <DialogDescription>
              {linkDialogFor && <>Søg efter et eksisterende PIM-produkt at linke <strong>{linkDialogFor.product_title}</strong> til.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Søg på titel, EAN eller SKU..."
              value={searchTerm}
              onChange={(e) => searchPim(e.target.value)}
              autoFocus
            />
            <div className="border rounded-md max-h-96 overflow-y-auto">
              {searching && <div className="p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 inline animate-spin mr-2" />Søger...</div>}
              {!searching && searchResults.length === 0 && searchTerm.length >= 2 && (
                <div className="p-4 text-sm text-muted-foreground">Ingen resultater.</div>
              )}
              {!searching && searchResults.map((r) => (
                <button
                  key={r.id}
                  className="w-full text-left p-3 border-b last:border-0 hover:bg-muted/50 disabled:opacity-50"
                  disabled={busyId === linkDialogFor?.shopify_variant_id}
                  onClick={() => linkDialogFor && linkToExisting(linkDialogFor, r.id)}
                >
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    EAN: {r.ean ?? "—"} · SKU: {r.sku ?? "—"}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogFor(null)}>Annuller</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
