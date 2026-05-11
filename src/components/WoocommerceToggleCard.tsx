import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Power, PowerOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const ENABLED_KEY = "woocommerce_enabled";
const SCOPE_KEY = "woocommerce_scope"; // "prices_stock_only" | "full"

type Scope = "prices_stock_only" | "full";

export default function WoocommerceToggleCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [scope, setScope] = useState<Scope>("prices_stock_only");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    const { data } = await supabase
      .from("analytics_settings")
      .select("setting_key, setting_value")
      .in("setting_key", [ENABLED_KEY, SCOPE_KEY]);
    const map = new Map((data ?? []).map((s) => [s.setting_key, s.setting_value]));
    setEnabled(map.get(ENABLED_KEY) === "true");
    setScope((map.get(SCOPE_KEY) as Scope) === "full" ? "full" : "prices_stock_only");
  };
  useEffect(() => { load(); }, []);

  const persist = async (nextEnabled: boolean, nextScope: Scope) => {
    setSaving(true);
    const { error } = await supabase
      .from("analytics_settings")
      .upsert(
        [
          { setting_key: ENABLED_KEY, setting_value: nextEnabled ? "true" : "false" },
          { setting_key: SCOPE_KEY, setting_value: nextScope },
        ],
        { onConflict: "setting_key" }
      );
    setSaving(false);
    if (error) {
      toast({ title: "Fejl", description: error.message, variant: "destructive" });
      return false;
    }
    setEnabled(nextEnabled);
    setScope(nextScope);
    return true;
  };

  const toggle = async () => {
    if (enabled === null) return;
    const next = !enabled;
    if (next && !confirm(
      scope === "prices_stock_only"
        ? "Aktivér WooCommerce-sync KUN for priser og lager? (Tekster/produktoprettelse springes over.)"
        : "Aktivér FULD WooCommerce-sync (priser, lager OG tekster)? WC er markeret som legacy."
    )) return;
    const ok = await persist(next, scope);
    if (!ok) return;
    toast({
      title: next ? "WooCommerce aktiveret" : "WooCommerce deaktiveret",
      description: next
        ? scope === "prices_stock_only"
          ? "Kun priser og lager pushes til WC. Ingen tekstopdateringer."
          : "Fuld push/pull til WooCommerce er nu slået til."
        : "Alle WC push/pull-kald springes nu over.",
    });
  };

  const onScopeChange = async (v: Scope) => {
    if (v === scope) return;
    if (enabled) {
      const ok = await persist(enabled, v);
      if (ok) toast({ title: "Sync-omfang opdateret", description: v === "prices_stock_only" ? "Kun priser og lager pushes." : "Fuld sync (inkl. tekster) aktiv." });
    } else {
      setScope(v);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {enabled ? <Power className="h-5 w-5" /> : <PowerOff className="h-5 w-5" />}
          WooCommerce-sync
          {enabled === null ? null : (
            <Badge variant={enabled ? "default" : "secondary"}>
              {enabled ? (scope === "prices_stock_only" ? "Aktiv (kun pris/lager)" : "Aktiv (fuld)") : "Deaktiveret"}
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          WooCommerce er markeret som legacy. Brug "kun priser og lager" for at sikre at intet fejlagtigt står som udsolgt, uden at risikere overskrivning af tekster.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Sync-omfang</Label>
          <RadioGroup value={scope} onValueChange={(v) => onScopeChange(v as Scope)} disabled={saving}>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="prices_stock_only" id="scope-prices" className="mt-1" />
              <Label htmlFor="scope-prices" className="font-normal cursor-pointer">
                Kun priser og lager <span className="text-muted-foreground">(anbefalet — undgår tekst-overskrivning)</span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="full" id="scope-full" className="mt-1" />
              <Label htmlFor="scope-full" className="font-normal cursor-pointer">
                Fuld sync <span className="text-muted-foreground">(inkl. titel, kort/lang beskrivelse)</span>
              </Label>
            </div>
          </RadioGroup>
        </div>

        <Button onClick={toggle} disabled={saving || enabled === null} variant={enabled ? "destructive" : "default"}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />)}
          {enabled ? "Deaktivér WooCommerce" : "Aktivér WooCommerce"}
        </Button>
      </CardContent>
    </Card>
  );
}
