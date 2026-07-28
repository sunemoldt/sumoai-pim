import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Play, AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { da } from "date-fns/locale";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface SupplierRow {
  id: string;
  name: string;
  feed_type: string;
  feed_schedule: string | null;
  last_sync_at: string | null;
  is_active: boolean;
}

interface LatestLog {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  total_fetched: number | null;
  imported: number | null;
  errors: any;
}

const SCHEDULE_TO_HOURS: Record<string, number> = {
  "0 * * * *": 1,
  "0 */2 * * *": 2,
  "0 */4 * * *": 4,
  "0 */6 * * *": 6,
  "0 */12 * * *": 12,
  "0 6 * * *": 24,
  "0 6 * * 1": 168,
};

export function SupplierStatusTable() {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [logs, setLogs] = useState<Record<string, LatestLog[]>>({});
  const [syncing, setSyncing] = useState<string | null>(null);
  const [dialogSupplier, setDialogSupplier] = useState<SupplierRow | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("suppliers")
      .select("id, name, feed_type, feed_schedule, last_sync_at, is_active")
      .eq("is_active", true)
      .order("name");
    if (!data) return;
    setSuppliers(data as SupplierRow[]);

    // Fetch the 5 most recent logs per supplier in one query, then group.
    const sourceKeys = data.map((s) => `supplier-feed-import:${s.id}`);
    const { data: logRows } = await supabase
      .from("import_logs")
      .select("id, source, status, started_at, completed_at, total_fetched, imported, errors")
      .in("source", sourceKeys)
      .order("started_at", { ascending: false })
      .limit(200);
    const grouped: Record<string, LatestLog[]> = {};
    for (const r of logRows ?? []) {
      const id = String(r.source).replace("supplier-feed-import:", "");
      if (!grouped[id]) grouped[id] = [];
      if (grouped[id].length < 5) grouped[id].push(r as any);
    }
    setLogs(grouped);
  };

  useEffect(() => { load(); }, []);

  const runNow = async (id: string, name: string) => {
    setSyncing(id);
    try {
      const { data, error } = await supabase.functions.invoke("supplier-feed-import", { body: { supplier_id: id, async: true } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.skipped === "already_running") {
        toast.info(`${name}: en synk kører allerede – venter på den`);
      } else {
        toast.success(`${name}: synk startet i baggrunden`);
      }
      setTimeout(load, 5000);
    } catch (e: any) {
      toast.error(`${name}: ${e.message}`);
    } finally {
      setSyncing(null);
    }
  };

  const supplierStatus = (s: SupplierRow) => {
    const supplierLogs = logs[s.id] ?? [];
    const lastOk = supplierLogs.find((l) => l.status === "done");
    const lastAttempt = supplierLogs[0];
    const hours = s.feed_schedule ? SCHEDULE_TO_HOURS[s.feed_schedule] : null;
    const anchor = lastOk?.completed_at ?? s.last_sync_at;
    const overdue = hours && anchor
      ? (Date.now() - new Date(anchor).getTime()) / 3_600_000 > hours * 2
      : false;
    return { lastOk, lastAttempt, overdue };
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Leverandør</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Sidst OK</TableHead>
            <TableHead>Seneste forsøg</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Handling</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suppliers.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Ingen aktive leverandører</TableCell></TableRow>
          ) : suppliers.map((s) => {
            const { lastOk, lastAttempt, overdue } = supplierStatus(s);
            const lastErrorMsg = lastAttempt?.status === "failed"
              ? (lastAttempt.errors?.message ?? lastAttempt.errors?.response?.message ?? "Fejl")
              : null;
            return (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{s.feed_type}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {lastOk?.completed_at
                    ? formatDistanceToNow(new Date(lastOk.completed_at), { locale: da, addSuffix: true })
                    : s.last_sync_at
                      ? formatDistanceToNow(new Date(s.last_sync_at), { locale: da, addSuffix: true })
                      : "Aldrig"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {lastAttempt?.started_at
                    ? formatDistanceToNow(new Date(lastAttempt.started_at), { locale: da, addSuffix: true })
                    : "—"}
                  {lastErrorMsg && (
                    <div className="text-orange-600 truncate max-w-[220px]" title={lastErrorMsg}>
                      {lastErrorMsg}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {overdue ? (
                    <Badge variant="outline" className="text-orange-600 border-orange-500/40"><AlertTriangle className="h-3 w-3 mr-1" />Forsinket</Badge>
                  ) : lastOk ? (
                    <Badge variant="outline" className="text-green-600 border-green-500/40"><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>
                  ) : lastAttempt?.status === "failed" ? (
                    <Badge variant="outline" className="text-red-600 border-red-500/40"><AlertTriangle className="h-3 w-3 mr-1" />Fejlet</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">Ikke kørt</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setDialogSupplier(s)} title="Vis seneste logs">
                      <FileText className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" disabled={syncing === s.id} onClick={() => runNow(s.id, s.name)}>
                      <Play className={`h-3.5 w-3.5 mr-1 ${syncing === s.id ? "animate-spin" : ""}`} />
                      Kør nu
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={!!dialogSupplier} onOpenChange={(o) => { if (!o) setDialogSupplier(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Seneste logs — {dialogSupplier?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {(dialogSupplier ? logs[dialogSupplier.id] ?? [] : []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Ingen logs endnu.</p>
            ) : (
              (dialogSupplier ? logs[dialogSupplier.id] ?? [] : []).map((l) => (
                <div key={l.id} className="rounded border p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className={
                      l.status === "done" ? "text-green-600 border-green-500/40"
                      : l.status === "failed" ? "text-red-600 border-red-500/40"
                      : "text-muted-foreground"
                    }>{l.status}</Badge>
                    <span className="text-muted-foreground">{new Date(l.started_at).toLocaleString("da-DK")}</span>
                  </div>
                  <div className="text-muted-foreground">
                    Rækker: {l.total_fetched ?? 0} · Importeret: {l.imported ?? 0}
                    {l.completed_at && ` · Varede ${Math.round((new Date(l.completed_at).getTime() - new Date(l.started_at).getTime()) / 1000)}s`}
                  </div>
                  {l.errors && (
                    <pre className="text-orange-600 whitespace-pre-wrap break-words text-[11px]">
                      {typeof l.errors === "string" ? l.errors : JSON.stringify(l.errors, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
