import { usePriceSettings, useWebhookConfigs, WebhookConfig } from "@/hooks/use-products";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Copy } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import WebhookFormDialog from "@/components/WebhookFormDialog";

export default function SettingsPage() {
  const { data: priceSettings = [] } = usePriceSettings();
  const { data: webhooks = [] } = useWebhookConfigs();
  const [formOpen, setFormOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookConfig | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const mcpUrl = `${supabaseUrl}/functions/v1/mcp-server`;

  const scopeLabels: Record<string, string> = {
    global: "Global",
    brand: "Brand",
    product: "Produkt",
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("webhook_configs").delete().eq("id", id);
    if (error) {
      toast({ title: "Fejl", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Webhook slettet" });
      qc.invalidateQueries({ queryKey: ["webhook_configs"] });
    }
  };

  const copyMcpUrl = () => {
    navigator.clipboard.writeText(mcpUrl);
    toast({ title: "MCP URL kopieret" });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Indstillinger</h1>
        <p className="text-sm text-muted-foreground mt-1">Administrer avanceprocenter, webhooks og MCP</p>
      </div>

      {/* Markup settings */}
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

      {/* Webhooks */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-medium">Webhooks (n8n / Make.com)</CardTitle>
          <Button size="sm" onClick={() => { setEditingWebhook(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Tilføj webhook
          </Button>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Ingen webhooks konfigureret endnu. Tilføj en n8n eller Make.com webhook for at automatisere flows.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/50">
                  <TableHead>Navn</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Hændelser</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Handlinger</TableHead>
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
                        <Badge variant="outline" className="text-green-600 border-green-300">Aktiv</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Inaktiv</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => { setEditingWebhook(w); setFormOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(w.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* MCP Server */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">MCP Server (AI-integration)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Comtek PIM fungerer som en MCP-server, som du kan forbinde til ChatGPT, Claude, Manus og andre AI-assistenter. De får adgang til at søge produkter, se lager, priser og leverandørdata.
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">MCP Server URL</label>
            <div className="flex gap-2">
              <code className="flex-1 rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs font-mono text-foreground break-all">
                {mcpUrl}
              </code>
              <Button size="icon" variant="outline" onClick={copyMcpUrl}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 p-4 space-y-2">
            <p className="text-sm font-medium text-foreground">Sådan forbinder du:</p>
            <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
              <li>Kopiér MCP Server URL'en ovenfor</li>
              <li>I din AI-assistent (f.eks. Claude Desktop), tilføj en ny MCP-server</li>
              <li>Brug URL'en som Streamable HTTP endpoint</li>
              <li>AI'en får nu adgang til dine produkter, priser og leverandørdata</li>
            </ol>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Tilgængelige MCP-tools:</p>
            <div className="flex flex-wrap gap-1">
              {["list_products", "search_products", "get_product", "list_suppliers", "get_price_info"].map((t) => (
                <Badge key={t} variant="secondary" className="font-mono text-xs">{t}</Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <WebhookFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        webhook={editingWebhook}
      />
    </div>
  );
}
