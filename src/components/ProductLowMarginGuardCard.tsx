import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type GuardMode = "inherit" | "on" | "off";

type Props = {
  productId: string;
  initialMode: GuardMode;
  initialThreshold: number | null;
  onSaved?: () => void;
};

export default function ProductLowMarginGuardCard({
  productId,
  initialMode,
  initialThreshold,
  onSaved,
}: Props) {
  const [mode, setMode] = useState<GuardMode>(initialMode);
  const [threshold, setThreshold] = useState<string>(
    initialThreshold !== null && initialThreshold !== undefined ? String(initialThreshold) : ""
  );
  const [globalEnabled, setGlobalEnabled] = useState<boolean>(true);
  const [globalThreshold, setGlobalThreshold] = useState<string>("10");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("analytics_settings")
        .select("setting_key, setting_value")
        .in("setting_key", ["low_margin_guard_enabled", "low_margin_guard_threshold"]);
      const map = new Map((data ?? []).map((s) => [s.setting_key, s.setting_value]));
      setGlobalEnabled((map.get("low_margin_guard_enabled") ?? "true") === "true");
      setGlobalThreshold(map.get("low_margin_guard_threshold") ?? "10");
    })();
  }, []);

  const effectiveActive =
    mode === "on" || (mode === "inherit" && globalEnabled);
  const effectiveThreshold =
    threshold !== "" && !Number.isNaN(parseFloat(threshold))
      ? parseFloat(threshold)
      : parseFloat(globalThreshold) || 10;

  const save = async () => {
    let parsed: number | null = null;
    if (threshold !== "") {
      const n = parseFloat(threshold);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        toast.error("Tærskel skal være mellem 0 og 100");
        return;
      }
      parsed = n;
    }
    setSaving(true);
    const { error } = await supabase
      .from("master_products")
      .update({
        low_margin_guard: mode,
        low_margin_threshold: parsed,
      } as any)
      .eq("id", productId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Lavmargin-beskyttelse opdateret");
    onSaved?.();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" />
          Lavmargin-beskyttelse
          <Badge variant={effectiveActive ? "default" : "secondary"}>
            {effectiveActive ? `Aktiv (< ${effectiveThreshold}%)` : "Deaktiveret"}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Tving lager til 0 hvis avancen falder under tærsklen. Lager åbner automatisk når du sætter en ny webshop-pris
          der bringer avancen op igen.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Tilstand</Label>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as GuardMode)} disabled={saving}>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="inherit" id="lmg-inherit" className="mt-1" />
              <Label htmlFor="lmg-inherit" className="font-normal cursor-pointer">
                Arv global{" "}
                <span className="text-muted-foreground">
                  ({globalEnabled ? `aktiv, ${globalThreshold}%` : "deaktiveret"})
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="on" id="lmg-on" className="mt-1" />
              <Label htmlFor="lmg-on" className="font-normal cursor-pointer">
                Tving til{" "}
                <span className="text-muted-foreground">(brug evt. egen tærskel nedenfor)</span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="off" id="lmg-off" className="mt-1" />
              <Label htmlFor="lmg-off" className="font-normal cursor-pointer">
                Tving fra <span className="text-muted-foreground">(ignorér regel for dette produkt)</span>
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label htmlFor="lmg-threshold-prod" className="text-sm font-medium">
            Egen tærskel (%) — valgfri
          </Label>
          <Input
            id="lmg-threshold-prod"
            type="number"
            min={0}
            max={100}
            step={0.1}
            placeholder={`Arv global (${globalThreshold}%)`}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            disabled={saving || mode === "off"}
            className="max-w-[180px]"
          />
        </div>

        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Gem
        </Button>
      </CardContent>
    </Card>
  );
}
