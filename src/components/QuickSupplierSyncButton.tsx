import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Props = {
  productId: string;
  supplierIds: string[];
  variant?: "icon" | "full";
};

export default function QuickSupplierSyncButton({ productId, supplierIds, variant = "full" }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const uniqueIds = Array.from(new Set(supplierIds.filter(Boolean)));

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (uniqueIds.length === 0) {
      toast({ title: "Ingen leverandører", description: "Produktet er ikke koblet til nogen leverandører.", variant: "destructive" });
      return;
    }
    setSyncing(true);
    const results = await Promise.allSettled(
      uniqueIds.map((supplier_id) =>
        supabase.functions.invoke("supplier-feed-import", { body: { supplier_id } })
      )
    );
    setSyncing(false);
    const ok = results.filter((r) => r.status === "fulfilled" && !(r.value as any)?.error).length;
    const failed = results.length - ok;
    toast({
      title: failed === 0 ? "Synk fuldført" : "Synk delvist gennemført",
      description: `${ok}/${results.length} leverandør-feeds opdateret${failed > 0 ? `, ${failed} fejlede` : ""}.`,
      variant: failed === 0 ? "default" : "destructive",
    });
    qc.invalidateQueries({ queryKey: ["master_products"] });
    qc.invalidateQueries({ queryKey: ["master_product", productId] });
  };

  if (variant === "icon") {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={handleClick}
              disabled={syncing || uniqueIds.length === 0}
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p>Synk {uniqueIds.length} leverandør{uniqueIds.length !== 1 ? "er" : ""} for dette produkt</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2 h-8 w-full shrink-0 gap-1.5 text-xs font-medium"
            onClick={handleClick}
            disabled={syncing || uniqueIds.length === 0}
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{syncing ? "Synker…" : `Synk leverandører (${uniqueIds.length})`}</span>
            <span className="sm:hidden">{syncing ? "…" : `Synk (${uniqueIds.length})`}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Hent friske data fra alle leverandører der har dette produkt</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
