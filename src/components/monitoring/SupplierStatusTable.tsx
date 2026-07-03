import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Play, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { da } from "date-fns/locale";
import { toast } from "sonner";

interface SupplierRow {
  id: string;
  name: string;
  feed_type: string;
  feed_schedule: string | null;
  last_sync_at: string | null;
  is_active: boolean;
}

interface LastRun {
  supplier_id: string;
  imported: number | null;
  total_fetched: number | null;
  status: string;
  started_at: string;
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
  const [syncing, setSyncing] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("suppliers")
      .select("id, name, feed_type, feed_schedule, last_sync_at, is_active")
      .eq("is_active", true)
      .order("name");
    if (data) setSuppliers(data as SupplierRow[]);
  };

  useEffect(() => { load(); }, []);

  const runNow = async (id: string, name: string) => {
    setSyncing(id);
    try {
      const { data, error } = await supabase.functions.invoke("supplier-feed-import", { body: { supplier_id: id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`${name}: ${data.imported ?? 0} produkter opdateret`);
      load();
    } catch (e: any) {
      toast.error(`${name}: ${e.message}`);
    } finally {
      setSyncing(null);
    }
  };

  const isOverdue = (s: SupplierRow) => {
    if (!s.last_sync_at || !s.feed_schedule) return false;
    const hours = SCHEDULE_TO_HOURS[s.feed_schedule];
    if (!hours) return false;
    const age = (Date.now() - new Date(s.last_sync_at).getTime()) / 3_600_000;
    return age > hours * 2;
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Leverandør</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Sidst kørt</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Handling</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {suppliers.length === 0 ? (
          <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Ingen aktive leverandører</TableCell></TableRow>
        ) : suppliers.map((s) => {
          const overdue = isOverdue(s);
          return (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell><Badge variant="outline" className="text-xs">{s.feed_type}</Badge></TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {s.last_sync_at ? formatDistanceToNow(new Date(s.last_sync_at), { locale: da, addSuffix: true }) : "Aldrig"}
              </TableCell>
              <TableCell>
                {overdue ? (
                  <Badge variant="outline" className="text-orange-600 border-orange-500/40"><AlertTriangle className="h-3 w-3 mr-1" />Forsinket</Badge>
                ) : s.last_sync_at ? (
                  <Badge variant="outline" className="text-green-600 border-green-500/40"><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Ikke kørt</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="ghost" disabled={syncing === s.id} onClick={() => runNow(s.id, s.name)}>
                  <Play className={`h-3.5 w-3.5 mr-1 ${syncing === s.id ? "animate-spin" : ""}`} />
                  Kør nu
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
