import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

interface Props {
  breakdown: Record<string, number>;
}

const FAMILY_ORDER = ["Leverandør", "Shopify", "Lager", "Guard", "Manuel", "Andet"];
const FAMILY_COLORS: Record<string, string> = {
  Leverandør: "hsl(217 91% 60%)",
  Shopify: "hsl(280 65% 60%)",
  Lager: "hsl(142 71% 45%)",
  Guard: "hsl(25 95% 55%)",
  Manuel: "hsl(220 9% 55%)",
  Andet: "hsl(220 9% 40%)",
};

function familyOf(source: string): string {
  if (source.startsWith("supplier:") || source === "supplier-rematch") return "Leverandør";
  if (source.startsWith("shopify") || source === "sibling-shared-sync") return "Shopify";
  if (source === "stock-sync") return "Lager";
  if (source === "low-margin-guard") return "Guard";
  if (source === "manual" || source === "auto-pim-edit" || source === "revert" || source.startsWith("shopify-pull-split")) return "Manuel";
  return "Andet";
}

export function SourceDonut({ breakdown }: Props) {
  const data = useMemo(() => {
    const agg = new Map<string, number>();
    for (const [src, cnt] of Object.entries(breakdown ?? {})) {
      const fam = familyOf(src);
      agg.set(fam, (agg.get(fam) ?? 0) + Number(cnt));
    }
    return FAMILY_ORDER
      .filter((f) => agg.has(f))
      .map((f) => ({ name: f, value: agg.get(f)! }));
  }, [breakdown]);

  const total = data.reduce((a, b) => a + b.value, 0);

  if (total === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Ingen ændringer i sidste 24t</p>;
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={FAMILY_COLORS[entry.name]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number) => [`${v.toLocaleString("da-DK")} ændringer`, ""]}
            contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
