import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2, RefreshCw } from "lucide-react";

type DuplicateProduct = {
  id: string;
  title: string | null;
  sku: string | null;
  image_url: string | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  lifecycle_status: string | null;
  last_shopify_sync_at: string | null;
  updated_at: string | null;
};

type DuplicateGroup = {
  ean: string;
  products: DuplicateProduct[];
};

function useDuplicateEans() {
  return useQuery({
    queryKey: ["duplicate-eans"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_duplicate_eans");
      if (error) throw error;
      return (data ?? []) as DuplicateGroup[];
    },
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("da-DK", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function DuplicateGroupCard({
  group,
  onResolved,
}: {
  group: DuplicateGroup;
  onResolved: () => void;
}) {
  const [selected, setSelected] = useState<string>(group.products[0]?.id ?? "");
  const [pending, setPending] = useState<"resolve" | "clear" | null>(null);
  const { toast } = useToast();

  async function triggerPullFor(ids: string[]) {
    await Promise.all(
      ids.map((id) =>
        supabase.functions.invoke("shopify-pull", {
          body: { master_product_id: id },
        }).catch(() => null),
      ),
    );
  }

  async function handleResolve(keepId: string | null) {
    setPending(keepId ? "resolve" : "clear");
    try {
      const { data, error } = await supabase.rpc("resolve_duplicate_ean", {
        p_ean: group.ean,
        p_keep_id: keepId,
      });
      if (error) throw error;
      const cleared = ((data as { cleared_ids?: string[] })?.cleared_ids ?? []).filter(
        (id) => group.products.find((p) => p.id === id)?.shopify_product_id,
      );
      if (cleared.length > 0) triggerPullFor(cleared);
      toast({
        title: keepId ? "EAN-konflikt løst" : "EAN ryddet",
        description: keepId
          ? `EAN ${group.ean} beholdes på det valgte produkt. ${cleared.length} produkter genhentes fra Shopify.`
          : `EAN ${group.ean} er ryddet på alle produkter.`,
      });
      onResolved();
    } catch (err) {
      toast({
        title: "Kunne ikke gemme",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <CardTitle className="font-mono text-base">{group.ean}</CardTitle>
          <Badge variant="secondary">{group.products.length} produkter</Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={pending !== null}
          onClick={() => handleResolve(null)}
        >
          {pending === "clear" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Ryd EAN på alle"
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup value={selected} onValueChange={setSelected} className="space-y-2">
          {group.products.map((p) => (
            <label
              key={p.id}
              htmlFor={`${group.ean}-${p.id}`}
              className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                selected === p.id ? "border-primary bg-accent/40" : "hover:bg-accent/20"
              }`}
            >
              <RadioGroupItem
                value={p.id}
                id={`${group.ean}-${p.id}`}
                className="mt-1"
              />
              {p.image_url ? (
                <img
                  src={p.image_url}
                  alt=""
                  className="h-12 w-12 rounded object-cover bg-muted"
                />
              ) : (
                <div className="h-12 w-12 rounded bg-muted" />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/products/${p.id}`}
                    className="font-medium hover:underline truncate"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.title || "(uden titel)"}
                  </Link>
                  {p.lifecycle_status && p.lifecycle_status !== "active" && (
                    <Badge variant="outline" className="text-xs">
                      {p.lifecycle_status}
                    </Badge>
                  )}
                  {p.shopify_product_id && (
                    <Badge variant="secondary" className="text-xs gap-1">
                      Shopify <ExternalLink className="h-3 w-3" />
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                  {p.sku && <span>SKU: {p.sku}</span>}
                  <span>Sidst opdateret: {formatDate(p.updated_at)}</span>
                  {p.last_shopify_sync_at && (
                    <span>Sidste Shopify-pull: {formatDate(p.last_shopify_sync_at)}</span>
                  )}
                </div>
              </div>
            </label>
          ))}
        </RadioGroup>
        <div className="flex justify-end">
          <Button
            disabled={!selected || pending !== null}
            onClick={() => handleResolve(selected)}
          >
            {pending === "resolve" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Behold på valgte, ryd øvrige
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DuplicateEansPage() {
  const qc = useQueryClient();
  const { data, isLoading, isFetching, refetch } = useDuplicateEans();

  const totalConflicts = data?.length ?? 0;
  const totalProducts = useMemo(
    () => (data ?? []).reduce((n, g) => n + g.products.length, 0),
    [data],
  );

  const handleResolved = () => {
    qc.invalidateQueries({ queryKey: ["duplicate-eans"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

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
            <h1 className="text-2xl font-semibold">Dublet-EAN'er</h1>
            <p className="text-sm text-muted-foreground">
              Vælg hvilket produkt der beholder EAN'et. De øvrige nulstilles med en midlertidig
              placeholder, så Shopify-pull kan hente den rigtige barcode.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Opdater
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : totalConflicts === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Ingen EAN-konflikter fundet 🎉
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="text-sm text-muted-foreground">
            {totalConflicts} konflikter fordelt på {totalProducts} produkter.
          </div>
          <div className="space-y-4">
            {(data ?? []).map((group) => (
              <DuplicateGroupCard
                key={group.ean}
                group={group}
                onResolved={handleResolved}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
