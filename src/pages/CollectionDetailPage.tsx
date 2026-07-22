import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Loader2, Save, Sparkles, X, Check, Plus, Search } from "lucide-react";
import { toast } from "sonner";


export default function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [descHtml, setDescHtml] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDesc, setMetaDesc] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDraft, setAiDraft] = useState<null | { description_html: string; meta_title: string; meta_description: string }>(null);


  const { data: collection, isLoading } = useQuery({
    queryKey: ["shopify_collection", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shopify_collections")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["collection_products", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("master_product_collections")
        .select("master_product_id, master_products(id, title, ean, sku, image_url, stock_quantity)")
        .eq("collection_id", id!);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.master_products).filter(Boolean);
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (collection) {
      setDescHtml(collection.description_html ?? "");
      setMetaTitle(collection.meta_title ?? "");
      setMetaDesc(collection.meta_description ?? "");
    }
  }, [collection]);

  const isSmart = collection?.collection_type === "smart";

  const runAi = async () => {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-rewrite-collection", {
        body: { collection_id: id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setAiDraft({
        description_html: (data as any).description_html ?? "",
        meta_title: (data as any).meta_title ?? "",
        meta_description: (data as any).meta_description ?? "",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI fejlede");
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiDraft = () => {
    if (!aiDraft) return;
    setDescHtml(aiDraft.description_html);
    setMetaTitle(aiDraft.meta_title);
    setMetaDesc(aiDraft.meta_description);
    setAiDraft(null);
    toast.success("AI-forslag indsat – husk at gemme");
  };

  const handleSave = async () => {

    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("shopify-collections-update", {
        body: {
          collection_id: id,
          description_html: descHtml,
          meta_title: metaTitle || null,
          meta_description: metaDesc || null,
        },
      });
      if (error) throw error;
      toast.success("Gemt og pushet til Shopify");
      queryClient.invalidateQueries({ queryKey: ["shopify_collection", id] });
      queryClient.invalidateQueries({ queryKey: ["shopify_collections"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gem fejlede");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (masterProductId: string) => {
    if (isSmart) return;
    try {
      const { error } = await supabase.functions.invoke("shopify-collection-remove-product", {
        body: { collection_id: id, master_product_id: masterProductId },
      });
      if (error) throw error;
      toast.success("Produkt fjernet");
      queryClient.invalidateQueries({ queryKey: ["collection_products", id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke fjerne");
    }
  };

  if (isLoading || !collection) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-4 max-w-5xl">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/collections")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Kategorier
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{collection.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={isSmart ? "secondary" : "outline"}>
              {isSmart ? "Smart collection" : "Manuel collection"}
            </Badge>
            <span className="text-sm text-muted-foreground">{collection.handle}</span>
          </div>
        </div>
      </div>

      {isSmart && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-3 text-sm text-amber-900 dark:text-amber-200">
          Smart collections styres af regler i Shopify. Metadata kan opdateres, men produkter tilføjes automatisk.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Beskrivelse & SEO</CardTitle>
          <Button variant="outline" size="sm" onClick={runAi} disabled={aiLoading}>
            {aiLoading ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-2" />}
            Generér med AI
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          <div>
            <Label>Beskrivelse (HTML tilladt)</Label>
            <Textarea
              value={descHtml}
              onChange={(e) => setDescHtml(e.target.value)}
              rows={6}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Meta titel (Page title)</Label>
            <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} maxLength={70} className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1">{metaTitle.length} / 70 tegn</p>
          </div>
          <div>
            <Label>Meta beskrivelse</Label>
            <Textarea
              value={metaDesc}
              onChange={(e) => setMetaDesc(e.target.value)}
              rows={3}
              maxLength={160}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">{metaDesc.length} / 160 tegn</p>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Gem & push til Shopify
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Produkter i kategorien ({products.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Ingen produkter matchet endnu.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Titel</TableHead>
                  <TableHead>EAN</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Lager</TableHead>
                  {!isSmart && <TableHead className="w-12"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {p.image_url ? (
                        <img src={p.image_url} alt="" className="h-8 w-8 rounded object-cover" />
                      ) : (
                        <div className="h-8 w-8 rounded bg-muted" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Link to={`/products/${p.id}`} className="hover:underline text-primary">
                        {p.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.ean}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.sku}</TableCell>
                    <TableCell className="text-right">{p.stock_quantity ?? 0}</TableCell>
                    {!isSmart && (
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => handleRemove(p.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={aiDraft !== null} onOpenChange={(o) => !o && setAiDraft(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>AI-forslag til kategoritekster</DialogTitle>
            <DialogDescription>
              Redigér forslaget hvis nødvendigt. Når du klikker "Brug forslag" indsættes det i felterne — du skal
              stadig klikke "Gem & push til Shopify" bagefter.
            </DialogDescription>
          </DialogHeader>
          {aiDraft && (
            <div className="space-y-4">
              <div>
                <Label>Beskrivelse (HTML)</Label>
                <Textarea
                  value={aiDraft.description_html}
                  onChange={(e) => setAiDraft({ ...aiDraft, description_html: e.target.value })}
                  rows={12}
                  className="mt-1 font-mono text-xs"
                />
              </div>
              <div>
                <Label>Meta titel</Label>
                <Input
                  value={aiDraft.meta_title}
                  onChange={(e) => setAiDraft({ ...aiDraft, meta_title: e.target.value })}
                  maxLength={70}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">{aiDraft.meta_title.length} / 70 tegn</p>
              </div>
              <div>
                <Label>Meta beskrivelse</Label>
                <Textarea
                  value={aiDraft.meta_description}
                  onChange={(e) => setAiDraft({ ...aiDraft, meta_description: e.target.value })}
                  rows={3}
                  maxLength={160}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">{aiDraft.meta_description.length} / 160 tegn</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAiDraft(null)}>Annullér</Button>
            <Button variant="outline" onClick={runAi} disabled={aiLoading}>
              {aiLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Generér igen
            </Button>
            <Button onClick={applyAiDraft}>
              <Check className="h-4 w-4 mr-2" />
              Brug forslag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

  );
}
