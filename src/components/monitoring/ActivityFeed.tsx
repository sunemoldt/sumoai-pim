import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { da } from "date-fns/locale";
import { Loader2 } from "lucide-react";

interface ChangeLogRow {
  id: string;
  master_product_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  source: string | null;
  created_at: string;
  product_title?: string;
}

const FILTERS = [
  { key: "all", label: "Alle", match: () => true },
  { key: "price", label: "Priser", match: (f: string) => f === "webshop_price" || f === "sale_price" },
  { key: "stock", label: "Lager", match: (f: string) => f === "stock_quantity" || f === "stock_status" },
  { key: "shopify", label: "Shopify", match: (_: string, s: string) => s.startsWith("shopify") || s === "sibling-shared-sync" },
  { key: "supplier", label: "Leverandører", match: (_: string, s: string) => s.startsWith("supplier") },
  { key: "manual", label: "Manuelt", match: (_: string, s: string) => s === "manual" || s === "auto-pim-edit" },
];

function sourceBadge(source: string | null) {
  const s = source ?? "unknown";
  let cls = "bg-muted text-muted-foreground";
  if (s.startsWith("supplier")) cls = "bg-blue-500/15 text-blue-600 dark:text-blue-400";
  else if (s.startsWith("shopify") || s === "sibling-shared-sync") cls = "bg-purple-500/15 text-purple-600 dark:text-purple-400";
  else if (s === "stock-sync") cls = "bg-green-500/15 text-green-600 dark:text-green-400";
  else if (s === "low-margin-guard") cls = "bg-orange-500/15 text-orange-600 dark:text-orange-400";
  else if (s === "revert") cls = "bg-red-500/15 text-red-600 dark:text-red-400";
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{s}</span>;
}

function truncate(v: string | null, n = 40) {
  if (v == null) return "—";
  return v.length > n ? v.slice(0, n) + "…" : v;
}

export function ActivityFeed() {
  const [rows, setRows] = useState<ChangeLogRow[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const loadInitial = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("product_change_log")
      .select("id, master_product_id, field_name, old_value, new_value, source, created_at")
      .order("created_at", { ascending: false })
      .limit(60);
    if (data) {
      setRows(data as ChangeLogRow[]);
      const ids = [...new Set(data.map((r) => r.master_product_id))];
      if (ids.length) {
        const { data: mps } = await supabase.from("master_products").select("id, title").in("id", ids);
        if (mps) {
          const map: Record<string, string> = {};
          for (const m of mps) map[m.id] = m.title;
          setTitles(map);
        }
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadInitial();
    const channel = supabase
      .channel("monitoring-change-log")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "product_change_log" },
        async (payload) => {
          const row = payload.new as ChangeLogRow;
          if (!titles[row.master_product_id]) {
            const { data: mp } = await supabase.from("master_products").select("title").eq("id", row.master_product_id).maybeSingle();
            if (mp) setTitles((prev) => ({ ...prev, [row.master_product_id]: mp.title }));
          }
          setRows((prev) => [row, ...prev].slice(0, 60));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0];
    return rows.filter((r) => f.match(r.field_name, r.source ?? ""));
  }, [rows, filter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            variant={filter === f.key ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Ingen aktivitet</p>
      ) : (
        <div className="max-h-[520px] overflow-y-auto divide-y divide-border">
          {filtered.map((r) => (
            <div key={r.id} className="py-2 flex items-start gap-3 text-sm">
              <div className="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">
                {formatDistanceToNow(new Date(r.created_at), { locale: da, addSuffix: false })}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link to={`/products/${r.master_product_id}`} className="font-medium text-foreground hover:underline truncate max-w-[280px]">
                    {titles[r.master_product_id] ?? r.master_product_id.slice(0, 8)}
                  </Link>
                  <span className="text-xs text-muted-foreground font-mono">{r.field_name}</span>
                  {sourceBadge(r.source)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                  <span className="line-through">{truncate(r.old_value)}</span>
                  {" → "}
                  <span className="text-foreground">{truncate(r.new_value)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
