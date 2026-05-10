import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export default function ShopifyBulkPullCard() {
  const [loading, setLoading] = useState(false);
  const [last, setLast] = useState<{ ok: number; failed: number; total: number } | null>(null);
  const { toast } = useToast();

  const run = async () => {
    if (!confirm("Træk ALLE Shopify-koblede produkter (tekst, lager, varianter) ind i PIM nu? Dette respekterer master-felt-policy.")) return;
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("shopify-pull", { body: { all: true } });
    setLoading(false);
    if (error || (data as any)?.error) {
      toast({ title: "Bulk pull fejlede", description: error?.message ?? (data as any)?.error, variant: "destructive" });
      return;
    }
    const r = data as { total: number; ok: number; failed: number };
    setLast(r);
    toast({ title: "Bulk pull færdig", description: `${r.ok}/${r.total} ok, ${r.failed} fejl` });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" /> Hent fra Shopify</CardTitle>
        <p className="text-sm text-muted-foreground">
          Synkroniserer ALLE Shopify-koblede produkter ind i PIM. Felter overskrives kun hvis Shopify er master i policy. Varianter og lifecycle-status synkroniseres altid.
        </p>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <Button onClick={run} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Træk alle fra Shopify
        </Button>
        {last && (
          <span className="text-sm text-muted-foreground">Sidst: {last.ok}/{last.total} ok ({last.failed} fejl)</span>
        )}
      </CardContent>
    </Card>
  );
}
