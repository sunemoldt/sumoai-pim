import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type ImportResult = {
  success: boolean;
  total_fetched?: number;
  imported?: number;
  errors?: string[];
  error?: string;
};

export default function ImportPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const queryClient = useQueryClient();

  const runImport = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("wc-import");
      if (error) throw error;
      setResult(data as ImportResult);
      if (data?.success) {
        toast.success(`${data.imported} produkter importeret fra WooCommerce`);
        queryClient.invalidateQueries({ queryKey: ["master_products"] });
      } else {
        toast.error(data?.error || "Import fejlede");
      }
    } catch (err: any) {
      const msg = err?.message || "Ukendt fejl";
      setResult({ success: false, error: msg });
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">WooCommerce Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Hent produkter fra din WooCommerce-butik og importer dem som masterprodukter
        </p>
      </div>

      <Card className="shadow-sm max-w-lg">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Synkroniser produkter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Henter alle produkter (inkl. varianter) fra WooCommerce og opretter/opdaterer dem i
            produktkataloget. Eksisterende produkter matches på EAN/SKU.
          </p>

          <Button onClick={runImport} disabled={loading} className="w-full">
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {loading ? "Importerer..." : "Start import"}
          </Button>

          {result && (
            <div className="rounded-md border border-border p-4 space-y-2">
              <div className="flex items-center gap-2">
                {result.success ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-destructive" />
                )}
                <span className="font-medium text-foreground">
                  {result.success ? "Import fuldført" : "Import fejlede"}
                </span>
              </div>

              {result.success && (
                <div className="flex gap-3 text-sm">
                  <Badge variant="secondary">Hentet: {result.total_fetched}</Badge>
                  <Badge variant="secondary" className="text-success border-success/30">
                    Importeret: {result.imported}
                  </Badge>
                </div>
              )}

              {result.error && (
                <p className="text-sm text-destructive">{result.error}</p>
              )}

              {result.errors && result.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Fejl:</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-destructive">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
