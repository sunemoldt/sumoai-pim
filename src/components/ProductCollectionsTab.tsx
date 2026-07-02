import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, FolderTree } from "lucide-react";
import { toast } from "sonner";

interface Props {
  masterProductId: string;
  shopifyLinked: boolean;
}

export default function ProductCollectionsTab({ masterProductId, shopifyLinked }: Props) {
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: allCollections = [], isLoading } = useQuery({
    queryKey: ["shopify_collections_for_product"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shopify_collections")
        .select("id, title, handle, collection_type")
        .order("title", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: memberships = [] } = useQuery({
    queryKey: ["product_collections", masterProductId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("master_product_collections")
        .select("collection_id")
        .eq("master_product_id", masterProductId);
      if (error) throw error;
      return data.map((r) => r.collection_id);
    },
    enabled: !!masterProductId,
  });

  const memberSet = new Set(memberships);

  const filtered = allCollections.filter((c) =>
    !search || c.title.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = async (collectionId: string, isMember: boolean, isSmart: boolean) => {
    if (isSmart) {
      toast.error("Smart collections styres automatisk af Shopify");
      return;
    }
    if (!shopifyLinked) {
      toast.error("Produktet skal være linket til Shopify først");
      return;
    }
    setPending(collectionId);
    try {
      const fn = isMember ? "shopify-collection-remove-product" : "shopify-collection-add-product";
      const { error } = await supabase.functions.invoke(fn, {
        body: { collection_id: collectionId, master_product_id: masterProductId },
      });
      if (error) throw error;
      toast.success(isMember ? "Fjernet" : "Tilføjet");
      queryClient.invalidateQueries({ queryKey: ["product_collections", masterProductId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke opdatere");
    } finally {
      setPending(null);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <FolderTree className="h-4 w-4" />
          Kategorier (Shopify Collections)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!shopifyLinked && (
          <p className="text-sm text-amber-600">Produktet skal være linket til Shopify før du kan tilknytte kategorier.</p>
        )}
        <Input
          placeholder="Søg efter kategori…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Ingen kategorier hentet endnu. Gå til "Kategorier" i menuen og klik Sync.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto space-y-1 border rounded-md p-2">
            {filtered.map((c) => {
              const isMember = memberSet.has(c.id);
              const isSmart = c.collection_type === "smart";
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
                    isSmart ? "opacity-60 cursor-not-allowed" : "hover:bg-muted cursor-pointer"
                  }`}
                >
                  <Checkbox
                    checked={isMember}
                    disabled={isSmart || pending === c.id || !shopifyLinked}
                    onCheckedChange={() => toggle(c.id, isMember, isSmart)}
                  />
                  <span className="flex-1">{c.title}</span>
                  {isSmart && <Badge variant="secondary" className="text-xs">Smart</Badge>}
                  {pending === c.id && <Loader2 className="h-3 w-3 animate-spin" />}
                </label>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
