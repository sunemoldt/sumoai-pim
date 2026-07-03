import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export function ShopifyShortDescBackfillCard() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [scope, setScope] = useState<"recent" | "all">("recent");

  const run = async () => {
    setRunning(true);
    try {
      let query = supabase
        .from("master_products")
        .select("id, short_description, meta_title, meta_description, created_at")
        .not("shopify_product_id", "is", null)
        .eq("shopify_sync_enabled", true);

      if (scope === "recent") {
        const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
        query = query.gte("created_at", cutoff);
      }

      const { data, error } = await query;
      if (error) throw error;

      const eligible = (data ?? []).filter(
        (p) => p.short_description || p.meta_title || p.meta_description,
      );

      if (eligible.length === 0) {
        toast({ title: "Ingen produkter at genskubbe" });
        return;
      }

      const rows = eligible.map((p) => {
        const changed: string[] = [];
        const payload: Record<string, unknown> = { reason: "short-desc-backfill" };
        if (p.short_description) {
          changed.push("short_description");
          payload.short_description = p.short_description;
        }
        if (p.meta_title) {
          changed.push("meta_title");
          payload.meta_title = p.meta_title;
        }
        if (p.meta_description) {
          changed.push("meta_description");
          payload.meta_description = p.meta_description;
        }
        payload.changed_fields = changed;
        return {
          master_product_id: p.id,
          payload,
          source: "short-desc-backfill",
          status: "pending" as const,
          next_attempt_at: new Date().toISOString(),
        };
      });

      // Chunk insert to avoid payload size issues
      const chunkSize = 200;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error: insErr } = await supabase.from("shopify_update_queue").insert(chunk as any);
        if (insErr) throw insErr;
        inserted += chunk.length;
      }

      toast({
        title: "Backfill queued",
        description: `${inserted} produkter er lagt i Shopify-køen. De skubbes løbende af worker.`,
      });
    } catch (e) {
      toast({
        title: "Backfill fejlede",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Genskub kort beskrivelse + SEO til Shopify</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ved oprettelse tidligere kom kort beskrivelse (metafelt <code>custom.short_description</code>) og SEO-felter ikke altid med til Shopify.
          Denne handling queuer alle relevante produkter til at få skubbet felterne igen.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={scope}
            onChange={(e) => setScope(e.target.value as "recent" | "all")}
            disabled={running}
          >
            <option value="recent">Sidste 30 dage</option>
            <option value="all">Alle Shopify-produkter</option>
          </select>
          <Button onClick={run} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Kør backfill
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
