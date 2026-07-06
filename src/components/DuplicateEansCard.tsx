import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ChevronRight } from "lucide-react";

export default function DuplicateEansCard() {
  const { data } = useQuery({
    queryKey: ["duplicate-eans", "count"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_duplicate_eans");
      if (error) throw error;
      return (data ?? []) as { ean: string; products: unknown[] }[];
    },
    staleTime: 60 * 1000,
  });

  const count = data?.length ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className={`h-4 w-4 ${count > 0 ? "text-amber-500" : "text-muted-foreground"}`}
          />
          <CardTitle className="text-base">Dublet-EAN'er</CardTitle>
          {count > 0 && <Badge variant="destructive">{count}</Badge>}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/duplicate-eans">
            Åbn <ChevronRight className="h-4 w-4 ml-1" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {count === 0
          ? "Ingen produkter deler EAN. Alt er unikt."
          : `${count} EAN${count === 1 ? "" : "'er"} bruges af flere produkter — vælg hvilket der er korrekt.`}
      </CardContent>
    </Card>
  );
}
