import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Languages, Plus, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ALL_LANGUAGES,
  useSupportedLanguages,
  useUpdateSupportedLanguages,
} from "@/hooks/use-translations";

export default function LanguageSettingsCard() {
  const { data: supported = [] } = useSupportedLanguages();
  const update = useUpdateSupportedLanguages();
  const [draft, setDraft] = useState<string[]>([]);
  const [pending, setPending] = useState<string>("");

  useEffect(() => {
    setDraft(supported);
  }, [supported.join(",")]);

  const available = ALL_LANGUAGES.filter((l) => l.code !== "da" && !draft.includes(l.code));
  const dirty = JSON.stringify(draft) !== JSON.stringify(supported);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Languages className="h-4 w-4" /> Sprog
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Dansk er primærsprog. Tilføj sprog du vil oversætte produkter til.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Dansk (primær)</Badge>
          {draft.map((code) => {
            const lang = ALL_LANGUAGES.find((l) => l.code === code);
            return (
              <Badge key={code} variant="outline" className="gap-1.5 pr-1">
                {lang?.label ?? code.toUpperCase()}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4"
                  onClick={() => setDraft((d) => d.filter((c) => c !== code))}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Select value={pending} onValueChange={setPending}>
            <SelectTrigger className="h-9 w-[220px]">
              <SelectValue placeholder="Vælg sprog at tilføje..." />
            </SelectTrigger>
            <SelectContent>
              {available.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.label} ({l.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!pending}
            onClick={() => {
              if (pending && !draft.includes(pending)) {
                setDraft((d) => [...d, pending]);
                setPending("");
              }
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Tilføj
          </Button>
          <Button
            size="sm"
            disabled={!dirty || update.isPending}
            onClick={() => update.mutate(draft)}
          >
            Gem ændringer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
