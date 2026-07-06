import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, Gauge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const KEYS = [
  { key: "low_stock_threshold", label: "Lavt lager (stk)", help: "Under dette antal markeres et produkt som lavt lager.", def: "5" },
  { key: "min_traffic_threshold", label: "Min. trafik (impressions)", help: "Produkter under dette antal impressions vises ikke i AI-anbefalinger.", def: "50" },
  { key: "min_ctr_threshold", label: "Min. CTR (%)", help: "CTR under denne værdi udløser konverterings-anbefaling.", def: "3" },
  { key: "analysis_period_days", label: "Analyseperiode (dage)", help: "Hvor langt tilbage AI-analysen kigger.", def: "30" },
];

export default function AnalysisThresholdsCard() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("analytics_settings")
        .select("setting_key, setting_value")
        .in("setting_key", KEYS.map((k) => k.key));
      const map = Object.fromEntries((data ?? []).map((r) => [r.setting_key, r.setting_value]));
      const initial: Record<string, string> = {};
      for (const k of KEYS) initial[k.key] = map[k.key] ?? k.def;
      setValues(initial);
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const rows = KEYS.map((k) => ({ setting_key: k.key, setting_value: values[k.key] ?? k.def }));
    const { error } = await supabase.from("analytics_settings").upsert(rows, { onConflict: "setting_key" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Tærskler gemt");
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Gauge className="h-4 w-4" /> AI/Analyse-tærskler
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Styrer hvornår produkter fremhæves i AI-anbefalinger og på Dashboard.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Indlæser …
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {KEYS.map((k) => (
                <div key={k.key} className="space-y-1">
                  <Label className="text-sm font-medium">{k.label}</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={values[k.key] ?? ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [k.key]: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">{k.help}</p>
                </div>
              ))}
            </div>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Gem tærskler
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
