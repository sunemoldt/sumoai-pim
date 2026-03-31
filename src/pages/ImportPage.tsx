import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, CheckCircle2, AlertCircle, Loader2, Clock, History, Download, Upload } from "lucide-react";
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
  const [importing, setImporting] = useState(false);
  const queryClient = useQueryClient();
  const { data: logs = [] } = useImportLogs();
  const fileRef = useRef<HTMLInputElement>(null);

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

  const exportCsv = async () => {
    try {
      const { data, error } = await supabase
        .from("master_products")
        .select("*")
        .order("title");
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error("Ingen produkter at eksportere");
        return;
      }

      const headers = Object.keys(data[0]);
      const csvRows = [
        headers.join(";"),
        ...data.map((row: any) =>
          headers.map((h) => {
            const val = row[h];
            if (val === null || val === undefined) return "";
            const str = typeof val === "object" ? JSON.stringify(val) : String(val);
            return `"${str.replace(/"/g, '""')}"`;
          }).join(";")
        ),
      ];

      const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `produkter-backup-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${data.length} produkter eksporteret som CSV`);
    } catch (err: any) {
      toast.error(err?.message || "Fejl ved eksport");
    }
  };

  const importCsv = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) {
        toast.error("CSV-filen er tom eller ugyldig");
        return;
      }

      const headers = lines[0].split(";").map((h) => h.replace(/^"|"$/g, "").trim());
      const rows: Record<string, any>[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].match(/("(?:[^"]|"")*"|[^;]*)/g) || [];
        const row: Record<string, any> = {};
        headers.forEach((header, idx) => {
          let val = (values[idx] || "").replace(/^"|"$/g, "").replace(/""/g, '"').trim();
          if (val === "") {
            row[header] = null;
          } else if (header === "attributes" || header === "ean_snapshot" || header === "errors") {
            try { row[header] = JSON.parse(val); } catch { row[header] = val; }
          } else if (["webshop_price", "sale_price", "custom_markup_percentage"].includes(header)) {
            row[header] = val ? parseFloat(val) : null;
          } else if (["stock_quantity"].includes(header)) {
            row[header] = val ? parseInt(val, 10) : null;
          } else if (header === "backorders_allowed") {
            row[header] = val === "true";
          } else {
            row[header] = val;
          }
        });
        if (row.ean && row.title) rows.push(row);
      }

      if (rows.length === 0) {
        toast.error("Ingen gyldige rækker fundet i CSV");
        return;
      }

      // Remove id, created_at, updated_at - let DB handle those
      const cleanRows = rows.map((r) => {
        const { id, created_at, updated_at, ...rest } = r;
        return rest;
      });

      // Batch upsert
      const batchSize = 50;
      let imported = 0;
      const errors: string[] = [];

      for (let i = 0; i < cleanRows.length; i += batchSize) {
        const batch = cleanRows.slice(i, i + batchSize);
        const { error } = await supabase
          .from("master_products")
          .upsert(batch, { onConflict: "ean" });
        if (error) {
          errors.push(`Batch ${i}-${i + batch.length}: ${error.message}`);
        } else {
          imported += batch.length;
        }
      }

      if (errors.length > 0) {
        toast.error(`Importeret ${imported} produkter med ${errors.length} fejl`);
      } else {
        toast.success(`${imported} produkter importeret fra CSV`);
      }

      queryClient.invalidateQueries({ queryKey: ["master_products"] });
    } catch (err: any) {
      toast.error(err?.message || "Fejl ved CSV-import");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
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
        <h1 className="text-2xl font-semibold text-foreground">Import & Backup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Importér produkter fra WooCommerce, eksportér CSV-backup eller gendan fra backup
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">WooCommerce import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Henter alle produkter (inkl. varianter) fra WooCommerce og opretter/opdaterer dem i
              produktkataloget. Eksisterende produkter matches på EAN.
            </p>

            <Button onClick={runImport} disabled={loading} className="w-full">
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {loading ? "Importerer..." : "Start WooCommerce import"}
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
                {result.error && <p className="text-sm text-destructive">{result.error}</p>}
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

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">CSV Backup & Gendannelse</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Eksportér hele produktkataloget som CSV til backup, eller importér en tidligere backup for at gendanne data.
            </p>

            <Button onClick={exportCsv} variant="outline" className="w-full gap-2">
              <Download className="h-4 w-4" />
              Eksportér CSV-backup
            </Button>

            <div className="relative">
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importCsv(file);
                }}
              />
              <Button
                onClick={() => fileRef.current?.click()}
                variant="outline"
                disabled={importing}
                className="w-full gap-2"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {importing ? "Importerer CSV..." : "Importér fra CSV-backup"}
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                CSV-filen skal være i samme format som eksporten (semikolon-separeret, UTF-8)
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

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
