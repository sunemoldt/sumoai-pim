import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Database, Activity, FileClock } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

interface DbStats {
  database_size_bytes: number;
  database_size_pretty: string;
  tables: { name: string; row_estimate: number; total_bytes: number; total_pretty: string }[];
  change_log_total: number;
  change_log_last_24h: number;
  change_log_last_7d: number;
  wc_last_import_at: string | null;
}

interface ImportLog {
  id: string;
  source: string;
  status: string;
  total_fetched: number | null;
  imported: number | null;
  started_at: string;
  completed_at: string | null;
}

interface DailyChange {
  day: string;
  count: number;
  source: string;
}

export default function MonitoringPage() {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [imports, setImports] = useState<ImportLog[]>([]);
  const [daily, setDaily] = useState<DailyChange[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [statsRes, importsRes, dailyRes] = await Promise.all([
      supabase.rpc("get_db_stats"),
      supabase
        .from("import_logs")
        .select("id, source, status, total_fetched, imported, started_at, completed_at")
        .order("started_at", { ascending: false })
        .limit(20),
      supabase.rpc("get_change_log_daily", { days: 14 }),
    ]);
    if (statsRes.data) setStats(statsRes.data as unknown as DbStats);
    if (importsRes.data) setImports(importsRes.data as ImportLog[]);
    if (dailyRes.data) setDaily(dailyRes.data as DailyChange[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const chartData = useMemo(() => {
    const byDay = new Map<string, Record<string, number | string>>();
    for (const r of daily) {
      const key = r.day;
      const cur = byDay.get(key) ?? { day: key };
      cur[r.source] = (cur[r.source] as number | undefined ?? 0) + Number(r.count);
      byDay.set(key, cur);
    }
    return Array.from(byDay.values()).sort((a, b) =>
      String(a.day).localeCompare(String(b.day))
    );
  }, [daily]);

  const sources = useMemo(() => {
    const s = new Set<string>();
    daily.forEach((d) => s.add(d.source));
    return Array.from(s);
  }, [daily]);

  const importDuration = (l: ImportLog) => {
    if (!l.completed_at) return "—";
    const ms = new Date(l.completed_at).getTime() - new Date(l.started_at).getTime();
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (loading && !stats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Cloud Monitoring</h1>
          <p className="text-sm text-muted-foreground">
            Overblik over forbrug og effekt af optimeringer
          </p>
        </div>
        <Button onClick={load} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Opdater
        </Button>
      </header>

      {/* Top stat cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Database className="h-4 w-4" /> Database størrelse
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{stats?.database_size_pretty ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileClock className="h-4 w-4" /> Change log (sidste 24t)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {stats?.change_log_last_24h?.toLocaleString("da-DK") ?? "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              7d: {stats?.change_log_last_7d?.toLocaleString("da-DK") ?? "—"} · total:{" "}
              {stats?.change_log_total?.toLocaleString("da-DK") ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Activity className="h-4 w-4" /> Sidste WC import
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-base font-medium">
              {stats?.wc_last_import_at
                ? new Date(stats.wc_last_import_at).toLocaleString("da-DK")
                : "—"}
            </div>
            <p className="text-xs text-muted-foreground">Bruges som incremental cutoff</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tabeller</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{stats?.tables?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground">i public schema</p>
          </CardContent>
        </Card>
      </div>

      {/* Change log over time */}
      <Card>
        <CardHeader>
          <CardTitle>Change log volumen pr. dag (sidste 14 dage)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Effekt af incremental wc-import — jo lavere, jo mindre Cloud-forbrug.
          </p>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen data endnu</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  {sources.map((s, i) => (
                    <Bar
                      key={s}
                      dataKey={s}
                      stackId="a"
                      fill={["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--muted-foreground))"][i % 3]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tables breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Plads pr. tabel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2">Tabel</th>
                  <th className="py-2 text-right">Rækker (estimat)</th>
                  <th className="py-2 text-right">Plads</th>
                </tr>
              </thead>
              <tbody>
                {stats?.tables?.map((t) => (
                  <tr key={t.name} className="border-t border-border">
                    <td className="py-2 font-mono">{t.name}</td>
                    <td className="py-2 text-right">{t.row_estimate.toLocaleString("da-DK")}</td>
                    <td className="py-2 text-right">{t.total_pretty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent imports */}
      <Card>
        <CardHeader>
          <CardTitle>Seneste imports</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sammenlign `total_fetched` før/efter incremental sync.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2">Tidspunkt</th>
                  <th className="py-2">Kilde</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Hentet</th>
                  <th className="py-2 text-right">Importeret</th>
                  <th className="py-2 text-right">Varighed</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="py-2">{new Date(l.started_at).toLocaleString("da-DK")}</td>
                    <td className="py-2 font-mono text-xs">{l.source}</td>
                    <td className="py-2">
                      <Badge variant={l.status === "completed" ? "default" : "secondary"}>
                        {l.status}
                      </Badge>
                    </td>
                    <td className="py-2 text-right">{l.total_fetched ?? "—"}</td>
                    <td className="py-2 text-right">{l.imported ?? "—"}</td>
                    <td className="py-2 text-right">{importDuration(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
