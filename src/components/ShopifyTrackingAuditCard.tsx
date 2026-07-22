import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Wrench, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Untracked = {
  variant_id: string;
  inventory_item_id: string;
  sku: string | null;
  product_id: string;
  product_title: string;
  status: string;
};

type AuditResult = {
  ok: boolean;
  mode: "audit" | "fix";
  total_variants: number;
  untracked_count: number;
  fixed: number;
  errors: { variant_id: string; message: string }[];
  untracked: Untracked[];
};

export default function ShopifyTrackingAuditCard() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);

  async function run(mode: "audit" | "fix") {
    if (mode === "fix") setFixing(true);
    else setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-tracking-audit", {
        body: { mode },
      });
      if (error) throw error;
      setResult(data as AuditResult);
      if (mode === "audit") {
        toast.success(`Scannet ${(data as AuditResult).total_variants} varianter — ${(data as AuditResult).untracked_count} uden tracking`);
      } else {
        toast.success(`Aktiveret tracking på ${(data as AuditResult).fixed} varianter`);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Fejl");
    } finally {
      setLoading(false);
      setFixing(false);
    }
  }

  return (
    <Card>
      <CardHeader
        className="cursor-pointer flex-row items-center justify-between gap-3 space-y-0"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <CardTitle className="text-base">Shopify lagerstyring — audit</CardTitle>
          {result && result.untracked_count > 0 && (
            <Badge variant="destructive">{result.untracked_count} uden tracking</Badge>
          )}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Finder Shopify-varianter hvor <code>inventoryItem.tracked</code> er slået fra.
            Uden tracking ignorerer Shopify det lager PIM sender, og produktet kan oversælges.
            Klik "Aktivér tracking" for at slå det til på alle fundne varianter og gen-synke PIM-lager.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => run("audit")} disabled={loading || fixing}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Kør audit
            </Button>
            <Button
              size="sm"
              onClick={() => run("fix")}
              disabled={loading || fixing || !result || result.untracked_count === 0}
            >
              {fixing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wrench className="h-4 w-4 mr-2" />}
              Aktivér tracking på {result?.untracked_count ?? 0}
            </Button>
          </div>

          {result && (
            <div className="rounded-md border border-border bg-card p-3 text-sm space-y-2">
              <div>Total varianter scannet: <strong>{result.total_variants}</strong></div>
              <div>Uden tracking: <strong>{result.untracked_count}</strong></div>
              {result.mode === "fix" && (
                <>
                  <div>Rettet: <strong>{result.fixed}</strong></div>
                  {result.errors.length > 0 && (
                    <div className="text-destructive flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Fejl: {result.errors.length}
                    </div>
                  )}
                </>
              )}
              {result.untracked.length > 0 && (
                <div className="mt-2 max-h-72 overflow-auto border-t border-border pt-2 space-y-1">
                  {result.untracked.slice(0, 200).map((u) => (
                    <div key={u.variant_id} className="text-xs flex items-center justify-between gap-3">
                      <span className="truncate">{u.product_title}</span>
                      <span className="text-muted-foreground shrink-0">{u.sku ?? u.variant_id}</span>
                    </div>
                  ))}
                  {result.untracked.length > 200 && (
                    <div className="text-xs text-muted-foreground">…og {result.untracked.length - 200} flere</div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
