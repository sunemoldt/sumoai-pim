import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Loader2, RefreshCw, Search, ExternalLink, Truck } from "lucide-react";
import { toast } from "sonner";

type UnmatchedRow = {
  ean: string;
  title: string | null;
  supplier_sku: string | null;
  brand: string | null;
  purchase_price: number | null;
  stock_quantity: number | null;
  in_stock: boolean;
};

type UnmatchedResult = {
  supplier_name: string;
  total_rows: number;
  unmatched_count: number;
  unmatched: UnmatchedRow[];
};

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<UnmatchedResult | null>(null);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState("linked");

  const { data: supplier, isLoading: loadingSupplier } = useQuery({
    queryKey: ["supplier", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: linkedProducts = [], isLoading: loadingLinked } = useQuery({
    queryKey: ["supplier_linked_products", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_products")
        .select("id, purchase_price, stock_quantity, in_stock, supplier_sku, master_product_id, master_products(id, title, ean, brand, image_url, webshop_price)")
        .eq("supplier_id", id!)
        .order("purchase_price", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id,
  });

  const runUnmatched = async () => {
    if (!id) return;
    setRunning(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("supplier-feed-import", {
        body: { supplier_id: id, mode: "unmatched" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data as UnmatchedResult);
      toast.success(`Fandt ${data.unmatched_count} produkter der ikke er tilknyttet`);
    } catch (err: any) {
      toast.error(err?.message || "Kunne ikke hente feed");
    } finally {
      setRunning(false);
    }
  };

  const filtered = result?.unmatched.filter((r) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      r.ean.includes(q) ||
      (r.title ?? "").toLowerCase().includes(q) ||
      (r.supplier_sku ?? "").toLowerCase().includes(q) ||
      (r.brand ?? "").toLowerCase().includes(q)
    );
  }) ?? [];

  const filteredLinked = linkedProducts.filter((sp) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    const m = sp.master_products;
    return (
      (m?.title ?? "").toLowerCase().includes(q) ||
      (m?.ean ?? "").toLowerCase().includes(q) ||
      (sp.supplier_sku ?? "").toLowerCase().includes(q)
    );
  });

  const formatPrice = (v: number | null) =>
    v == null ? "—" : new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" }).format(v);

  if (loadingSupplier) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!supplier) {
    return <p className="text-muted-foreground">Leverandør ikke fundet</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/suppliers")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <Truck className="h-5 w-5 text-muted-foreground" />
              {supplier.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {supplier.feed_type?.toUpperCase()} · {linkedProducts.length} tilknyttede produkter
              {supplier.last_sync_at && (
                <> · Sidst synkroniseret {new Date(supplier.last_sync_at).toLocaleString("da-DK")}</>
              )}
            </p>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="linked">Tilknyttede ({linkedProducts.length})</TabsTrigger>
          <TabsTrigger value="unmatched">Ikke tilknyttet{result ? ` (${result.unmatched_count})` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="linked" className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Søg titel, EAN eller SKU..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-8"
            />
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produkt</TableHead>
                      <TableHead>EAN</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Indkøb</TableHead>
                      <TableHead className="text-right">Lager</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingLinked ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Indlæser...</TableCell></TableRow>
                    ) : filteredLinked.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Ingen tilknyttede produkter</TableCell></TableRow>
                    ) : filteredLinked.map((sp) => (
                      <TableRow key={sp.id}>
                        <TableCell className="font-medium">{sp.master_products?.title ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{sp.master_products?.ean ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{sp.supplier_sku ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatPrice(sp.purchase_price)}</TableCell>
                        <TableCell className="text-right">
                          {sp.in_stock ? (
                            <Badge variant="outline" className="text-success border-success/30">{sp.stock_quantity ?? "På lager"}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">Udsolgt</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {sp.master_product_id && (
                            <Link to={`/products/${sp.master_product_id}`}>
                              <Button variant="ghost" size="icon"><ExternalLink className="h-4 w-4" /></Button>
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="unmatched" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Produkter i feed uden tilknyttet PIM-produkt</CardTitle>
              <p className="text-sm text-muted-foreground">
                Kør analyse for at hente leverandørens feed og finde EAN'er der ikke matcher et eksisterende produkt i PIM.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={runUnmatched} disabled={running}>
                  {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  {result ? "Kør igen" : "Analysér feed"}
                </Button>
                {result && (
                  <p className="text-sm text-muted-foreground">
                    {result.unmatched_count} af {result.total_rows} feed-linjer er ikke tilknyttet.
                  </p>
                )}
              </div>

              {result && (
                <>
                  <div className="relative max-w-md">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Søg EAN, titel eller SKU..."
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>EAN</TableHead>
                          <TableHead>Titel</TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead>Brand</TableHead>
                          <TableHead className="text-right">Indkøb</TableHead>
                          <TableHead className="text-right">Lager</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                              Ingen resultater
                            </TableCell>
                          </TableRow>
                        ) : filtered.slice(0, 500).map((r) => (
                          <TableRow key={r.ean + r.supplier_sku}>
                            <TableCell className="font-mono text-xs">{r.ean}</TableCell>
                            <TableCell className="max-w-[280px] truncate">{r.title ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs">{r.supplier_sku ?? "—"}</TableCell>
                            <TableCell className="text-xs">{r.brand ?? "—"}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{formatPrice(r.purchase_price)}</TableCell>
                            <TableCell className="text-right">
                              {r.in_stock ? (
                                <Badge variant="outline" className="text-success border-success/30 text-xs">
                                  {r.stock_quantity ?? "På lager"}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-muted-foreground text-xs">Udsolgt</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {filtered.length > 500 && (
                      <p className="text-xs text-muted-foreground py-3 text-center">
                        Viser 500 af {filtered.length} — brug søgefelt for at indsnævre.
                      </p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
