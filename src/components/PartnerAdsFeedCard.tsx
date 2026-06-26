import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Rss, Loader2, Copy, ExternalLink } from "lucide-react";

type FeedRun = {
  id: string;
  status: string;
  product_count: number | null;
  file_size_bytes: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

const FEED_URL = `https://feed.sumoai.dk/partner-ads.xml`;

export function PartnerAdsFeedCard() {
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<FeedRun | null>(null);
  const [storeUrl, setStoreUrl] = useState("");
  const [savingStore, setSavingStore] = useState(false);

  const fetchLast = async () => {
    const { data } = await supabase
      .from("feed_runs")
      .select("id,status,product_count,file_size_bytes,error,started_at,finished_at")
      .eq("feed_key", "partner-ads")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastRun(data as FeedRun | null);
  };

  const fetchSettings = async () => {
    const { data } = await supabase
      .from("analytics_settings")
      .select("setting_value")
      .eq("setting_key", "feed_store_url")
      .maybeSingle();
    if (data?.setting_value) setStoreUrl(data.setting_value);
  };

  useEffect(() => {
    fetchLast();
    fetchSettings();
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-partner-ads-feed", { body: {} });
      if (error) throw error;
      toast.success(`Feed regenereret (${(data as any)?.product_count ?? 0} produkter)`);
      await fetchLast();
    } catch (err) {
      toast.error(`Generering fejlede: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const saveStoreUrl = async () => {
    setSavingStore(true);
    try {
      const trimmed = storeUrl.trim().replace(/\/+$/, "");
      const { error } = await supabase
        .from("analytics_settings")
        .upsert({ setting_key: "feed_store_url", setting_value: trimmed }, { onConflict: "setting_key" });
      if (error) throw error;
      setStoreUrl(trimmed);
      toast.success("Storefront-URL gemt");
    } catch (err) {
      toast.error(`Kunne ikke gemme: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingStore(false);
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(FEED_URL);
    toast.success("Feed-URL kopieret");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rss className="h-5 w-5" />
          Partner-ads produktfeed
        </CardTitle>
        <CardDescription>
          XML-feed i Google Shopping-format til affiliate-netværk som Partner-ads. Regenereres natligt kl. 02:15 UTC
          og caches i Storage. Brug URL'en herunder hos Partner-ads.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label>Feed-URL</Label>
          <div className="flex items-center gap-2">
            <Input readOnly value={FEED_URL} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={copyUrl} title="Kopiér">
              <Copy className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" asChild title="Åbn">
              <a href={FEED_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="feed-store-url">Storefront-URL (bruges til produkt-links)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="feed-store-url"
              placeholder="https://comtek.dk"
              value={storeUrl}
              onChange={(e) => setStoreUrl(e.target.value)}
            />
            <Button onClick={saveStoreUrl} disabled={savingStore} variant="outline">
              {savingStore ? <Loader2 className="h-4 w-4 animate-spin" /> : "Gem"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Hvis tom bruges Shopify primary domain. Produkt-links bygges som <code>storefront/products/&lt;handle&gt;</code>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={runNow} disabled={running} className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rss className="h-4 w-4" />}
            {running ? "Genererer..." : "Regenerér nu"}
          </Button>
          {lastRun && (
            <Badge variant={lastRun.status === "success" ? "default" : lastRun.status === "running" ? "secondary" : "destructive"}>
              {lastRun.status === "success" ? "✓ sidste OK" : lastRun.status === "running" ? "kører…" : "✗ sidste FEJL"}
            </Badge>
          )}
        </div>

        {lastRun && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
            <div>
              <span className="text-muted-foreground">Sidst kørt:</span>{" "}
              {new Date(lastRun.started_at).toLocaleString("da-DK")}
            </div>
            {lastRun.product_count != null && (
              <div>
                <span className="text-muted-foreground">Produkter:</span> {lastRun.product_count.toLocaleString("da-DK")}
              </div>
            )}
            {lastRun.file_size_bytes != null && (
              <div>
                <span className="text-muted-foreground">Filstørrelse:</span>{" "}
                {(lastRun.file_size_bytes / 1024).toFixed(1)} KB
              </div>
            )}
            {lastRun.error && <div className="text-destructive">Fejl: {lastRun.error}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
