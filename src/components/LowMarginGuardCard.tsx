import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const ENABLED_KEY = "low_margin_guard_enabled";
const THRESHOLD_KEY = "low_margin_guard_threshold";

export default function LowMarginGuardCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [threshold, setThreshold] = useState<string>("10");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("analytics_settings")
        .select("setting_key, setting_value")
        .in("setting_key", [ENABLED_KEY, THRESHOLD_KEY]);
      const map = new Map((data ?? []).map((s) => [s.setting_key, s.setting_value]));
      setEnabled((map.get(ENABLED_KEY) ?? "true") === "true");
      setThreshold(map.get(THRESHOLD_KEY) ?? "10");
    })();
  }, []);

  const save = async () => {
    const num = parseFloat(threshold);
    if (Number.isNaN(num) || num < 0 || num > 100) {
      toast({ title: "Ugyldig tærskel", description: "Skal være mellem 0 og 100.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("analytics_settings")
      .upsert(
        [
          { setting_key: ENABLED_KEY, setting_value: enabled ? "true" : "false" },
          { setting_key: THRESHOLD_KEY, setting_value: String(num) },
        ],
        { onConflict: "setting_key" }
      );
    if (error) {
      setSaving(false);
      toast({ title: "Fejl", description: error.message, variant: "destructive" });
      return;
    }
    // Re-apply guard across all products so the new tærskel virker med det samme.
    const { error: rpcErr } = await supabase.rpc("reapply_low_margin_guard_all" as any);
    setSaving(false);
    if (rpcErr) {
      toast({
        title: "Gemt, men revurdering fejlede",
        description: rpcErr.message,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Gemt og genberegnet",
      description: enabled
        ? `Lagerstatus tvinges til 0 når avancen er under ${num}%. Alle produkter er revurderet.`
        : "Lavmargin-beskyttelse er slået fra globalt. Alle produkter er revurderet.",
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />
          Lavmargin-beskyttelse
          {enabled !== null && (
            <Badge variant={enabled ? "default" : "secondary"}>
              {enabled ? `Aktiv (< ${threshold}%)` : "Deaktiveret"}
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Hvis et produkts avance (billigste leverandør på lager vs. webshop-pris ekskl. moms) falder under tærsklen,
          sættes lagerstatus automatisk til 0 — uanset hvad leverandørerne har på lager. Lageret åbner igen så snart
          du sætter en ny webshop-pris der bringer avancen op over tærsklen. Kan overstyres per produkt.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="lmg-enabled" className="text-sm font-medium">Aktivér globalt</Label>
          <Switch
            id="lmg-enabled"
            checked={!!enabled}
            onCheckedChange={setEnabled}
            disabled={enabled === null || saving}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="lmg-threshold" className="text-sm font-medium">Tærskel (%)</Label>
          <Input
            id="lmg-threshold"
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            disabled={saving}
            className="max-w-[120px]"
          />
          <p className="text-xs text-muted-foreground">Standard: 10%.</p>
        </div>

        <Button onClick={save} disabled={saving || enabled === null}>
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Gem indstillinger
        </Button>
      </CardContent>
    </Card>
  );
}
