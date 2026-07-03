import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, RefreshCw, Database, Activity, AlertTriangle, Zap, ChevronDown, ArrowUp, ArrowDown, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { ActivityFeed } from "@/components/monitoring/ActivityFeed";
import { SourceDonut } from "@/components/monitoring/SourceDonut";
import { QueueDetailsCard } from "@/components/monitoring/QueueDetailsCard";
import { SupplierStatusTable } from "@/components/monitoring/SupplierStatusTable";

interface Overview {
  queue: { pending: number; processing: number; failed: number; oldest_pending_seconds: number | null };
  changes_last_hour: number;
  changes_prev_hour: number;
  changes_24h: number;
  errors_24h: number;
  source_breakdown_24h: Record<string, number>;
  queue_throughput_6h: { bucket: string; count: number }[];
}

interface DbStats {
  database_size_pretty: string;
  tables: { name: string; row_estimate: number; total_pretty: string }[];
}

interface DailyChange { day: string; count: number; source: string }

function formatDuration(sec: number | null) {
  if (sec == null) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}t`;
}

export default function MonitoringPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [daily, setDaily] = useState<DailyChange[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [ovRes, statsRes, dailyRes] = await Promise.all([
      supabase.rpc("get_monitoring_overview"),
      supabase.rpc("get_db_stats"),
      supabase.rpc("get_change_log_daily", { days: 14 }),
    ]);
    if (ovRes.data) setOverview(ovRes.data as unknown as Overview);
    if (statsRes.data) setDbStats(statsRes.data as unknown as DbStats);
    if (dailyRes.data) setDaily(dailyRes.data as DailyChange[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const dailyChart = useMemo(() => {
    const byDay = new Map<string, Record<string, number | string>>();
    for (const r of daily) {
      const cur = byDay.get(r.day) ?? { day: r.day };
      cur[r.source] = ((cur[r.source] as number | undefined) ?? 0) + Number(r.count);
      byDay.set(r.day, cur);
    }
    return Array.from(byDay.values()).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  }, [daily]);

  const dailySources = useMemo(() => Array.from(new Set(daily.map((d) => d.source))), [daily]);

  const changeDelta = overview ? overview.changes_last_hour - overview.changes_prev_hour : 0;
  const queueHealthy = overview && overview.queue.failed === 0 && (overview.queue.oldest_pending_seconds ?? 0) < 600;

  if (loading && !overview) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Monitoring</h1>
          <p className="text-sm text-muted-foreground">Live overblik over sync, ændringer og fejl · opdateres hvert 30. sek</p>
        </div>
        <Button onClick={load} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Opdater
        </Button>
      </header>

      {/* Status strip */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className={queueHealthy ? "" : "border-orange-500/50"}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Zap className="h-4 w-4" /> Shopify-kø
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-3">
              <div className="text-2xl font-semibold">{overview?.queue.pending ?? 0}</div>
              <div className="text-xs text-muted-foreground">pending</div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {overview?.queue.processing ?? 0} kører · <span className={overview?.queue.failed ? "text-destructive" : ""}>{overview?.queue.failed ?? 0} fejlet</span>
              {overview?.queue.oldest_pending_seconds != null && overview.queue.oldest_pending_seconds > 0 && (
                <> · ældste {formatDuration(overview.queue.oldest_pending_seconds)}</>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Activity className="h-4 w-4" /> Ændringer sidste time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-semibold">{overview?.changes_last_hour.toLocaleString("da-DK") ?? 0}</div>
              {changeDelta !== 0 && (
                <span className={`inline-flex items-center text-xs ${changeDelta > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                  {changeDelta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  {Math.abs(changeDelta)}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {overview?.changes_24h.toLocaleString("da-DK") ?? 0} sidste 24t
            </p>
          </CardContent>
        </Card>

        <Card className={overview && overview.errors_24h > 0 ? "border-destructive/50" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <AlertTriangle className="h-4 w-4" /> Fejl sidste 24t
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-semibold ${overview && overview.errors_24h > 0 ? "text-destructive" : ""}`}>
              {overview?.errors_24h ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Shopify-kø + import-fejl</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Database className="h-4 w-4" /> Database
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{dbStats?.database_size_pretty ?? "—"}</div>
            <p className="text-xs text-muted-foreground mt-1">{dbStats?.tables?.length ?? 0} tabeller</p>
          </CardContent>
        </Card>
      </div>

      {/* Feed + donut */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Live aktivitet</CardTitle>
            <p className="text-xs text-muted-foreground">Ændringer på master-produkter i realtid</p>
          </CardHeader>
          <CardContent>
            <ActivityFeed />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kilder sidste 24t</CardTitle>
            <p className="text-xs text-muted-foreground">Hvem ændrer data?</p>
          </CardHeader>
          <CardContent>
            <SourceDonut breakdown={overview?.source_breakdown_24h ?? {}} />
          </CardContent>
        </Card>
      </div>

      {/* Shopify queue */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shopify-kø detaljer</CardTitle>
        </CardHeader>
        <CardContent>
          <QueueDetailsCard queueThroughput={overview?.queue_throughput_6h ?? []} />
        </CardContent>
      </Card>

      {/* Suppliers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leverandør-sync</CardTitle>
        </CardHeader>
        <CardContent>
          <SupplierStatusTable />
        </CardContent>
      </Card>

      {/* Trend chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Change log volumen (14 dage)</CardTitle>
        </CardHeader>
        <CardContent>
          {dailyChart.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Ingen data</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {dailySources.map((s, i) => (
                    <Bar
                      key={s}
                      dataKey={s}
                      stackId="a"
                      fill={["hsl(217 91% 60%)", "hsl(280 65% 60%)", "hsl(142 71% 45%)", "hsl(25 95% 55%)", "hsl(220 9% 55%)"][i % 5]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* DB tables collapsible */}
      <Collapsible>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/40 transition">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Plads pr. tabel</span>
                <ChevronDown className="h-4 w-4" />
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2">Tabel</th>
                      <th className="py-2 text-right">Rækker (est.)</th>
                      <th className="py-2 text-right">Plads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbStats?.tables?.map((t) => (
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
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
