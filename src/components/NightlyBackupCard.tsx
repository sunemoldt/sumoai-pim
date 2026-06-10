import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CloudUpload, Loader2 } from "lucide-react";

type BackupLog = {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  total_fetched: number | null;
  results: unknown;
  errors: unknown;
};

export function NightlyBackupCard() {
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<BackupLog | null>(null);

  const fetchLast = async () => {
    const { data } = await supabase
      .from("import_logs")
      .select("id, status, started_at, completed_at, total_fetched, results, errors")
      .eq("source", "nightly-backup")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastRun(data as BackupLog | null);
  };

  useEffect(() => { fetchLast(); }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("nightly-backup", { body: {} });
      if (error) throw error;
      toast.success("Backup færdig — uploadet til Google Drive");
      console.log("[backup] result", data);
      await fetchLast();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Backup fejlede: ${msg}`);
    } finally {
      setRunning(false);
    }
  };

  const summary = lastRun?.results && Array.isArray(lastRun.results) ? (lastRun.results[0] as Record<string, unknown>) : null;
  const tables = summary?.tables as Record<string, { count: number }> | undefined;
  const totalRows = tables ? Object.values(tables).reduce((a, b) => a + b.count, 0) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CloudUpload className="h-5 w-5" />
          Natlig backup til Google Drive
        </CardTitle>
        <CardDescription>
          Hver nat kl. 02:30 dansk tid uploades en JSON-dump af alle tabeller og en EAN-CSV til mappen
          <code className="mx-1 rounded bg-muted px-1">Comtek-PIM-Backups</code> i din Google Drive.
          Filer ældre end 7 dage slettes automatisk.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Button onClick={runNow} disabled={running} variant="outline" className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
            {running ? "Kører backup..." : "Kør backup nu"}
          </Button>
          {lastRun && (
            <Badge variant={lastRun.status === "success" ? "default" : "destructive"}>
              {lastRun.status === "success" ? "✓ sidste OK" : "✗ sidste FEJL"}
            </Badge>
          )}
        </div>

        {lastRun && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
            <div>
              <span className="text-muted-foreground">Sidst kørt:</span>{" "}
              {new Date(lastRun.started_at).toLocaleString("da-DK")}
            </div>
            {totalRows !== null && (
              <div>
                <span className="text-muted-foreground">Rækker i alt:</span> {totalRows.toLocaleString("da-DK")}
              </div>
            )}
            {summary?.deleted_old_files != null && (
              <div>
                <span className="text-muted-foreground">Slettede gamle filer:</span> {String(summary.deleted_old_files)}
              </div>
            )}
            {summary?.elapsed_ms != null && (
              <div>
                <span className="text-muted-foreground">Varighed:</span> {Math.round(Number(summary.elapsed_ms) / 1000)}s
              </div>
            )}
            {lastRun.status !== "success" && Array.isArray(lastRun.errors) && lastRun.errors.length > 0 && (
              <div className="text-destructive">
                Fejl: {(lastRun.errors[0] as { message?: string })?.message ?? "ukendt"}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
