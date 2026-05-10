import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, PlayCircle, Trash2, ListOrdered } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { da } from "date-fns/locale";

type QueueRow = {
  id: string;
  master_product_id: string;
  status: "pending" | "processing" | "done" | "failed";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  source: string | null;
  created_at: string;
  completed_at: string | null;
};

const statusBadge = (s: string) => {
  if (s === "pending") return <Badge variant="outline">Venter</Badge>;
  if (s === "processing") return <Badge className="bg-blue-500/15 text-blue-700">Kører</Badge>;
  if (s === "done") return <Badge className="bg-emerald-500/15 text-emerald-700">Færdig</Badge>;
  if (s === "failed") return <Badge variant="destructive">Fejlet</Badge>;
  return <Badge variant="outline">{s}</Badge>;
};

export default function ShopifyQueueCard() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("shopify_update_queue")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setRows((data ?? []) as QueueRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("shopify_queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "shopify_update_queue" }, () => load())
      .subscribe();
    const interval = setInterval(load, 15000);
    return () => { supabase.removeChannel(ch); clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runNow = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("shopify-queue-worker", { body: {} });
    setRunning(false);
    if (error) {
      toast({ title: "Worker fejlede", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as { processed?: number; succeeded?: number; requeued?: number; failed?: number };
    toast({ title: "Worker kørt", description: `Processeret ${r.processed ?? 0} (ok ${r.succeeded ?? 0}, gen-køet ${r.requeued ?? 0}, fejl ${r.failed ?? 0})` });
    load();
  };

  const clearDone = async () => {
    if (!confirm("Slet alle færdige/fejlede opgaver fra køen?")) return;
    await supabase.from("shopify_update_queue").delete().in("status", ["done", "failed"]);
    load();
  };

  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.status === "pending").length,
    processing: rows.filter((r) => r.status === "processing").length,
    done: rows.filter((r) => r.status === "done").length,
    failed: rows.filter((r) => r.status === "failed").length,
  }), [rows]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListOrdered className="h-5 w-5" />
          Shopify-opdaterings-kø
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Når Shopify svarer med rate limit, lægges opdateringen i kø. En baggrundsworker prøver automatisk igen hvert minut med eksponentiel backoff (60s → 30 min).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div className="rounded-md border p-2"><div className="text-muted-foreground">Venter</div><div className="font-semibold">{counts.pending}</div></div>
          <div className="rounded-md border p-2"><div className="text-muted-foreground">Kører</div><div className="font-semibold text-blue-600">{counts.processing}</div></div>
          <div className="rounded-md border p-2"><div className="text-muted-foreground">Færdige</div><div className="font-semibold text-emerald-600">{counts.done}</div></div>
          <div className="rounded-md border p-2"><div className="text-muted-foreground">Fejlede</div><div className={`font-semibold ${counts.failed ? "text-destructive" : ""}`}>{counts.failed}</div></div>
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={runNow} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
            Kør worker nu
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" /> Opdatér
          </Button>
          <Button size="sm" variant="ghost" onClick={clearDone} className="ml-auto">
            <Trash2 className="h-4 w-4 mr-2" /> Ryd færdige/fejlede
          </Button>
        </div>

        <div className="rounded-md border overflow-hidden max-h-[420px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Status</TableHead>
                <TableHead>Produkt-ID</TableHead>
                <TableHead className="w-20">Forsøg</TableHead>
                <TableHead className="w-44">Næste forsøg</TableHead>
                <TableHead>Sidste fejl</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.master_product_id.slice(0, 8)}…</TableCell>
                  <TableCell className="text-sm">{r.attempts}/{r.max_attempts}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.status === "done" || r.status === "failed"
                      ? "—"
                      : formatDistanceToNow(new Date(r.next_attempt_at), { addSuffix: true, locale: da })}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md truncate">{r.last_error ?? "—"}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6 text-sm">
                    Køen er tom.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
