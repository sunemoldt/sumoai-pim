import { Fragment, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { da } from "date-fns/locale";

type ResultRow = {
  id: string;
  ean: string;
  title: string;
  status: "ok" | "skipped" | "error";
  step?: string;
  message?: string;
  pim?: "updated" | "unchanged" | "error";
  shopify?: "synced" | "skipped" | "error" | "not_applicable";
  shopify_reason?: string;
  ts?: string;
};

type LogRow = {
  id: string;
  source: string;
  status: string;
  total_fetched: number | null;
  imported: number | null;
  skipped: number | null;
  errors: unknown;
  results: ResultRow[] | null;
  started_at: string;
  completed_at: string | null;
};

const pimBadge = (v?: string) => {
  if (v === "updated") return <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20">Renset</Badge>;
  if (v === "unchanged") return <Badge variant="outline" className="text-muted-foreground">Uændret</Badge>;
  if (v === "error") return <Badge variant="destructive">Fejl</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">—</Badge>;
};

const shopifyBadge = (v?: string) => {
  if (v === "synced") return <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20">Synket</Badge>;
  if (v === "skipped") return <Badge variant="outline">Sprunget over</Badge>;
  if (v === "not_applicable") return <Badge variant="outline" className="text-muted-foreground">Ikke relevant</Badge>;
  if (v === "error") return <Badge variant="destructive">Fejl</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">—</Badge>;
};

export default function CleanupAuditCard() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [statusTab, setStatusTab] = useState<"all" | "ok" | "skipped" | "error">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("import_logs")
      .select("id, source, status, total_fetched, imported, skipped, errors, results, started_at, completed_at")
      .eq("source", "bulk-clean-descriptions")
      .order("started_at", { ascending: false })
      .limit(20);
    setLoading(false);
    if (error) return;
    const rows = (data ?? []) as unknown as LogRow[];
    setLogs(rows);
    if (rows.length && !selectedId) setSelectedId(rows[0].id);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("import_logs_audit")
      .on("postgres_changes", { event: "*", schema: "public", table: "import_logs" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = logs.find((l) => l.id === selectedId) ?? null;

  const filteredResults = useMemo(() => {
    const list = (selected?.results ?? []) as ResultRow[];
    return list
      .filter((r) => statusTab === "all" || r.status === statusTab)
      .filter((r) => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return (
          r.ean?.toLowerCase().includes(q) ||
          r.title?.toLowerCase().includes(q) ||
          r.message?.toLowerCase().includes(q) ||
          r.shopify_reason?.toLowerCase().includes(q)
        );
      });
  }, [selected, statusTab, filter]);

  const counts = useMemo(() => {
    const list = (selected?.results ?? []) as ResultRow[];
    return {
      all: list.length,
      ok: list.filter((r) => r.status === "ok").length,
      skipped: list.filter((r) => r.status === "skipped").length,
      error: list.filter((r) => r.status === "error").length,
      pim_updated: list.filter((r) => r.pim === "updated").length,
      shopify_synced: list.filter((r) => r.shopify === "synced").length,
    };
  }, [selected]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Oprydnings-audit (PIM ↔ Shopify)
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Viser per-EAN status fra de seneste oprydningskørsler: om beskrivelsen er renset i PIM, om den er pushet til Shopify, og hvorfor noget evt. blev sprunget over eller fejlede.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {logs.map((l) => {
              const when = formatDistanceToNow(new Date(l.started_at), { addSuffix: true, locale: da });
              const isSel = l.id === selectedId;
              return (
                <Button
                  key={l.id}
                  size="sm"
                  variant={isSel ? "default" : "outline"}
                  onClick={() => setSelectedId(l.id)}
                >
                  {when} · {l.imported ?? 0}/{l.total_fetched ?? 0}
                  {l.status !== "completed" && <Loader2 className="ml-2 h-3 w-3 animate-spin" />}
                </Button>
              );
            })}
            {logs.length === 0 && !loading && (
              <span className="text-sm text-muted-foreground">Ingen kørsler endnu.</span>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {selected && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div className="rounded-md border p-2"><div className="text-muted-foreground">Total</div><div className="font-semibold">{counts.all}</div></div>
              <div className="rounded-md border p-2"><div className="text-muted-foreground">PIM renset</div><div className="font-semibold text-emerald-600">{counts.pim_updated}</div></div>
              <div className="rounded-md border p-2"><div className="text-muted-foreground">Shopify synket</div><div className="font-semibold text-emerald-600">{counts.shopify_synced}</div></div>
              <div className="rounded-md border p-2"><div className="text-muted-foreground">Sprunget over</div><div className="font-semibold">{counts.skipped}</div></div>
              <div className="rounded-md border p-2"><div className="text-muted-foreground">Fejl</div><div className={`font-semibold ${counts.error ? "text-destructive" : ""}`}>{counts.error}</div></div>
            </div>

            <div className="flex items-center gap-2">
              <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as typeof statusTab)}>
                <TabsList>
                  <TabsTrigger value="all">Alle ({counts.all})</TabsTrigger>
                  <TabsTrigger value="ok">OK ({counts.ok})</TabsTrigger>
                  <TabsTrigger value="skipped">Sprunget over ({counts.skipped})</TabsTrigger>
                  <TabsTrigger value="error">Fejl ({counts.error})</TabsTrigger>
                </TabsList>
              </Tabs>
              <Input
                placeholder="Filtrér på EAN, titel eller årsag…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="max-w-sm"
              />
            </div>

            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="w-40">EAN</TableHead>
                    <TableHead>Titel</TableHead>
                    <TableHead className="w-28">PIM</TableHead>
                    <TableHead className="w-32">Shopify</TableHead>
                    <TableHead>Årsag / besked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredResults.map((r) => {
                    const isOpen = !!expanded[r.id];
                    const reason = r.shopify_reason ?? r.message ?? r.step ?? "";
                    return (
                      <Fragment key={r.id}>
                        <TableRow key={r.id} className="cursor-pointer" onClick={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))}>
                          <TableCell>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                          <TableCell className="font-mono text-xs">{r.ean}</TableCell>
                          <TableCell className="max-w-xs truncate">{r.title}</TableCell>
                          <TableCell>{pimBadge(r.pim)}</TableCell>
                          <TableCell>{shopifyBadge(r.shopify)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-md truncate">{reason}</TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow key={r.id + "-d"}>
                            <TableCell colSpan={6} className="bg-muted/30">
                              <div className="text-xs space-y-1 p-2">
                                <div><span className="text-muted-foreground">Step:</span> <code>{r.step ?? "—"}</code></div>
                                <div><span className="text-muted-foreground">PIM:</span> {r.pim ?? "—"}</div>
                                <div><span className="text-muted-foreground">Shopify:</span> {r.shopify ?? "—"}</div>
                                {r.shopify_reason && <div><span className="text-muted-foreground">Shopify-årsag:</span> {r.shopify_reason}</div>}
                                {r.message && <div><span className="text-muted-foreground">Fejl:</span> <span className="text-destructive">{r.message}</span></div>}
                                {r.ts && <div><span className="text-muted-foreground">Tidspunkt:</span> {new Date(r.ts).toLocaleString("da-DK")}</div>}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                  {filteredResults.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6 text-sm">
                        Ingen rækker matcher filteret.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
