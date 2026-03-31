import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, CheckCircle2, AlertCircle, Loader2, Clock, History } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type ImportResult = {
  success: boolean;
  total_fetched?: number;
  imported?: number;
  deduplicated?: number;
  errors?: string[];
  error?: string;
  log_id?: string;
};

type ImportLog = {
  id: string;
  source: string;
  status: string;
  total_fetched: number;
  imported: number;
  skipped: number;
  deduplicated: number;
  errors: string[];
  started_at: string;
  completed_at: string | null;
};

function useImportLogs() {
  return useQuery({
    queryKey: ["import_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_logs")
        .select("id, source, status, total_fetched, imported, skipped, deduplicated, errors, started_at, completed_at")
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ImportLog[];
    },
  });
}

export default function ImportPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const queryClient = useQueryClient();
  const { data: logs = [] } = useImportLogs();

  const runImport = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("wc-import");
      if (error) throw error;
      setResult(data as ImportResult);
      if (data?.success) {
        toast.success(`${data.imported} produkter importeret fra WooCommerce`);
        queryClient.invalidateQueries({ queryKey: ["master_products"] });
        queryClient.invalidateQueries({ queryKey: ["import_logs"] });
      } else {
        toast.error(data?.error || "Import fejlede");
      }
    } catch (err: any) {
      const msg = err?.message || "Ukendt fejl";
      setResult({ success: false, error: msg });
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge variant="outline" className="text-success border-success/30">Fuldført</Badge>;
      case "completed_with_errors":
        return <Badge variant="outline" className="text-warning border-warning/30">Med fejl</Badge>;
      case "running":
        return <Badge variant="outline" className="text-primary border-primary/30">Kører</Badge>;
      case "failed":
        return <Badge variant="destructive">Fejlet</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">WooCommerce Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Hent produkter fra din WooCommerce-butik og importer dem som masterprodukter
        </p>
      </div>

      <Card className="shadow-sm max-w-lg">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Synkroniser produkter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Henter alle produkter (inkl. varianter) fra WooCommerce og opretter/opdaterer dem i
            produktkataloget. Eksisterende produkter matches på EAN. Alle importer logges.
          </p>

          <Button onClick={runImport} disabled={loading} className="w-full">
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {loading ? "Importerer..." : "Start import"}
          </Button>

          {result && (
            <div className="rounded-md border border-border p-4 space-y-2">
              <div className="flex items-center gap-2">
                {result.success ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-destructive" />
                )}
                <span className="font-medium text-foreground">
                  {result.success ? "Import fuldført" : "Import fejlede"}
                </span>
              </div>

              {result.success && (
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant="secondary">Hentet: {result.total_fetched}</Badge>
                  <Badge variant="secondary" className="text-success border-success/30">
                    Importeret: {result.imported}
                  </Badge>
                  {(result.deduplicated ?? 0) > 0 && (
                    <Badge variant="secondary">Deduplikeret: {result.deduplicated}</Badge>
                  )}
                </div>
              )}

              {result.error && (
                <p className="text-sm text-destructive">{result.error}</p>
              )}

              {result.errors && result.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Fejl:</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-destructive">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import history */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            Importhistorik
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Ingen importer registreret endnu</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/50">
                  <TableHead>Tidspunkt</TableHead>
                  <TableHead>Kilde</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Hentet</TableHead>
                  <TableHead className="text-right">Importeret</TableHead>
                  <TableHead className="text-right">Deduplikeret</TableHead>
                  <TableHead className="text-right">Fejl</TableHead>
                  <TableHead>Varighed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const started = new Date(log.started_at);
                  const completed = log.completed_at ? new Date(log.completed_at) : null;
                  const durationSec = completed ? Math.round((completed.getTime() - started.getTime()) / 1000) : null;

                  return (
                    <TableRow key={log.id}>
                      <TableCell className="text-muted-foreground text-xs">
                        {started.toLocaleDateString("da-DK")} {started.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="font-medium text-foreground capitalize">{log.source}</TableCell>
                      <TableCell>{statusBadge(log.status)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{log.total_fetched}</TableCell>
                      <TableCell className="text-right font-mono text-foreground">{log.imported}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{log.deduplicated}</TableCell>
                      <TableCell className="text-right font-mono">
                        {log.errors && log.errors.length > 0 ? (
                          <span className="text-destructive">{log.errors.length}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {durationSec !== null ? `${durationSec}s` : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
