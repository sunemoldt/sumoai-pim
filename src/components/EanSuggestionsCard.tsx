import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Lightbulb } from "lucide-react";

export default function EanSuggestionsCard() {
  const { data } = useQuery({
    queryKey: ["ean-suggestions", "count"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_ean_suggestions");
      if (error) throw error;
      return (data ?? []) as unknown[];
    },
    staleTime: 60 * 1000,
  });

  const count = data?.length ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <Lightbulb
            className={`h-4 w-4 ${count > 0 ? "text-amber-500" : "text-muted-foreground"}`}
          />
          <CardTitle className="text-base">EAN-forslag fra Shopify</CardTitle>
          {count > 0 && <Badge>{count}</Badge>}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/ean-suggestions">
            Åbn <ChevronRight className="h-4 w-4 ml-1" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {count === 0
          ? "Ingen forslag — alle produkter har gyldige EAN'er."
          : `${count} produkt${count === 1 ? "" : "er"} har ugyldig EAN, hvor Shopify har en gyldig barcode klar til godkendelse.`}
      </CardContent>
    </Card>
  );
}
