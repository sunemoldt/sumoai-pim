import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

const VAT = 0.25;
const fmt = (n: number) => n.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SalesDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();

  const { data: order, isLoading } = useQuery({
    queryKey: ["sales-order", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shopify_processed_orders")
        .select("*")
        .eq("order_id", Number(orderId))
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!order) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/sales")}><ArrowLeft className="h-4 w-4 mr-1" /> Tilbage</Button>
        <Card><CardContent className="py-10 text-center text-muted-foreground">Ordre ikke fundet</CardContent></Card>
      </div>
    );
  }

  const raw: any = order.raw ?? {};
  const lines: any[] = Array.isArray(raw.line_results) ? raw.line_results : [];
  const customer = raw.customer;
  const customerName = customer ? [customer.first_name, customer.last_name].filter(Boolean).join(" ") || customer.email : null;

  const subtotalPrice = Number(raw.subtotal_price ?? 0);
  const revenueExVat = subtotalPrice > 0
    ? subtotalPrice / (1 + VAT)
    : lines.reduce((s, l) => s + Number(l.line_total ?? 0), 0) / (1 + VAT);
  const purchase = lines.reduce((s, l) => {
    const pp = Number(l.purchase_price); const qty = Number(l.quantity ?? 0);
    return Number.isFinite(pp) && pp > 0 ? s + pp * qty : s;
  }, 0);
  const marginKr = revenueExVat - purchase;
  const marginPct = revenueExVat > 0 ? (marginKr / revenueExVat) * 100 : 0;
  const missingCost = lines.some((l) => !(Number(l.purchase_price) > 0));

  const marginColor = marginPct < 10 ? "text-destructive" : marginPct < 20 ? "text-yellow-600" : "text-green-600";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/sales")} className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-semibold truncate">
              {order.shopify_order_number || `Ordre #${order.order_id}`}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {format(new Date(order.processed_at), "dd-MM-yyyy HH:mm")}
              {customerName && ` · ${customerName}`}
            </p>
          </div>
        </div>
        {raw.order_status_url && (
          <Button variant="outline" size="sm" asChild>
            <a href={raw.order_status_url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4 mr-1" /> Åbn i Shopify
            </a>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Omsætning ex. moms</div>
          <div className="text-lg font-semibold font-mono mt-1">{fmt(revenueExVat)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Indkøb</div>
          <div className="text-lg font-semibold font-mono mt-1">{missingCost ? "—" : fmt(purchase)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">DB kr.</div>
          <div className={`text-lg font-semibold font-mono mt-1 ${marginColor}`}>{missingCost ? "—" : fmt(marginKr)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">DB %</div>
          <div className={`text-lg font-semibold font-mono mt-1 ${marginColor}`}>{missingCost ? "—" : `${marginPct.toFixed(1)}%`}</div>
        </CardContent></Card>
      </div>

      {missingCost && (
        <p className="text-xs text-muted-foreground italic">
          Indkøbspris er ikke registreret for alle linjer (fx ældre ordrer eller varer uden valgt leverandør). Totaler kan derfor være ufuldstændige.
        </p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Linjer</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-border">
            {lines.length === 0 ? (
              <div className="text-center text-muted-foreground py-8 text-sm">Ingen linjer</div>
            ) : lines.map((l, i) => {
              const qty = Number(l.quantity ?? 0);
              const lineTotal = Number(l.line_total ?? 0);
              const lineTotalEx = lineTotal / (1 + VAT);
              const pp = Number(l.purchase_price);
              const hasPP = Number.isFinite(pp) && pp > 0;
              const lineMarginKr = hasPP ? lineTotalEx - pp * qty : null;
              const lineMarginPct = hasPP && lineTotalEx > 0 ? (lineMarginKr! / lineTotalEx) * 100 : null;
              return (
                <div key={i} className="p-3 space-y-1">
                  <div className="flex items-start gap-2">
                    {l.product_image && <img src={l.product_image} alt="" className="h-10 w-10 rounded object-cover shrink-0" />}
                    <div className="flex-1 min-w-0">
                      {l.product_id ? (
                        <Link to={`/products/${l.product_id}`} className="text-sm font-medium hover:underline line-clamp-2">
                          {l.product_title || l.title}
                        </Link>
                      ) : (
                        <div className="text-sm font-medium line-clamp-2">{l.title}</div>
                      )}
                      {l.variant_title && <div className="text-xs text-muted-foreground">{l.variant_title}</div>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1">
                    <div>Antal: {qty}</div>
                    <div className="text-right">Linje: {fmt(lineTotalEx)}</div>
                    <div>Indkøb/stk: {hasPP ? fmt(pp) : "—"}</div>
                    <div className={`text-right ${lineMarginPct == null ? "" : lineMarginPct < 10 ? "text-destructive" : lineMarginPct < 20 ? "text-yellow-600" : "text-green-600"}`}>
                      {lineMarginPct == null ? "—" : `${lineMarginPct.toFixed(1)}%`}
                    </div>
                  </div>
                  {l.skipped && <Badge variant="outline" className="text-yellow-700 border-yellow-300">Sprunget over: {l.skipped}</Badge>}
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/50">
                  <TableHead>Produkt</TableHead>
                  <TableHead className="text-right">Antal</TableHead>
                  <TableHead className="text-right">Salg/stk ex.</TableHead>
                  <TableHead className="text-right">Linje ex.</TableHead>
                  <TableHead className="text-right">Indkøb/stk</TableHead>
                  <TableHead className="text-right">DB kr.</TableHead>
                  <TableHead className="text-right">DB %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => {
                  const qty = Number(l.quantity ?? 0);
                  const lineTotal = Number(l.line_total ?? 0);
                  const lineTotalEx = lineTotal / (1 + VAT);
                  const unitEx = qty > 0 ? lineTotalEx / qty : 0;
                  const pp = Number(l.purchase_price);
                  const hasPP = Number.isFinite(pp) && pp > 0;
                  const lineMarginKr = hasPP ? lineTotalEx - pp * qty : null;
                  const lineMarginPct = hasPP && lineTotalEx > 0 ? (lineMarginKr! / lineTotalEx) * 100 : null;
                  const cls = lineMarginPct == null ? "" : lineMarginPct < 10 ? "text-destructive" : lineMarginPct < 20 ? "text-yellow-600" : "text-green-600";
                  return (
                    <TableRow key={i}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {l.product_image && <img src={l.product_image} alt="" className="h-8 w-8 rounded object-cover" />}
                          <div className="min-w-0">
                            {l.product_id ? (
                              <Link to={`/products/${l.product_id}`} className="font-medium hover:underline">
                                {l.product_title || l.title}
                              </Link>
                            ) : (
                              <span className="font-medium">{l.title}</span>
                            )}
                            {l.variant_title && <div className="text-xs text-muted-foreground">{l.variant_title}</div>}
                            {l.skipped && <div className="text-xs text-yellow-700">Sprunget over: {l.skipped}</div>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">{qty}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(unitEx)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(lineTotalEx)}</TableCell>
                      <TableCell className="text-right font-mono">{hasPP ? fmt(pp) : "—"}</TableCell>
                      <TableCell className={`text-right font-mono ${cls}`}>{lineMarginKr == null ? "—" : fmt(lineMarginKr)}</TableCell>
                      <TableCell className={`text-right font-mono ${cls}`}>{lineMarginPct == null ? "—" : `${lineMarginPct.toFixed(1)}%`}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Indkøbspris er den billigste leverandørpris registreret på salgstidspunktet (nye ordrer) eller pr. i dag (ordrer før opdateringen).
      </p>
    </div>
  );
}
