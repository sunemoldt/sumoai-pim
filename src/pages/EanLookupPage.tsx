import { ScanBarcode } from "lucide-react";
import { SupplierEanLookupPanel } from "@/components/SupplierEanLookupDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function EanLookupPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">EAN-opslag</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Slå et EAN op og se lager og priser på tværs af leverandører. Beregn udsalgspris ud fra en valgt avance.
        </p>
      </div>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ScanBarcode className="h-4 w-4" /> Søg
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SupplierEanLookupPanel />
        </CardContent>
      </Card>
    </div>
  );
}
