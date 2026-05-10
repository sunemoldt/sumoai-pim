import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, ExternalLink } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type Lifecycle = "draft" | "pending_activation" | "active" | "archived";

const LABELS: Record<Lifecycle, string> = {
  draft: "Kladde",
  pending_activation: "Afventer aktivering",
  active: "Aktiv",
  archived: "Arkiveret",
};

const STYLES: Record<Lifecycle, string> = {
  draft: "border-muted-foreground/40 text-muted-foreground",
  pending_activation: "border-warning/40 text-warning",
  active: "border-success/40 text-success",
  archived: "border-destructive/40 text-destructive",
};

export function LifecycleBadge({ status }: { status: string }) {
  const s = (status as Lifecycle) ?? "active";
  return (
    <Badge variant="outline" className={STYLES[s] ?? STYLES.active}>
      {LABELS[s] ?? status}
    </Badge>
  );
}

export function SendToShopifyButton({ product }: { product: { id: string; lifecycle_status?: string; shopify_product_id?: string | null } }) {
  const [loading, setLoading] = useState(false);
  const [adminUrl, setAdminUrl] = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const lifecycle = (product as any).lifecycle_status ?? "active";

  if (lifecycle !== "draft") {
    if (lifecycle === "pending_activation") {
      return (
        <Badge variant="outline" className="border-warning/40 text-warning gap-1">
          Afventer aktivering i Shopify
        </Badge>
      );
    }
    return null;
  }

  const send = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("shopify-create-product", {
      body: { master_product_id: product.id },
    });
    setLoading(false);
    if (error || data?.error) {
      toast({ title: "Fejl", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    setAdminUrl(data?.shopify_admin_url ?? null);
    toast({ title: "Oprettet i Shopify som kladde", description: data?.message });
    qc.invalidateQueries({ queryKey: ["master_product", product.id] });
    qc.invalidateQueries({ queryKey: ["master_products"] });
  };

  return (
    <div className="flex items-center gap-2">
      <Button onClick={send} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
        Send til Shopify (kladde)
      </Button>
      {adminUrl && (
        <Button variant="outline" size="icon" asChild>
          <a href={adminUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /></a>
        </Button>
      )}
    </div>
  );
}
