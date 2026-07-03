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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tilbud</h1>
          <p className="text-sm text-muted-foreground mt-1">Opret tilbud og send dem som kladdefaktura til Dinero</p>
        </div>
        <Button onClick={() => navigate("/quotes/new")}>
          <Plus className="h-4 w-4 mr-1" /> Nyt tilbud
        </Button>
      </div>

      <Card>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Indlæser…</TableCell></TableRow>
              ) : quotes.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Ingen tilbud endnu</TableCell></TableRow>
              ) : quotes.map((q) => (
                <TableRow key={q.id} className="cursor-pointer" onClick={() => navigate(`/quotes/${q.id}`)}>
                  <TableCell className="font-medium">#{q.quote_number}</TableCell>
                  <TableCell>{q.customer_name || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{q.quote_date ? format(new Date(q.quote_date), "dd-MM-yyyy") : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{q.line_count}</TableCell>
                  <TableCell className="text-right font-mono">{(Number(q.total_excl_vat || 0) * 1.25).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.</TableCell>
                  <TableCell>
                    {q.status === "approved" ? (
                      <Badge variant="outline" className="text-green-700 border-green-400 bg-green-50">Godkendt</Badge>
                    ) : q.status === "rejected" ? (
                      <Badge variant="outline" className="text-destructive border-destructive/40">Afvist</Badge>
                    ) : q.status === "sent" ? (
                      <Badge variant="outline" className="text-green-600 border-green-300">Sendt til Dinero</Badge>
                    ) : (
                      <Badge variant="secondary">Kladde</Badge>
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
