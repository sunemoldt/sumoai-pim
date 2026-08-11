import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Image, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Result = {
  checked: number;
  candidates: number;
  updated: number;
  unresolved: number;
  unresolved_products?: { id: string; title: string }[];
};

export function ShopifyRefreshImagesCard() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = async (onlyBroken: boolean) => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-refresh-images", {
        body: { only_broken: onlyBroken },
      });
      if (error) throw error;
      setResult(data as Result);
      toast({
        title: "Billeder opdateret",
        description: `${(data as Result).updated} produkter fik ny billed-URL fra Shopify.`,
      });
    } catch (e) {
      toast({
        title: "Kunne ikke opdatere billeder",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Genindlæs produktbilleder fra Shopify</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Når et billede udskiftes eller slettes i Shopify, peger PIM's gemte billed-URL på en fil der
          ikke findes længere, og billedet vises som tomt. Her hentes den aktuelle billed-URL igen.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => run(true)} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Image className="mr-2 h-4 w-4" />}
            Reparer døde billeder
          </Button>
          <Button variant="outline" onClick={() => run(false)} disabled={running}>
            Genindlæs alle
          </Button>
        </div>
        {result && (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              Kontrolleret {result.checked} · opdateret {result.updated} · uden billede i Shopify{" "}
              {result.unresolved}
            </p>
            {!!result.unresolved_products?.length && (
              <ul className="list-inside list-disc">
                {result.unresolved_products.slice(0, 10).map((p) => (
                  <li key={p.id}>{p.title}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
