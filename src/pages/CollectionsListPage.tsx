import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Loader2, FolderTree, BarChart3 } from "lucide-react";
import { toast } from "sonner";

interface Collection {
  id: string;
  shopify_collection_id: string;
  handle: string | null;
  title: string;
  collection_type: string;
  products_count: number;
  meta_title: string | null;
  meta_description: string | null;
  last_shopify_sync_at: string | null;
  views_30d: number;
  sessions_30d: number;
  analytics_updated_at: string | null;
}

export default function CollectionsListPage() {
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const queryClient = useQueryClient();

  const { data: collections = [], isLoading } = useQuery({
    queryKey: ["shopify_collections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shopify_collections")
        .select("*")
        .order("title", { ascending: true });
      if (error) throw error;
      return data as Collection[];
    },
  });

  const filtered = collections.filter((c) =>
    !search || c.title.toLowerCase().includes(search.toLowerCase()) || c.handle?.toLowerCase().includes(search.toLowerCase())
  );

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-collections-pull");
      if (error) throw error;
      toast.success(`Synced ${data?.collections_upserted ?? 0} kategorier`);
      queryClient.invalidateQueries({ queryKey: ["shopify_collections"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync fejlede");
    } finally {
      setSyncing(false);
    }
  };

  const handleFetchStats = async () => {
    setLoadingStats(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-collection-analytics");
      if (error) throw error;
      toast.success(`Statistik opdateret på ${data?.collections_updated ?? 0} kategorier (${data?.collections_with_data ?? 0} med trafik)`);
      queryClient.invalidateQueries({ queryKey: ["shopify_collections"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Hent statistik fejlede");
    } finally {
      setLoadingStats(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FolderTree className="h-6 w-6 text-primary" />
            Kategorier
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Shopify Collections. Shopify er master — hent data ind og rediger beskrivelse/SEO herfra.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleFetchStats} disabled={loadingStats}>
            {loadingStats ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart3 className="h-4 w-4 mr-2" />}
            Hent statistik (30 dg)
          </Button>
          <Button onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sync fra Shopify
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alle kategorier ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Søg efter titel eller handle…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-4 max-w-md"
          />

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Ingen kategorier endnu. Klik "Sync fra Shopify" for at hente dem.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Titel</TableHead>
                  <TableHead>Handle</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Produkter</TableHead>
                  <TableHead className="text-right">Besøg 30d</TableHead>
                  <TableHead className="text-right">Sessions 30d</TableHead>
                  <TableHead>SEO</TableHead>
                  <TableHead>Sidst synket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell className="font-medium">
                      <Link to={`/collections/${c.id}`} className="hover:underline">
                        {c.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{c.handle}</TableCell>
                    <TableCell>
                      <Badge variant={c.collection_type === "smart" ? "secondary" : "outline"}>
                        {c.collection_type === "smart" ? "Smart" : "Manuel"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{c.products_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{(c.views_30d ?? 0).toLocaleString("da-DK")}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{(c.sessions_30d ?? 0).toLocaleString("da-DK")}</TableCell>
                    <TableCell>
                      {c.meta_title || c.meta_description ? (
                        <Badge variant="outline" className="text-green-600">Sat</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Tom</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.last_shopify_sync_at ? new Date(c.last_shopify_sync_at).toLocaleString("da-DK") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
