import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { da } from "date-fns/locale";
import { toast } from "sonner";

interface FailedJob {
  id: string;
  master_product_id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  source: string | null;
  updated_at: string;
  product_title?: string;
}

interface Props {
  queueThroughput: { bucket: string; count: number }[];
}

export function QueueDetailsCard({ queueThroughput }: Props) {
  const [failed, setFailed] = useState<FailedJob[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("shopify_update_queue")
      .select("id, master_product_id, status, attempts, max_attempts, last_error, source, updated_at")
      .eq("status", "failed")
      .order("updated_at", { ascending: false })
      .limit(10);
    if (data) {
      const ids = [...new Set(data.map((r) => r.master_product_id))];
      const { data: mps } = ids.length
        ? await supabase.from("master_products").select("id, title").in("id", ids)
        : { data: [] as { id: string; title: string }[] };
      const titleMap = new Map<string, string>();
      for (const m of mps ?? []) titleMap.set(m.id, m.title);
      setFailed(data.map((r) => ({ ...r, product_title: titleMap.get(r.master_product_id) })));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const wakeWorker = async () => {
    setWaking(true);
    try {
      const { error } = await supabase.functions.invoke("shopify-queue-worker", { body: {} });
      if (error) throw error;
      toast.success("Worker startet");
      setTimeout(load, 1500);
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke starte worker");
    } finally {
      setWaking(false);
    }
  };

  const retry = async (id: string) => {
    const { error } = await supabase
      .from("shopify_update_queue")
      .update({ status: "pending", attempts: 0, next_attempt_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Sat i kø igen");
      load();
    }
  };

  const maxThroughput = Math.max(1, ...queueThroughput.map((b) => b.count));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="flex-1">
          <div className="text-xs text-muted-foreground mb-1">Behandlede jobs / 10 min (sidste 6 timer)</div>
          <div className="flex items-end gap-0.5 h-16">
            {queueThroughput.length === 0 ? (
              <div className="text-xs text-muted-foreground self-center">Ingen aktivitet</div>
            ) : (
              queueThroughput.map((b) => (
                <div
                  key={b.bucket}
                  title={`${new Date(b.bucket).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}: ${b.count}`}
                  className="flex-1 bg-primary/60 hover:bg-primary rounded-t min-w-[3px]"
                  style={{ height: `${(b.count / maxThroughput) * 100}%` }}
                />
              ))
            )}
          </div>
        </div>
        <Button onClick={wakeWorker} disabled={waking} size="sm" variant="outline">
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${waking ? "animate-spin" : ""}`} />
          Start worker
        </Button>
      </div>

      {failed.length > 0 && (
        <div>
          <div className="flex items-center gap-2 text-sm font-medium mb-2 text-destructive">
            <AlertCircle className="h-4 w-4" /> Fejlede jobs ({failed.length})
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Produkt</TableHead>
                <TableHead>Kilde</TableHead>
                <TableHead>Forsøg</TableHead>
                <TableHead>Tidspunkt</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failed.map((f) => (
                <>
                  <TableRow key={f.id} className="cursor-pointer" onClick={() => setExpanded(expanded === f.id ? null : f.id)}>
                    <TableCell>{expanded === f.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</TableCell>
                    <TableCell className="max-w-[280px] truncate">{f.product_title ?? f.master_product_id.slice(0, 8)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{f.source ?? "—"}</Badge></TableCell>
                    <TableCell>{f.attempts}/{f.max_attempts}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(f.updated_at), { locale: da, addSuffix: true })}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); retry(f.id); }}>Prøv igen</Button>
                    </TableCell>
                  </TableRow>
                  {expanded === f.id && f.last_error && (
                    <TableRow key={f.id + "-err"}>
                      <TableCell colSpan={6} className="bg-muted/40 text-xs font-mono whitespace-pre-wrap py-2">
                        {f.last_error}
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
