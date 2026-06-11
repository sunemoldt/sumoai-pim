import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Link2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface MatchRow {
  method: string;
  ean: string | null;
  sku: string | null;
  pim_title: string;
  shopify_title: string;
  shopify_barcode: string;
  shopify_sku: string;
  product_id: string;
  variant_id: string;
}

interface MatchResponse {
  success: boolean;
  dryRun: boolean;
  pim: {
    total: number;
    matched: number;
    unmatched: number;
    newly_updated: number;
    already_matched: number;
    match_methods: { ean: number; sku: number; title: number };
  };
  matched_sample: MatchRow[];
  unmatched_sample: { ean: string | null; sku: string | null; title: string }[];
}

export function ShopifyRematchCard() {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<MatchResponse | null>(null);

  const runDryRun = async () => {
    setLoading(true);
    setPreview(null);
    const { data, error } = await supabase.functions.invoke<MatchResponse>("shopify-match", {
      body: { onlyUnlinked: true, dryRun: true },
    });
    setLoading(false);
    if (error || !data?.success) {
      toast({ title: "Dry-run fejlede", description: error?.message ?? "Ukendt fejl", variant: "destructive" });
      return;
    }
    setPreview(data);
  };

  const apply = async () => {
    setApplying(true);
    const { data, error } = await supabase.functions.invoke<MatchResponse>("shopify-match", {
      body: { onlyUnlinked: true, dryRun: false },
    });
    setApplying(false);
    if (error || !data?.success) {
      toast({ title: "Link fejlede", description: error?.message ?? "Ukendt fejl", variant: "destructive" });
      return;
    }
    toast({ title: "Produkter linket", description: `${data.pim.newly_updated} produkt(er) blev linket til Shopify.` });
    setPreview(data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" />
          Rematch ulinkede produkter
        </CardTitle>
        <CardDescription>
          Find PIM-produkter uden Shopify-link og match dem på EAN/SKU/titel. Fallback-EAN'er (wc-) springes over.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={runDryRun} disabled={loading || applying} variant="outline">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Forhåndsvis matches (dry-run)
          </Button>
          {preview && preview.pim.matched > 0 && (
            <Button onClick={apply} disabled={applying}>
              {applying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Bekræft og link {preview.pim.matched} produkt(er)
            </Button>
          )}
        </div>

        {preview && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Gennemgået: {preview.pim.total}</Badge>
              <Badge variant="default">Matched: {preview.pim.matched}</Badge>
              <Badge variant="secondary">Allerede linket: {preview.pim.already_matched}</Badge>
              <Badge variant="destructive">Ingen match: {preview.pim.unmatched}</Badge>
              {preview.pim.newly_updated > 0 && (
                <Badge variant="default" className="bg-success">
                  Linket nu: {preview.pim.newly_updated}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Match-metoder — EAN: {preview.pim.match_methods.ean}, SKU: {preview.pim.match_methods.sku}, Titel: {preview.pim.match_methods.title}
            </div>

            {preview.matched_sample.length > 0 && (
              <div>
                <div className="font-medium mb-1">Eksempler på matches (op til 10):</div>
                <div className="rounded-md border divide-y">
                  {preview.matched_sample.map((m, i) => (
                    <div key={i} className="p-2 text-xs">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{m.method}</Badge>
                        <span className="font-medium truncate">{m.pim_title}</span>
                      </div>
                      <div className="text-muted-foreground mt-1">
                        PIM EAN: <code>{m.ean ?? "—"}</code> → Shopify: <code>{m.shopify_title}</code> (barcode <code>{m.shopify_barcode}</code>)
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preview.unmatched_sample.length > 0 && (
              <div>
                <div className="font-medium mb-1">Eksempler uden match (op til 15):</div>
                <div className="rounded-md border divide-y">
                  {preview.unmatched_sample.map((u, i) => (
                    <div key={i} className="p-2 text-xs">
                      <div className="truncate">{u.title}</div>
                      <div className="text-muted-foreground">EAN: <code>{u.ean ?? "—"}</code> · SKU: <code>{u.sku ?? "—"}</code></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
