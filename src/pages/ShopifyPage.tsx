import { forwardRef, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { ShoppingBag, CheckCircle2, XCircle, Loader2, ExternalLink, RefreshCw, Copy, Trash2, Star } from "lucide-react";
import { ShopifyRematchCard } from "@/components/ShopifyRematchCard";

interface Status {
  shop_domain: string | null;
  requested_shop_domain?: string | null;
  primary_domain_url?: string | null;
  shop_name?: string | null;
  scope: string | null;
  installed_at: string | null;
  is_connected: boolean;
  is_active?: boolean;
}

interface ConnectionRow {
  id: string;
  shop_domain: string;
  requested_shop_domain: string | null;
  primary_domain_url: string | null;
  shop_name: string | null;
  scope: string | null;
  is_active: boolean;
  installed_at: string;
  updated_at: string;
}

type ShopifyTestResult = Record<string, unknown>;

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isValidShopDomain = (domain: string) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain);
const isLovablePreview = () => window.location.hostname.includes("lovableproject.com") || window.location.hostname.includes("lovable.app");

const ShopifyPage = forwardRef<HTMLDivElement>(function ShopifyPage(_props, ref) {
  const [status, setStatus] = useState<Status | null>(null);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [shopDomainInput, setShopDomainInput] = useState("comtek-webshop.myshopify.com");
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [installUrlLoading, setInstallUrlLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ShopifyTestResult | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke<{ connections: ConnectionRow[] }>("shopify-connections", { method: "GET" });
    if (error) console.error(error);
    const rows = data?.connections ?? [];
    const active = rows.find((connection) => connection.is_active) ?? null;
    setConnections(rows);
    setStatus(active ? {
      shop_domain: active.shop_domain,
      requested_shop_domain: active.requested_shop_domain,
      primary_domain_url: active.primary_domain_url,
      shop_name: active.shop_name,
      scope: active.scope,
      installed_at: active.installed_at,
      is_connected: true,
      is_active: active.is_active,
    } : { shop_domain: null, scope: null, installed_at: null, is_connected: false });
    setLoading(false);
  };

  useEffect(() => { loadStatus(); }, []);

  useEffect(() => {
    const domain = shopDomainInput.trim();
    if (!isValidShopDomain(domain)) {
      setInstallUrl(null);
      setInstallUrlLoading(false);
      return;
    }

    let cancelled = false;
    setInstallUrlLoading(true);
    setInstallUrl(null);

    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke<{ install_url: string }>("shopify-oauth-start", {
        body: { shop_domain: domain },
      });
      if (cancelled) return;
      if (error || !data?.install_url) {
        console.error(error);
        setInstallUrl(null);
      } else {
        setInstallUrl(data.install_url);
      }
      setInstallUrlLoading(false);
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shopDomainInput]);

  const openInstallLink = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const domain = shopDomainInput.trim();
    if (!isValidShopDomain(domain)) {
      toast({ title: "Ugyldigt shop-domain", description: "Skal være f.eks. comtek-webshop.myshopify.com", variant: "destructive" });
      return;
    }
    if (!installUrl) {
      toast({ title: "Install-link ikke klar", description: "Vent et øjeblik og prøv igen.", variant: "destructive" });
      return;
    }
    if (isLovablePreview() && window.location.hostname !== "pim.sumoai.dk") {
      navigator.clipboard.writeText(installUrl).catch(() => undefined);
      toast({ title: "Install-link kopieret", description: "Indsæt linket direkte i browserens adressefelt — Shopify blokerer Lovable preview-rammen." });
      return;
    }

    const popup = window.open(installUrl, "shopify_oauth", "popup=yes,width=1100,height=800,noopener,noreferrer");
    if (!popup) {
      navigator.clipboard.writeText(installUrl).catch(() => undefined);
      toast({ title: "Popup blev blokeret", description: "Install-linket er kopieret — indsæt det i en ny browserfane.", variant: "destructive" });
      return;
    }
    popup.focus();
    toast({ title: "Shopify-installation åbner", description: "Godkend appen i det nye Shopify-vindue." });
  };

  const copyInstallLink = async () => {
    const domain = shopDomainInput.trim();
    if (!isValidShopDomain(domain)) {
      toast({ title: "Ugyldigt shop-domain", description: "Skal være f.eks. comtek-webshop.myshopify.com", variant: "destructive" });
      return;
    }
    if (!installUrl) {
      toast({ title: "Install-link ikke klar", description: "Vent et øjeblik og prøv igen.", variant: "destructive" });
      return;
    }
    await navigator.clipboard.writeText(installUrl);
    toast({ title: "Install-link kopieret", description: "Indsæt i en ny browserfane for at godkende på Shopify." });
  };

  const activateConnection = async (id: string, shop: string) => {
    const { error } = await supabase.functions.invoke("shopify-connections", {
      body: { action: "activate", id },
    });
    if (error) {
      toast({ title: "Kunne ikke skifte tenant", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Aktiv Shopify-tenant skiftet", description: shop });
    await loadStatus();
  };

  const deleteConnection = async (id: string, shop: string) => {
    if (!confirm(`Slet forbindelsen til ${shop}? Du kan altid geninstallere bagefter.`)) return;
    const { error } = await supabase.functions.invoke("shopify-connections", {
      body: { action: "delete", id },
    });
    if (error) {
      toast({ title: "Kunne ikke slette", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Forbindelse slettet", description: shop });
    await loadStatus();
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
            Aktiv tenant
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
            Den Shopify-butik PIM'et arbejder mod lige nu
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Indlæser...
            </div>
          ) : status?.is_connected ? (
            <div className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">Butik:</span> <span className="font-medium">{status.shop_name || "COMTEK.DK"}</span></div>
              <div><span className="text-muted-foreground">Domæne:</span> <span className="font-mono">{status.requested_shop_domain || status.primary_domain_url?.replace(/^https?:\/\//, "") || status.shop_domain}</span></div>
              <div><span className="text-muted-foreground">Shopify API-id:</span> <span className="font-mono text-xs">{status.shop_domain}</span></div>
              <div><span className="text-muted-foreground">Scopes:</span> <span className="font-mono text-xs">{status.scope}</span></div>
              <div><span className="text-muted-foreground">Installeret:</span> {status.installed_at ? new Date(status.installed_at).toLocaleString("da-DK") : "—"}</div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              App'en er endnu ikke installeret. Indtast shop-domæne nedenfor og klik installér.
            </p>
          )}

          {status?.is_connected && (
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={testConnection} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Test forbindelse
              </Button>
              <Button variant="ghost" onClick={loadStatus}>
                <RefreshCw className="h-4 w-4" /> Genindlæs
              </Button>
            </div>
          )}

          {testResult && (
            <pre className="mt-4 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Installér / skift Shopify-butik</CardTitle>
          <CardDescription>
            Indtast butikkens myshopify-domæne for at installere appen. Den nyligt installerede bliver automatisk aktiv.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="shop-domain">Shop-domæne</Label>
            <Input
              id="shop-domain"
              placeholder="comtek-webshop.myshopify.com"
              value={shopDomainInput}
              onChange={(e) => setShopDomainInput(e.target.value)}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Format: <code>navn.myshopify.com</code> — find det i Shopify-admin under Indstillinger → Domæner.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={openInstallLink} disabled={!installUrl || installUrlLoading}>
              {installUrlLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              {isLovablePreview() ? "Kopiér sikkert install-link" : `Installér på ${shopDomainInput.trim() || "..."}`}
            </Button>
            <Button variant="outline" onClick={copyInstallLink}>
              <Copy className="h-4 w-4" /> Kopiér install-link
            </Button>
            {isLovablePreview() && (
              <p className="basis-full text-xs text-muted-foreground">
                Shopify blokerer OAuth inde i Lovable preview. Brug knappen til at kopiere linket og indsæt det direkte i browserens adressefelt.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {connections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Alle forbindelser ({connections.length})</CardTitle>
            <CardDescription>Skift mellem registrerede Shopify-butikker eller slet ubrugte</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {connections.map((c) => (
                <div key={c.id} className={`flex items-center justify-between rounded-md border p-3 ${c.is_active ? "border-primary bg-primary/5" : "border-border"}`}>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{c.shop_name || c.requested_shop_domain || c.shop_domain}</span>
                      {c.is_active && (
                        <Badge variant="default" className="text-xs">
                          <Star className="mr-1 h-3 w-3" /> Aktiv
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.requested_shop_domain || c.primary_domain_url?.replace(/^https?:\/\//, "") || c.shop_domain} · API-id {c.shop_domain} · Installeret {new Date(c.installed_at).toLocaleString("da-DK")}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!c.is_active && (
                      <Button size="sm" variant="outline" onClick={() => activateConnection(c.id, c.shop_domain)}>
                        Aktiver
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => deleteConnection(c.id, c.shop_domain)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sådan virker det</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. Indtast butikkens shop-domæne (f.eks. <code>comtek-webshop.myshopify.com</code>) og klik installér.</p>
            <p>2. Du sendes ud af preview-rammen til Shopify hvor du godkender app'en. Shopify sender dig tilbage med et access token.</p>
          <p>3. Den nyligt installerede butik bliver automatisk **aktiv tenant** — alle PIM-handlinger arbejder herefter mod den.</p>
          <p>4. Du kan registrere flere butikker (f.eks. dev-store + produktion) og skifte mellem dem ovenfor.</p>
          <p className="pt-2 text-xs">Scopes: <code className="text-xs">read_products, write_products, read_inventory, write_inventory, read_product_listings</code></p>
        </CardContent>
      </Card>
    </div>
  );
});

export default ShopifyPage;
