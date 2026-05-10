import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Power, PowerOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const KEY = "woocommerce_enabled";

export default function WoocommerceToggleCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    const { data } = await supabase
      .from("analytics_settings")
      .select("setting_value")
      .eq("setting_key", KEY)
      .maybeSingle();
    // Default: disabled (WC is paused/legacy)
    setEnabled(data?.setting_value === "true");
  };
  useEffect(() => { load(); }, []);

  const toggle = async () => {
    if (enabled === null) return;
    const next = !enabled;
    if (next && !confirm("Aktivér WooCommerce-sync? WC er markeret som legacy.")) return;
    setSaving(true);
    const { error } = await supabase
      .from("analytics_settings")
      .upsert({ setting_key: KEY, setting_value: next ? "true" : "false" }, { onConflict: "setting_key" });
    setSaving(false);
    if (error) {
      toast({ title: "Fejl", description: error.message, variant: "destructive" });
      return;
    }
    setEnabled(next);
    toast({
      title: next ? "WooCommerce aktiveret" : "WooCommerce deaktiveret",
      description: next
        ? "Push/pull til WooCommerce er nu slået til igen."
        : "Alle WC push/pull-kald springes nu over.",
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {enabled ? <Power className="h-5 w-5" /> : <PowerOff className="h-5 w-5" />}
          WooCommerce-sync
          {enabled === null ? null : (
            <Badge variant={enabled ? "default" : "secondary"}>
              {enabled ? "Aktiv" : "Deaktiveret"}
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          WooCommerce er markeret som legacy. Når deaktiveret springer alle WC push/pull-kald over (PIM og Shopify forbliver upåvirkede).
        </p>
      </CardHeader>
      <CardContent>
        <Button onClick={toggle} disabled={saving || enabled === null} variant={enabled ? "destructive" : "default"}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />)}
          {enabled ? "Deaktivér WooCommerce" : "Aktivér WooCommerce"}
        </Button>
      </CardContent>
    </Card>
  );
}
