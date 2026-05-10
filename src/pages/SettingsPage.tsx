import { usePriceSettings, useWebhookConfigs, WebhookConfig } from "@/hooks/use-products";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Copy, Loader2, KeyRound, Calculator, Package, Save } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import WebhookFormDialog from "@/components/WebhookFormDialog";
import LanguageSettingsCard from "@/components/LanguageSettingsCard";
import FieldSyncPolicyCard from "@/components/FieldSyncPolicyCard";
import AttributeDefinitionsCard from "@/components/AttributeDefinitionsCard";
import ShopifyBulkPullCard from "@/components/ShopifyBulkPullCard";

export default function SettingsPage() {
  const { data: priceSettings = [] } = usePriceSettings();
  const { data: webhooks = [] } = useWebhookConfigs();
  const [formOpen, setFormOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookConfig | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [roundingMode, setRoundingMode] = useState("nearest_5");
  const [savingRounding, setSavingRounding] = useState(false);
  const [backorderMode, setBackorderMode] = useState("notify");
  const [savingBackorder, setSavingBackorder] = useState(false);

  // Load rounding + backorder settings
  useEffect(() => {
    supabase
      .from("price_settings")
      .select("scope, scope_value")
      .in("scope", ["price_rounding", "default_backorder"])
      .then(({ data }) => {
        for (const row of data ?? []) {
          if (row.scope === "price_rounding" && row.scope_value) setRoundingMode(row.scope_value);
          if (row.scope === "default_backorder" && row.scope_value) setBackorderMode(row.scope_value);
        }
      });
  }, []);
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

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Fejl", description: "Adgangskoderne matcher ikke", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Fejl", description: "Adgangskoden skal være mindst 8 tegn", variant: "destructive" });
      return;
    }
    setChangingPassword(true);
    // Verify current password by re-signing in
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user?.email ?? "",
      password: currentPassword,
    });
    if (signInError) {
      toast({ title: "Fejl", description: "Nuværende adgangskode er forkert", variant: "destructive" });
      setChangingPassword(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      toast({ title: "Fejl", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Adgangskode opdateret" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
    setChangingPassword(false);
  };

  const saveRoundingMode = async () => {
    setSavingRounding(true);
    try {
      const { data: existing } = await supabase
        .from("price_settings")
        .select("id")
        .eq("scope", "price_rounding")
        .maybeSingle();
      if (existing) {
        const { error } = await supabase.from("price_settings").update({ scope_value: roundingMode, updated_at: new Date().toISOString() }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("price_settings").insert({ scope: "price_rounding", scope_value: roundingMode, markup_percentage: 0, minimum_margin: 0 } as any);
        if (error) throw error;
      }
      toast({ title: "Prisafrundingsregel gemt" });
    } catch (err: any) {
      toast({ title: "Fejl", description: err?.message || "Kunne ikke gemme reglen", variant: "destructive" });
    } finally {
      setSavingRounding(false);
    }
  };

  const saveBackorderMode = async () => {
    setSavingBackorder(true);
    try {
      const { data: existing } = await supabase
        .from("price_settings")
        .select("id")
        .eq("scope", "default_backorder")
        .maybeSingle();
      if (existing) {
        const { error } = await supabase.from("price_settings").update({ scope_value: backorderMode, updated_at: new Date().toISOString() }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("price_settings").insert({ scope: "default_backorder", scope_value: backorderMode, markup_percentage: 0, minimum_margin: 0 } as any);
        if (error) throw error;
      }
      toast({ title: "Restordre-indstilling gemt" });
    } catch (err: any) {
      toast({ title: "Fejl", description: err?.message || "Kunne ikke gemme indstillingen", variant: "destructive" });
    } finally {
      setSavingBackorder(false);
    }
  };

  const roundingExamples: Record<string, string> = {
    none: "741,57 → 741,57",
    nearest_1: "741,57 → 742,00",
    nearest_5: "741,57 → 745,00",
    nearest_10: "741,57 → 740,00",
    nearest_25: "741,57 → 750,00",
    nearest_49: "741,57 → 749,00",
    nearest_95: "741,57 → 745,00 (ender på ,95)",
    nearest_99: "741,57 → 739,99",
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Indstillinger</h1>
        <p className="text-sm text-muted-foreground mt-1">Administrer avanceprocenter, prisregler, webhooks og MCP</p>
      </div>

      {/* Change Password */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Skift adgangskode
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
            <div className="space-y-2">
              <Label htmlFor="current-pw">Nuværende adgangskode</Label>
              <Input id="current-pw" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pw">Ny adgangskode</Label>
              <Input id="new-pw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pw">Bekræft ny adgangskode</Label>
              <Input id="confirm-pw" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>
            <Button type="submit" disabled={changingPassword}>
              {changingPassword ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Opdater adgangskode
            </Button>
          </form>
        </CardContent>
      </Card>

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

      {/* Price rounding rule */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Calculator className="h-4 w-4" /> Prisafrunding
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Bestemmer hvordan anbefalede priser afrundes. Reglen anvendes af AI-analysen og ved "Følg anbefaling"-handlinger.
          </p>
          <div className="space-y-2 max-w-sm">
            <Label>Afrundingsregel</Label>
            <Select value={roundingMode} onValueChange={setRoundingMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ingen afrunding</SelectItem>
                <SelectItem value="nearest_1">Til nærmeste hele krone</SelectItem>
                <SelectItem value="nearest_5">Til nærmeste 5 kr.</SelectItem>
                <SelectItem value="nearest_10">Til nærmeste 10 kr.</SelectItem>
                <SelectItem value="nearest_25">Til nærmeste 25 kr.</SelectItem>
                <SelectItem value="nearest_49">Ender på 9 (f.eks. 749,-)</SelectItem>
                <SelectItem value="nearest_95">Ender på ,95 (f.eks. 744,95)</SelectItem>
                <SelectItem value="nearest_99">Ender på ,99 (f.eks. 739,99)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 p-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Eksempel:</span> {roundingExamples[roundingMode] ?? ""}
            </p>
          </div>
          <Button onClick={saveRoundingMode} disabled={savingRounding} className="mt-2">
            {savingRounding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Gem
          </Button>
        </CardContent>
      </Card>

      {/* Default backorder setting */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Package className="h-4 w-4" /> Standard restordre-indstilling
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Bestemmer hvilken restordre-status AI-anbefalinger anvender som standard, når et produkt anbefales sat på restordre.
          </p>
          <div className="space-y-2 max-w-sm">
            <Label>Restordre-tilstand</Label>
            <Select value={backorderMode} onValueChange={setBackorderMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Ja (tillad uden besked)</SelectItem>
                <SelectItem value="notify">Ja med besked</SelectItem>
                <SelectItem value="no">Nej (ingen restordre)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 p-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Valgt:</span>{" "}
              {backorderMode === "notify" ? "Restordre tilladt – kunden får besked om ventetid" : backorderMode === "yes" ? "Restordre tilladt – ingen besked til kunden" : "Restordre ikke tilladt"}
            </p>
          </div>
          <Button onClick={saveBackorderMode} disabled={savingBackorder} className="mt-2">
            {savingBackorder ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Gem
          </Button>
        </CardContent>
      </Card>

      {/* Dinero */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Dinero integration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Dinero API Key og Organization ID er gemt som backend-secrets og bruges af Tilbud-modulet til at oprette kladdefakturaer i Dinero. Bed Lovable opdatere dem hvis de skal ændres.
          </p>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">DINERO_API_KEY</Label>
              <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs font-mono">••••••••• (gemt)</div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">DINERO_ORGANIZATION_ID</Label>
              <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs font-mono">••••••••• (gemt)</div>
            </div>
          </div>
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
              {["list_products", "search_products", "get_product", "update_product", "list_suppliers", "get_supplier", "get_price_info", "get_price_history", "get_change_log", "get_price_settings", "get_import_logs", "get_webhooks"].map((t) => (
                <Badge key={t} variant="secondary" className="font-mono text-xs">{t}</Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <LanguageSettingsCard />

      <FieldSyncPolicyCard />

      <WebhookFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        webhook={editingWebhook}
      />
    </div>
  );
}
