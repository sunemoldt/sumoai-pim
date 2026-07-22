import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Alert = {
  id: string;
  master_product_id: string;
  shopify_price: number;
  shopify_compare_at_price: number | null;
  cheapest_purchase_price: number;
  margin_pct: number;
  severity: "below_cost" | "low_margin" | "margin_blocked";
  details: any;
  resolved_at: string | null;
  created_at: string;
};

export default function PriceAlertsPage() {
  const qc = useQueryClient();

  const { data: alerts, isLoading, refetch } = useQuery({
    queryKey: ["price_alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as Alert[];
    },
  });

  const runScan = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("shopify-below-cost-scanner", {
        body: { trigger: "manual" },
      });
      if (error) throw error;
      return data as { scanned: number; alerts: number };
    },
    onSuccess: (res) => {
      toast.success(`Scannet ${res.scanned} produkter, ${res.alerts} nye alarmer`);
      qc.invalidateQueries({ queryKey: ["price_alerts"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Scan fejlede"),
  });

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("price_alerts")
        .update({ resolved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Alarm markeret som håndteret");
      qc.invalidateQueries({ queryKey: ["price_alerts"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Kunne ikke opdatere"),
  });

  const unresolved = alerts?.filter((a) => !a.resolved_at) ?? [];
  const resolved = alerts?.filter((a) => a.resolved_at) ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pris-alarmer</h1>
          <p className="text-sm text-muted-foreground">
            Daglig scanning af Shopify-priser mod billigste leverandør-indkøb.
          </p>
        </div>
        <Button onClick={() => runScan.mutate()} disabled={runScan.isPending}>
          {runScan.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Kør scan nu
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Aktive alarmer ({unresolved.length})
            </h2>
            {unresolved.length === 0 ? (
              <div className="rounded-md border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                Ingen aktive alarmer. Alle Shopify-priser er over indkøbspris.
              </div>
            ) : (
              <AlertsTable alerts={unresolved} onResolve={(id) => resolve.mutate(id)} />
            )}
          </section>

          {resolved.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-medium text-muted-foreground">
                Håndterede ({resolved.length})
              </h2>
              <AlertsTable alerts={resolved} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function AlertsTable({
  alerts,
  onResolve,
}: {
  alerts: Alert[];
  onResolve?: (id: string) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produkt</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Shopify-pris</TableHead>
            <TableHead className="text-right">Indkøb (ekskl. moms)</TableHead>
            <TableHead className="text-right">Margin</TableHead>
            <TableHead>Registreret</TableHead>
            {onResolve && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {alerts.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <Link
                  to={`/products/${a.master_product_id}`}
                  className="font-medium hover:underline"
                >
                  {a.details?.title ?? a.master_product_id}
                </Link>
                {a.details?.sku && (
                  <div className="text-xs text-muted-foreground">{a.details.sku}</div>
                )}
              </TableCell>
              <TableCell>
                {a.severity === "below_cost" ? (
                  <Badge variant="destructive">Under kost</Badge>
                ) : a.severity === "margin_blocked" ? (
                  <Badge variant="destructive">Salg stoppet (lav margin)</Badge>
                ) : (
                  <Badge variant="secondary">Lav margin</Badge>
                )}

              </TableCell>
              <TableCell className="text-right tabular-nums">
                {Number(a.shopify_price).toFixed(2)} kr
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {Number(a.cheapest_purchase_price).toFixed(2)} kr
              </TableCell>
              <TableCell
                className={`text-right tabular-nums font-medium ${
                  a.margin_pct < 0 ? "text-destructive" : ""
                }`}
              >
                {Number(a.margin_pct).toFixed(1)} %
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(a.created_at).toLocaleString("da-DK")}
              </TableCell>
              {onResolve && (
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onResolve(a.id)}
                    className="gap-2"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Marker håndteret
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
