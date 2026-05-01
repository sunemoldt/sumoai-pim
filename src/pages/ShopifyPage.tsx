import { forwardRef, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { ShoppingBag, CheckCircle2, XCircle, Loader2, ExternalLink, RefreshCw } from "lucide-react";

interface Status {
  shop_domain: string | null;
  scope: string | null;
  installed_at: string | null;
  is_connected: boolean;
}

interface ShopifyInstallResponse {
  install_url?: string;
  error?: string;
}

type ShopifyTestResult = Record<string, unknown>;

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const ShopifyPage = forwardRef<HTMLDivElement>(function ShopifyPage(_props, ref) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ShopifyTestResult | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("shopify_connection_status")
      .select("*")
      .maybeSingle();
    if (error) {
      console.error(error);
      setStatus(null);
    } else {
      setStatus(data ?? { shop_domain: null, scope: null, installed_at: null, is_connected: false });
    }
    setLoading(false);
  };

  useEffect(() => { loadStatus(); }, []);

  const startInstall = async () => {
    setInstalling(true);
    const installWindow = window.open("about:blank", "_blank");
    try {
      const { data, error } = await supabase.functions.invoke<ShopifyInstallResponse>("shopify-oauth-start", { body: {} });
      if (error) throw error;
      if (data?.install_url) {
        if (installWindow) {
          installWindow.opener = null;
          installWindow.location.href = data.install_url;
        } else {
          window.location.href = data.install_url;
        }
      } else {
        throw new Error(data?.error || "No install URL returned");
      }
    } catch (e: unknown) {
      installWindow?.close();
      toast({ title: "Kunne ikke starte install", description: getErrorMessage(e), variant: "destructive" });
      setInstalling(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-admin-test", { body: {} });
      if (error) throw error;
      setTestResult(data);
      if (data?.connected) {
        toast({ title: "Forbindelse OK", description: `Forbundet til ${data.shop?.name || data.shop_domain}` });
      } else {
        toast({ title: "Test fejlede", description: JSON.stringify(data?.error || data), variant: "destructive" });
      }
    } catch (e: unknown) {
      toast({ title: "Test fejlede", description: getErrorMessage(e), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div ref={ref} className="container mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <ShoppingBag className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Shopify</h1>
          <p className="text-sm text-muted-foreground">Forbind PIM'en til din Shopify-butik via Admin API (2025-10)</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Status
            {!loading && status?.is_connected && (
              <Badge variant="default">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Forbundet
              </Badge>
            )}
            {!loading && !status?.is_connected && (
              <Badge variant="outline">
                <XCircle className="mr-1 h-3 w-3" /> Ikke forbundet
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Aktuel forbindelse til Shopify Admin API
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Indlæser...
            </div>
          ) : status?.is_connected ? (
            <div className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">Butik:</span> <span className="font-mono">{status.shop_domain}</span></div>
              <div><span className="text-muted-foreground">Scopes:</span> <span className="font-mono text-xs">{status.scope}</span></div>
              <div><span className="text-muted-foreground">Installeret:</span> {status.installed_at ? new Date(status.installed_at).toLocaleString("da-DK") : "—"}</div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              App'en er endnu ikke installeret. Klik nedenfor for at starte OAuth install-flowet.
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={startInstall} disabled={installing}>
              {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              {status?.is_connected ? "Geninstallér app" : "Installér Shopify-app"}
            </Button>
            {status?.is_connected && (
              <>
                <Button variant="outline" onClick={testConnection} disabled={testing}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Test forbindelse
                </Button>
                <Button variant="ghost" onClick={loadStatus}>
                  <RefreshCw className="h-4 w-4" /> Genindlæs
                </Button>
              </>
            )}
          </div>

          {testResult && (
            <pre className="mt-4 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sådan virker det</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. Klik <strong>Installér Shopify-app</strong> — du sendes til Shopify hvor du godkender app'en på din butik.</p>
          <p>2. Shopify sender dig tilbage til PIM'en med et access token, som gemmes sikkert i backenden.</p>
          <p>3. Når forbundet kan PIM'en læse og opdatere produkter, varianter og lager via Shopify Admin GraphQL API (2025-10).</p>
          <p className="pt-2 text-xs">Scopes: <code className="text-xs">read_products, write_products, read_inventory, write_inventory, read_product_listings</code></p>
        </CardContent>
      </Card>
    </div>
  );
});

export default ShopifyPage;
