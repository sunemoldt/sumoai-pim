import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";


type OrderRow = {
  order_id: number;
  shopify_order_number: string | null;
  processed_at: string;
  line_count: number;
  total_decremented: number;
  skipped_reason: string | null;
  raw: any;
};

const VAT = 0.25;
const fmt = (n: number) => n.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function computeTotals(raw: any) {
  const lines = Array.isArray(raw?.line_results) ? raw.line_results : [];
  // Prefer Shopify subtotal when present (already excludes shipping) and remove VAT.
  const subtotalPrice = Number(raw?.subtotal_price ?? 0);
  let revenueExVat = 0;
  if (subtotalPrice > 0) {
    revenueExVat = subtotalPrice / (1 + VAT);
  } else {
    revenueExVat = lines.reduce((s: number, l: any) => s + Number(l.line_total ?? 0), 0) / (1 + VAT);
  }
  const purchase = lines.reduce((s: number, l: any) => {
    const pp = Number(l.purchase_price);
    const qty = Number(l.quantity ?? 0);
    return Number.isFinite(pp) && pp > 0 ? s + pp * qty : s;
  }, 0);
  const marginKr = revenueExVat - purchase;
  const marginPct = revenueExVat > 0 ? (marginKr / revenueExVat) * 100 : 0;
  const missingCost = lines.some((l: any) => !(Number(l.purchase_price) > 0));
  return { revenueExVat, purchase, marginKr, marginPct, missingCost };
}

export default function SalesListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [enriching, setEnriching] = useState(false);
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["sales-orders-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shopify_processed_orders")
        .select("order_id, shopify_order_number, processed_at, line_count, total_decremented, skipped_reason, raw")
        .order("processed_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
  });

  const rows = useMemo(() =>
    orders.map((o) => ({ ...o, totals: computeTotals(o.raw) })),
    [orders],
  );

  const marginColor = (pct: number) =>
    pct < 10 ? "text-destructive" : pct < 20 ? "text-yellow-600" : "text-green-600";

  const enrichAll = async () => {
    setEnriching(true);
    try {
      const { data, error } = await supabase.functions.invoke("sales-enrich-order", {
        body: { missing_only: true, limit: 100 },
      });
      if (error) throw error;
      const enriched = data?.enriched ?? 0;
      toast.success(`${enriched} ordre${enriched === 1 ? "" : "r"} beriget fra Shopify`);
      qc.invalidateQueries({ queryKey: ["sales-orders-list"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke berige ordrer");
    } finally {
      setEnriching(false);
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Salg</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ordrer fra Shopify med omsætning, indkøb og dækningsbidrag
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={enrichAll} disabled={enriching}>
          {enriching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Berig manglende fra Shopify
        </Button>
      </div>


      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {isLoading ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">Indlæser…</CardContent></Card>
        ) : rows.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">Ingen ordrer endnu</CardContent></Card>
        ) : rows.map((o) => (
          <Card key={o.order_id} className="cursor-pointer active:bg-accent/30" onClick={() => navigate(`/sales/${o.order_id}`)}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{o.shopify_order_number || `#${o.order_id}`}</span>
                <span className="text-xs text-muted-foreground shrink-0">{format(new Date(o.processed_at), "dd-MM-yyyy HH:mm")}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                <div>
                  <div className="text-muted-foreground">Oms.</div>
                  <div>{fmt(o.totals.revenueExVat)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Indkøb</div>
                  <div>{o.totals.missingCost ? "—" : fmt(o.totals.purchase)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">DB</div>
                  <div className={marginColor(o.totals.marginPct)}>
                    {o.totals.missingCost ? "—" : `${o.totals.marginPct.toFixed(1)}%`}
                  </div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">{o.line_count} linje{o.line_count === 1 ? "" : "r"}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop table */}
      <Card className="hidden md:block">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50">
                <TableHead>Ordre</TableHead>
                <TableHead>Dato</TableHead>
                <TableHead className="text-right">Linjer</TableHead>
                <TableHead className="text-right">Omsætning ex. moms</TableHead>
                <TableHead className="text-right">Indkøb</TableHead>
                <TableHead className="text-right">DB kr.</TableHead>
                <TableHead className="text-right">DB %</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Indlæser…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Ingen ordrer endnu</TableCell></TableRow>
              ) : rows.map((o) => (
                <TableRow key={o.order_id} className="cursor-pointer" onClick={() => navigate(`/sales/${o.order_id}`)}>
                  <TableCell className="font-medium">{o.shopify_order_number || `#${o.order_id}`}</TableCell>
                  <TableCell>{format(new Date(o.processed_at), "dd-MM-yyyy HH:mm")}</TableCell>
                  <TableCell className="text-right font-mono">{o.line_count}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(o.totals.revenueExVat)}</TableCell>
                  <TableCell className="text-right font-mono">{o.totals.missingCost ? "—" : fmt(o.totals.purchase)}</TableCell>
                  <TableCell className="text-right font-mono">{o.totals.missingCost ? "—" : fmt(o.totals.marginKr)}</TableCell>
                  <TableCell className={`text-right font-mono ${marginColor(o.totals.marginPct)}`}>
                    {o.totals.missingCost ? "—" : `${o.totals.marginPct.toFixed(1)}%`}
                  </TableCell>
                  <TableCell>
                    {o.skipped_reason ? (
                      <Badge variant="outline" className="text-yellow-700 border-yellow-300">{o.skipped_reason}</Badge>
                    ) : o.totals.missingCost ? (
                      <Badge variant="outline" className="text-muted-foreground">Manglende indkøbspris</Badge>
                    ) : (
                      <Badge variant="secondary">OK</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
