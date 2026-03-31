import { useSuppliers } from "@/hooks/use-products";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck } from "lucide-react";

export default function SupplierListPage() {
  const { data: suppliers = [], isLoading } = useSuppliers();

  const feedTypeLabels: Record<string, string> = {
    xml: "XML Feed",
    csv: "CSV Feed",
    google_drive: "Google Drive",
    manual: "Manuel",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Leverandører</h1>
        <p className="text-sm text-muted-foreground mt-1">{suppliers.length} leverandører konfigureret</p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50">
                <TableHead>Navn</TableHead>
                <TableHead>Feed type</TableHead>
                <TableHead>Feed URL</TableHead>
                <TableHead>Tidsplan</TableHead>
                <TableHead>Sidst synkroniseret</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Indlæser...</TableCell>
                </TableRow>
              ) : suppliers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    <Truck className="mx-auto h-8 w-8 mb-2 opacity-40" />
                    Ingen leverandører konfigureret endnu
                  </TableCell>
                </TableRow>
              ) : (
                suppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium text-foreground">{s.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{feedTypeLabels[s.feed_type] ?? s.feed_type}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono max-w-[200px] truncate">
                      {s.feed_url ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono">{s.feed_schedule ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {s.last_sync_at ? new Date(s.last_sync_at).toLocaleString("da-DK") : "Aldrig"}
                    </TableCell>
                    <TableCell>
                      {s.is_active ? (
                        <Badge variant="outline" className="text-success border-success/30">Aktiv</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Inaktiv</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
