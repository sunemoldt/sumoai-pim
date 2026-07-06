import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, Check, Loader2, RefreshCw } from "lucide-react";

type Suggestion = {
  master_product_id: string;
  title: string | null;
  sku: string | null;
  image_url: string | null;
  current_ean: string | null;
  suggested_ean: string;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  updated_at: string | null;
};

function useSuggestions() {
  return useQuery({
    queryKey: ["ean-suggestions"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_ean_suggestions");
      if (error) throw error;
      return (data ?? []) as Suggestion[];
    },
  });
}

export default function EanSuggestionsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isFetching, refetch } = useSuggestions();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [scanState, setScanState] = useState<{ running: boolean; done: number; total: number }>({
    running: false,
    done: 0,
    total: 0,
  });
  const { toast } = useToast();

  async function scanShopify() {
    const { data: ids, error } = await supabase.rpc("list_invalid_ean_product_ids");
    if (error || !ids?.length) {
      toast({
        title: error ? "Kunne ikke hente liste" : "Intet at scanne",
        description: error?.message,
        variant: error ? "destructive" : "default",
      });
      return;
    }
    setScanState({ running: true, done: 0, total: ids.length });
    let done = 0;
    // Small parallelism to avoid rate-limiting Shopify
    const concurrency = 4;
    const queue = [...ids] as { id: string }[];
    async function worker() {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) return;
        await supabase.functions
          .invoke("shopify-pull", { body: { master_product_id: item.id } })
          .catch(() => null);
        done += 1;
        setScanState({ running: true, done, total: ids.length });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    setScanState({ running: false, done: ids.length, total: ids.length });
    toast({
      title: "Shopify-scan færdig",
      description: `${ids.length} produkter blev tjekket. Placeholder-EAN'er (wc-*) er auto-opdateret. Øvrige forslag vises nedenfor.`,
    });
    qc.invalidateQueries({ queryKey: ["ean-suggestions"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  async function approve(id: string, ean: string) {
    setPendingId(id);
    try {
      const { error } = await supabase.rpc("approve_ean_suggestion", {
        p_master_id: id,
        p_ean: ean,
      });
      if (error) throw error;
      toast({ title: "EAN godkendt", description: ean });
      qc.invalidateQueries({ queryKey: ["ean-suggestions"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      toast({
        title: "Kunne ikke godkende",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  }

  async function approveAll() {
    if (!data?.length) return;
    setBulkPending(true);
    let ok = 0;
    let fail = 0;
    for (const s of data) {
      const { error } = await supabase.rpc("approve_ean_suggestion", {
        p_master_id: s.master_product_id,
        p_ean: s.suggested_ean,
      });
      if (error) fail += 1;
      else ok += 1;
    }
    toast({
      title: "Bulk-godkendelse færdig",
      description: `${ok} godkendt${fail ? `, ${fail} fejlede` : ""}`,
      variant: fail ? "destructive" : "default",
    });
    setBulkPending(false);
    qc.invalidateQueries({ queryKey: ["ean-suggestions"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  const suggestions = data ?? [];

  return (
    <div className="container mx-auto max-w-4xl py-6 space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/settings">
              <ArrowLeft className="h-4 w-4 mr-1" /> Indstillinger
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">EAN-forslag fra Shopify</h1>
            <p className="text-sm text-muted-foreground">
              Produkter med ugyldig eller manglende EAN hvor Shopify har en gyldig barcode. Godkend
              for at overskrive PIM-værdien.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Opdater
          </Button>
          {suggestions.length > 0 && (
            <Button size="sm" disabled={bulkPending} onClick={approveAll}>
              {bulkPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Godkend alle ({suggestions.length})
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : suggestions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Ingen EAN-forslag. Alle produkter har gyldige EAN'er eller matcher Shopify.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {suggestions.map((s) => (
            <Card key={s.master_product_id}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  {s.image_url ? (
                    <img
                      src={s.image_url}
                      alt=""
                      className="h-12 w-12 rounded object-cover bg-muted"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base">
                      <Link
                        to={`/products/${s.master_product_id}`}
                        className="hover:underline"
                      >
                        {s.title || "(uden titel)"}
                      </Link>
                    </CardTitle>
                    {s.sku && (
                      <div className="text-xs text-muted-foreground">SKU: {s.sku}</div>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Nu:</span>
                    <Badge variant="outline" className="font-mono">
                      {s.current_ean || "(mangler)"}
                    </Badge>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Shopify:</span>
                    <Badge className="font-mono">{s.suggested_ean}</Badge>
                  </div>
                  <div className="ml-auto">
                    <Button
                      size="sm"
                      disabled={pendingId !== null || bulkPending}
                      onClick={() => approve(s.master_product_id, s.suggested_ean)}
                    >
                      {pendingId === s.master_product_id ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4 mr-2" />
                      )}
                      Godkend
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
