import { useState } from "react";
import { useSuppliers } from "@/hooks/use-products";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, Plus, Pencil, Play } from "lucide-react";
import SupplierFormDialog from "@/components/SupplierFormDialog";
import SupplierMappingDialog from "@/components/SupplierMappingDialog";
import type { Supplier } from "@/hooks/use-products";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export default function SupplierListPage() {
  const { data: suppliers = [], isLoading } = useSuppliers();
  const [formOpen, setFormOpen] = useState(false);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [mappingSupplier, setMappingSupplier] = useState<Supplier | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const feedTypeLabels: Record<string, string> = {
    xml: "XML Feed",
    csv: "CSV Feed",
    manual: "Manuel",
  };

  const handleSync = async (supplier: Supplier) => {
    setSyncing(supplier.id);
    try {
      const { data, error } = await supabase.functions.invoke("supplier-feed-import", {
        body: { supplier_id: supplier.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`${data.imported ?? 0} produkter importeret fra ${supplier.name}`);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["master_products"] });
    } catch (err: any) {
      toast.error(err?.message || "Synkronisering fejlede");
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Leverandører</h1>
          <p className="text-sm text-muted-foreground mt-1">{suppliers.length} leverandører konfigureret</p>
        </div>
        <Button onClick={() => { setEditSupplier(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Opret leverandør
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50">
                <TableHead>Navn</TableHead>
                <TableHead>Feed type</TableHead>
                <TableHead>Feed URL / Fil</TableHead>
                <TableHead>Sidst synkroniseret</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Handlinger</TableHead>
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
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setMappingSupplier(s)}
                          title="Mapping"
                        >
                          Mapping
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => { setEditSupplier(s); setFormOpen(true); }}
                          title="Rediger"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={syncing === s.id}
                          onClick={() => handleSync(s)}
                          title="Synkroniser nu"
                        >
                          <Play className={`h-4 w-4 ${syncing === s.id ? "animate-spin" : ""}`} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SupplierFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        supplier={editSupplier}
      />

      {mappingSupplier && (
        <SupplierMappingDialog
          open={!!mappingSupplier}
          onOpenChange={(open) => { if (!open) setMappingSupplier(null); }}
          supplier={mappingSupplier}
        />
      )}
    </div>
  );
}
