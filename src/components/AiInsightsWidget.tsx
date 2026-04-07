import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, RefreshCw, X, Sparkles, TrendingUp, Package, DollarSign, ShoppingCart } from "lucide-react";
import { useNavigate } from "react-router-dom";
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

const severityColors: Record<string, string> = {
  critical: "text-destructive border-destructive/30",
  warning: "text-warning border-warning/30",
  info: "text-primary border-primary/30",
};

export default function AiInsightsWidget() {
  const navigate = useNavigate();
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
        .limit(20);
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
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("product_recommendations")
        .update({ is_dismissed: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-recommendations"] });
    },
  });

  // Deduplicate by title (since one recommendation can span multiple products)
  const uniqueRecs = recommendations.reduce((acc, rec) => {
    if (!acc.find(r => r.title === rec.title)) acc.push(rec);
    return acc;
  }, [] as typeof recommendations);

  return (
    <Card className="shadow-sm border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI-indsigter
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
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Indlæser...</p>
        ) : uniqueRecs.length === 0 ? (
          <div className="text-center py-6">
            <Brain className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">Ingen AI-anbefalinger endnu</p>
            <p className="text-xs text-muted-foreground mt-1">Klik "Kør analyse" for at generere indsigter</p>
          </div>
        ) : (
          <div className="space-y-2">
            {uniqueRecs.slice(0, 6).map((rec) => (
              <div
                key={rec.id}
                className="rounded-md border border-border p-3 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <span className="mt-0.5 shrink-0">{typeIcons[rec.recommendation_type] ?? <Brain className="h-4 w-4" />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p
                          className="text-sm font-medium text-foreground cursor-pointer hover:underline"
                          onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                        >
                          {rec.title}
                        </p>
                        <Badge variant="outline" className={`text-[10px] ${severityColors[rec.severity] ?? ""}`}>
                          {typeLabels[rec.recommendation_type] ?? rec.recommendation_type}
                        </Badge>
                      </div>
                      {expandedId === rec.id && (
                        <div className="mt-2 space-y-2">
                          <p className="text-xs text-muted-foreground">{rec.description}</p>
                          {rec.action_suggestion && (
                            <p className="text-xs text-primary font-medium">→ {rec.action_suggestion}</p>
                          )}
                          {rec.master_products && (
                            <button
                              onClick={() => navigate(`/products/${(rec.master_products as any).id}`)}
                              className="text-xs text-primary hover:underline"
                            >
                              Se produkt: {(rec.master_products as any).title}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); dismissMutation.mutate(rec.id); }}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {uniqueRecs.length > 6 && (
              <p className="text-xs text-muted-foreground text-center pt-1">
                + {uniqueRecs.length - 6} flere anbefalinger
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
