import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Plus, Copy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type QuoteRow = {
  id: string;
  quote_number: number;
  quote_date: string;
  customer_name: string;
  status: string;
  total_excl_vat: number;
  line_count: number;
};

export default function QuoteListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["quotes-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes" as any)
        .select("id, quote_number, quote_date, customer_name, status, total_excl_vat, quote_lines(count)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as any[]).map((q) => ({
        ...q,
        line_count: q.quote_lines?.[0]?.count ?? 0,
      })) as QuoteRow[];
    },
  });

  const handleDuplicate = async (quoteId: string) => {
    try {
      const { data: original, error: qErr } = await supabase
        .from("quotes" as any)
        .select("customer_name, valid_days, dinero_contact_guid, note_customer, note_internal, total_excl_vat, total_purchase_price, package_price")
        .eq("id", quoteId)
        .single();
      if (qErr) throw qErr;

      const { data: lines, error: lErr } = await supabase
        .from("quote_lines" as any)
        .select("pim_product_id, product_name, quantity, purchase_price, list_price, quote_price, sort_order")
        .eq("quote_id", quoteId);
      if (lErr) throw lErr;

      const { data: maxRow } = await supabase
        .from("quotes" as any)
        .select("quote_number")
        .order("quote_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextNumber = ((maxRow as any)?.quote_number ?? 0) + 1;

      const { data: inserted, error: iErr } = await supabase
        .from("quotes" as any)
        .insert({
          ...(original as any),
          quote_number: nextNumber,
          quote_date: new Date().toISOString().slice(0, 10),
          status: "draft",
          dinero_voucher_guid: null,
        })
        .select("id")
        .single();
      if (iErr) throw iErr;

      const newId = (inserted as any).id as string;

      if (lines && lines.length > 0) {
        const { error: lineErr } = await supabase
          .from("quote_lines" as any)
          .insert((lines as any[]).map((l) => ({ ...l, quote_id: newId })));
        if (lineErr) throw lineErr;
      }

      toast.success("Tilbud kopieret");
      queryClient.invalidateQueries({ queryKey: ["quotes-list"] });
      navigate(`/quotes/${newId}`);
    } catch (err: any) {
      toast.error("Kunne ikke kopiere tilbud", { description: err?.message });
    }
  };


  const statusBadge = (status: string) => {
    if (status === "approved") return <Badge variant="outline" className="text-green-700 border-green-400 bg-green-50">Godkendt</Badge>;
    if (status === "rejected") return <Badge variant="outline" className="text-destructive border-destructive/40">Afvist</Badge>;
    if (status === "sent") return <Badge variant="outline" className="text-green-600 border-green-300">Sendt til Dinero</Badge>;
    return <Badge variant="secondary">Kladde</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tilbud</h1>
          <p className="text-sm text-muted-foreground mt-1">Opret tilbud og send dem som kladdefaktura til Dinero</p>
        </div>
        <Button className="w-full sm:w-auto" onClick={() => navigate("/quotes/new")}>
          <Plus className="h-4 w-4 mr-1" /> Nyt tilbud
        </Button>
      </div>

      {/* Mobile card list */}
      <div className="space-y-2 md:hidden">
        {isLoading ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">Indlæser…</CardContent></Card>
        ) : quotes.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">Ingen tilbud endnu</CardContent></Card>
        ) : quotes.map((q) => (
          <Card key={q.id} className="cursor-pointer active:bg-accent/30" onClick={() => navigate(`/quotes/${q.id}`)}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">#{q.quote_number}</span>
                {statusBadge(q.status)}
              </div>
              <div className="text-sm">{q.customer_name || <span className="text-muted-foreground">Uden kunde</span>}</div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{q.quote_date ? format(new Date(q.quote_date), "dd-MM-yyyy") : "—"} · {q.line_count} linje{q.line_count === 1 ? "" : "r"}</span>
                <span className="font-mono text-foreground">{(Number(q.total_excl_vat || 0) * 1.25).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.</span>
              </div>
              <div className="pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={(e) => { e.stopPropagation(); handleDuplicate(q.id); }}
                >
                  <Copy className="h-3.5 w-3.5 mr-1" /> Dupliker
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop table */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50">
                <TableHead>Tilbudsnr.</TableHead>
                <TableHead>Kunde</TableHead>
                <TableHead>Dato</TableHead>
                <TableHead className="text-right">Linjer</TableHead>
                <TableHead className="text-right">Total inkl. moms</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right w-20">Handling</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Indlæser…</TableCell></TableRow>
              ) : quotes.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Ingen tilbud endnu</TableCell></TableRow>
              ) : quotes.map((q) => (
                <TableRow key={q.id} className="cursor-pointer" onClick={() => navigate(`/quotes/${q.id}`)}>
                  <TableCell className="font-medium">#{q.quote_number}</TableCell>
                  <TableCell>{q.customer_name || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{q.quote_date ? format(new Date(q.quote_date), "dd-MM-yyyy") : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{q.line_count}</TableCell>
                  <TableCell className="text-right font-mono">{(Number(q.total_excl_vat || 0) * 1.25).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.</TableCell>
                  <TableCell>{statusBadge(q.status)}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); handleDuplicate(q.id); }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Dupliker</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
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
