import { usePriceSettings, useWebhookConfigs } from "@/hooks/use-products";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function SettingsPage() {
  const { data: priceSettings = [] } = usePriceSettings();
  const { data: webhooks = [] } = useWebhookConfigs();

  const scopeLabels: Record<string, string> = {
    global: "Global",
    brand: "Brand",
    product: "Produkt",
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Indstillinger</h1>
        <p className="text-sm text-muted-foreground mt-1">Administrer avanceprocenter og webhooks</p>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Avanceprocenter (Markup)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50">
                <TableHead>Niveau</TableHead>
                <TableHead>Værdi</TableHead>
                <TableHead className="text-right">Markup %</TableHead>
                <TableHead className="text-right">Minimum avance %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {priceSettings.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Badge variant="secondary">{scopeLabels[s.scope] ?? s.scope}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.scope_value ?? "Alle"}</TableCell>
                  <TableCell className="text-right font-mono text-foreground">{s.markup_percentage}%</TableCell>
                  <TableCell className="text-right font-mono text-foreground">{s.minimum_margin}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Webhook-konfiguration (n8n)</CardTitle>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Ingen webhooks konfigureret endnu</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/50">
                  <TableHead>Navn</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Hændelser</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium text-foreground">{w.name}</TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono max-w-[200px] truncate">{w.url}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {w.event_types.map((e) => (
                          <Badge key={e} variant="outline" className="text-xs">{e}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {w.is_active ? (
                        <Badge variant="outline" className="text-success border-success/30">Aktiv</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Inaktiv</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
