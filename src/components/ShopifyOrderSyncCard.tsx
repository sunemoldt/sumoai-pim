import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShoppingCart } from "lucide-react";

type Config = {
  orders_cutoff_at: string | null;
  orders_webhook_id: string | null;
  registered_at: string | null;
};

export default function ShopifyOrderSyncCard() {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [stats, setStats] = useState({ day: 0, week: 0 });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("shopify_webhook_config")
      .select("orders_cutoff_at, orders_webhook_id, registered_at")
      .eq("id", 1)
      .maybeSingle();
    setCfg(data ?? null);

    const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const [d24, d7] = await Promise.all([
      supabase.from("shopify_processed_orders").select("order_id", { count: "exact", head: true }).gte("processed_at", since24),
      supabase.from("shopify_processed_orders").select("order_id", { count: "exact", head: true }).gte("processed_at", since7d),
    ]);
    setStats({ day: d24.count ?? 0, week: d7.count ?? 0 });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const activate = async () => {
    setActivating(true);
    const { data, error } = await supabase.functions.invoke("shopify-register-webhook");
    setActivating(false);
    if (error || (data as { error?: string })?.error) {
      toast({ title: "Fejl", description: error?.message ?? (data as { error?: string })?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Salgs-modregning aktiveret", description: "Kun ordrer fra nu og frem modregnes i PIM-lager." });
    load();
  };

  const isActive = Boolean(cfg?.orders_cutoff_at && cfg?.orders_webhook_id);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          Salgs-modregning fra Shopify
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Når aktiveret modtager PIM webhook fra Shopify hver gang en ordre oprettes, og trækker antallet fra <code>stock_quantity</code> på produkter med eget lager (ikke leverandør-styrede).
          <br />
          <strong>Kun fremtidige ordrer modregnes.</strong> Ordrer oprettet før aktiverings-tidspunktet røres ikke.
        </p>

        <div className="flex items-center gap-3">
          <Badge variant={isActive ? "default" : "secondary"}>
            {isActive ? "Aktiv" : "Ikke aktiveret"}
          </Badge>
          {cfg?.orders_cutoff_at && (
            <span className="text-xs text-muted-foreground">
              Modregner ordrer fra: {new Date(cfg.orders_cutoff_at).toLocaleString("da-DK")}
            </span>
          )}
        </div>

        {isActive && (
          <div className="text-sm grid grid-cols-2 gap-4">
            <div>
              <div className="text-muted-foreground text-xs">Sidste 24 timer</div>
              <div className="text-xl font-semibold">{stats.day}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Sidste 7 dage</div>
              <div className="text-xl font-semibold">{stats.week}</div>
            </div>
          </div>
        )}

        <Button onClick={activate} disabled={activating || loading} variant={isActive ? "outline" : "default"}>
          {activating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isActive ? "Gen-registrer webhook" : "Aktivér modregning fra nu"}
        </Button>
      </CardContent>
    </Card>
  );
}
