import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Loader2, Rocket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Result = { id: string; title: string; ok: boolean; message: string };

export default function WoocommerceForcePushCard() {
  const [since, setSince] = useState<string>("");
  const [forceSku, setForceSku] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [results, setResults] = useState<Result[]>([]);

  const { toast } = useToast();

  const start = async () => {
    if (!confirm(
      "Force push: dette skubber EAN, pris, salgspris, lager og lagerstatus fra PIM ud til WooCommerce for ALLE matchende produkter. Fortsæt?"
    )) return;

    setRunning(true);
    setResults([]);
    setDone(0);

    let q = supabase
      .from("master_products")
      .select("id, title, ean")
      .eq("webshop_platform", "woocommerce")
      .not("webshop_product_id", "is", null);
    if (since) q = q.gte("updated_at", new Date(since).toISOString());

    const { data: products, error } = await q;
    if (error || !products) {
      setRunning(false);
      toast({ title: "Kunne ikke hente produkter", description: error?.message, variant: "destructive" });
      return;
    }
    setTotal(products.length);
    if (products.length === 0) {
      toast({ title: "Ingen WooCommerce-produkter at pushe" });
      setRunning(false);
      return;
    }

    const concurrency = 3;
    let i = 0;
    const localResults: Result[] = [];

    const runOne = async (p: { id: string; title: string; ean: string | null }) => {
      try {
        const { data, error } = await supabase.functions.invoke("wc-update-product", {
          body: {
            master_product_id: p.id,
            use_db_values: true,
            force_sku: forceSku,
          },
        });
        if (error) return { id: p.id, title: p.title, ok: false, message: error.message };
        if (data?.error) return { id: p.id, title: p.title, ok: false, message: String(data.error) };
        if (data?.skipped) return { id: p.id, title: p.title, ok: false, message: data.error || "skipped" };
        const fields = data?.updated_fields ?? [];
        return { id: p.id, title: p.title, ok: true, message: `${fields.length} felter` };
      } catch (e: any) {
        return { id: p.id, title: p.title, ok: false, message: e?.message || "fejl" };
      }
    };

    const workers = Array.from({ length: concurrency }).map(async () => {
      while (i < products.length) {
        const idx = i++;
        const r = await runOne(products[idx] as any);
        localResults.push(r);
        setDone((d) => d + 1);
        setResults((prev) => [...prev, r]);
      }
    });
    await Promise.all(workers);

    setRunning(false);
    const okCount = localResults.filter((r) => r.ok).length;
    const failCount = localResults.length - okCount;
    toast({
      title: "Force push færdig",
      description: `${okCount} OK, ${failCount} fejlede af ${products.length} produkter.`,
      variant: failCount > 0 ? "destructive" : "default",
    });
  };

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const failed = results.filter((r) => !r.ok);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="h-5 w-5" /> Force push til WooCommerce
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Skubber EAN (<code>_avecdo_ean</code> meta), pris, salgspris, lager og lagerstatus fra PIM ud til WooCommerce.
          Bruges efter du har rettet forkerte EAN-numre eller priser i PIM.
          Kører kun hvis WooCommerce-sync er aktiv.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="since">Kun produkter ændret efter (valgfrit)</Label>
            <Input
              id="since"
              type="datetime-local"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              disabled={running}
            />
          </div>
          <div className="flex items-end gap-2">
            <Checkbox
              id="force-sku"
              checked={forceSku}
              onCheckedChange={(v) => setForceSku(!!v)}
              disabled={running}
            />
            <Label htmlFor="force-sku" className="font-normal cursor-pointer">
              Overskriv også WooCommerce <code>sku</code> med EAN
            </Label>
          </div>
        </div>

        <Button onClick={start} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Rocket className="h-4 w-4 mr-2" />}
          {running ? `Pusher… ${done}/${total}` : "Start force push"}
        </Button>

        {(running || total > 0) && (
          <div className="space-y-2">
            <Progress value={pct} />
            <p className="text-xs text-muted-foreground">{done} / {total} ({pct}%)</p>
          </div>
        )}

        {failed.length > 0 && (
          <div className="border rounded-md p-3 max-h-64 overflow-auto bg-muted/40">
            <p className="text-sm font-medium mb-2">{failed.length} fejlede:</p>
            <ul className="text-xs space-y-1">
              {failed.map((r) => (
                <li key={r.id}>
                  <span className="font-medium">{r.title}</span>: {r.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
