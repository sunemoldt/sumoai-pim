import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, RefreshCw, X, Sparkles, TrendingUp, Package, DollarSign, ShoppingCart, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const typeIcons: Record<string, React.ReactNode> = {
  pricing: <DollarSign className="h-4 w-4" />,
  stock: <Package className="h-4 w-4" />,
  conversion: <ShoppingCart className="h-4 w-4" />,
  margin: <TrendingUp className="h-4 w-4" />,
};

const typeLabels: Record<string, string> = {
  pricing: "Pris",
  stock: "Lager",
  conversion: "Konvertering",
  margin: "Avance",
};

const severityBg: Record<string, string> = {
  critical: "bg-destructive/10 border-destructive/20",
  warning: "bg-warning/10 border-warning/20",
  info: "bg-primary/5 border-primary/15",
};

const severityBadge: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive border-0",
  warning: "bg-warning/15 text-warning border-0",
  info: "bg-primary/10 text-primary border-0",
};

export default function AiInsightsWidget() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: recommendations = [], isLoading } = useQuery({
    queryKey: ["ai-recommendations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_recommendations")
        .select("*, master_products(id, title, ean)")
        .eq("is_dismissed", false)
        .in("recommendation_type", ["pricing", "stock", "conversion", "margin"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-analyze");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`AI-analyse fuldført: ${data.recommendations_count} anbefalinger genereret`);
      queryClient.invalidateQueries({ queryKey: ["ai-recommendations"] });
    },
    onError: (err: Error) => {
      toast.error(`Fejl: ${err.message}`);
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (title: string) => {
      // Dismiss all recs with same title
      const ids = recommendations.filter(r => r.title === title).map(r => r.id);
      for (const id of ids) {
        await supabase.from("product_recommendations").update({ is_dismissed: true }).eq("id", id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-recommendations"] });
    },
  });

  // Group by title: collect all related products per recommendation
  const grouped = recommendations.reduce((acc, rec) => {
    const existing = acc.find(r => r.title === rec.title);
    if (existing) {
      if (rec.master_products) {
        const mp = rec.master_products as any;
        if (!existing.products.find((p: any) => p.id === mp.id)) {
          existing.products.push(mp);
        }
      }
    } else {
      acc.push({
        ...rec,
        products: rec.master_products ? [rec.master_products as any] : [],
      });
    }
    return acc;
  }, [] as (typeof recommendations[0] & { products: { id: string; title: string; ean: string }[] })[]);

  const isExpanded = (title: string) => expandedId === title;

  return (
    <Card className="shadow-sm border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI-indsigter
            {grouped.length > 0 && (
              <Badge variant="secondary" className="text-[10px] font-normal">{grouped.length}</Badge>
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}
            className="h-7 text-xs"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${analyzeMutation.isPending ? "animate-spin" : ""}`} />
            {analyzeMutation.isPending ? "Analyserer..." : "Kør analyse"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Indlæser...</p>
        ) : grouped.length === 0 ? (
          <div className="text-center py-6">
            <Brain className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">Ingen AI-anbefalinger endnu</p>
            <p className="text-xs text-muted-foreground mt-1">Klik "Kør analyse" for at generere indsigter</p>
          </div>
        ) : (
          grouped.map((rec) => (
            <div
              key={rec.title}
              className={`rounded-lg border p-4 transition-colors ${severityBg[rec.severity] ?? "border-border"}`}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <span className="mt-0.5 shrink-0 text-muted-foreground">
                    {typeIcons[rec.recommendation_type] ?? <Brain className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h4 className="text-sm font-semibold text-foreground">{rec.title}</h4>
                      <Badge className={`text-[10px] ${severityBadge[rec.severity] ?? ""}`}>
                        {typeLabels[rec.recommendation_type] ?? rec.recommendation_type}
                      </Badge>
                      {rec.products.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {rec.products.length} produkt{rec.products.length !== 1 ? "er" : ""}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{rec.description}</p>

                    {rec.action_suggestion && (
                      <p className="text-xs font-medium text-primary mt-2 flex items-start gap-1">
                        <span className="shrink-0">→</span>
                        <span>{rec.action_suggestion}</span>
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => dismissMutation.mutate(rec.title)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Product list - always visible */}
              {rec.products.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border/50">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                    Berørte produkter
                  </p>
                  <div className="grid gap-1">
                    {rec.products.map((p) => (
                      <a
                        key={p.id}
                        href={`/products/${p.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-background/80 transition-colors group"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="text-foreground group-hover:text-primary transition-colors truncate block">
                            {p.title}
                          </span>
                          <span className="text-[10px] text-muted-foreground">EAN: {p.ean}</span>
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0 ml-2 transition-colors" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
