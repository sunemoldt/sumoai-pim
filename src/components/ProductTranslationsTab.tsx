import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Languages, Plus, X } from "lucide-react";
import {
  ALL_LANGUAGES,
  PRIMARY_LANGUAGE,
  useProductTranslations,
  useSupportedLanguages,
  useUpsertTranslation,
} from "@/hooks/use-translations";
import type { MasterProductWithSuppliers } from "@/hooks/use-products";

type Props = { product: MasterProductWithSuppliers };

type FormState = {
  title: string;
  short_description: string;
  long_description: string;
  meta_title: string;
  meta_description: string;
  attributes: Record<string, string>;
};

const empty: FormState = {
  title: "",
  short_description: "",
  long_description: "",
  meta_title: "",
  meta_description: "",
  attributes: {},
};

export default function ProductTranslationsTab({ product }: Props) {
  const { data: supported = [] } = useSupportedLanguages();
  const { data: translations = [], isLoading } = useProductTranslations(product.id);
  const upsert = useUpsertTranslation();

  const [activeLang, setActiveLang] = useState<string>(supported[0] ?? "en");
  const [form, setForm] = useState<FormState>(empty);
  const [newAttrKey, setNewAttrKey] = useState("");

  const productAttrs = (product.attributes as Record<string, string> | null) ?? {};

  const translationByLang = useMemo(() => {
    const map = new Map<string, (typeof translations)[number]>();
    for (const t of translations) map.set(t.language_code, t);
    return map;
  }, [translations]);

  // Load form when active language changes
  useEffect(() => {
    const t = translationByLang.get(activeLang);
    if (t) {
      setForm({
        title: t.title ?? "",
        short_description: t.short_description ?? "",
        long_description: t.long_description ?? "",
        meta_title: t.meta_title ?? "",
        meta_description: t.meta_description ?? "",
        attributes: (t.attributes as Record<string, string>) ?? {},
      });
    } else {
      setForm(empty);
    }
  }, [activeLang, translationByLang]);

  // Auto-pick first supported language when list loads
  useEffect(() => {
    if (supported.length > 0 && !supported.includes(activeLang)) {
      setActiveLang(supported[0]);
    }
  }, [supported, activeLang]);

  if (supported.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <Languages className="mx-auto mb-3 h-8 w-8 opacity-40" />
          Ingen ekstra sprog er aktiveret. Tilføj sprog under <strong>Indstillinger → Sprog</strong>.
        </CardContent>
      </Card>
    );
  }

  const langLabel = (code: string) =>
    ALL_LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();

  const save = (status: "draft" | "translated" | "approved") => {
    upsert.mutate({
      master_product_id: product.id,
      language_code: activeLang,
      title: form.title || null,
      short_description: form.short_description || null,
      long_description: form.long_description || null,
      meta_title: form.meta_title || null,
      meta_description: form.meta_description || null,
      attributes: form.attributes,
      status,
    });
  };

  return (
    <div className="space-y-4">
      {/* Reference: Danish source */}
      <Card className="bg-secondary/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Badge variant="outline">DA</Badge> Kilde (dansk)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Titel</p>
            <p className="font-medium text-foreground">{product.title}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Meta titel</p>
            <p className="text-foreground">{(product as any).meta_title ?? "—"}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-muted-foreground">Kort beskrivelse</p>
            <p className="line-clamp-3 text-foreground">
              {(product as any).short_description ?? "—"}
            </p>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-muted-foreground">Lang beskrivelse</p>
            <p className="line-clamp-4 whitespace-pre-wrap text-foreground">
              {(product as any).long_description ?? "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeLang} onValueChange={setActiveLang}>
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          {supported.map((code) => {
            const t = translationByLang.get(code);
            return (
              <TabsTrigger key={code} value={code} className="gap-2">
                <span>{langLabel(code)}</span>
                {t && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      t.status === "approved"
                        ? "border-success/30 text-success"
                        : t.status === "translated"
                          ? "border-primary/30 text-primary"
                          : "text-muted-foreground"
                    }`}
                  >
                    {t.status === "approved" ? "✓" : t.status === "translated" ? "T" : "kl."}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {supported.map((code) => (
          <TabsContent key={code} value={code} className="mt-4 space-y-4">
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </div>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Indhold ({langLabel(code)})</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label>Titel</Label>
                      <Input
                        value={form.title}
                        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                        placeholder={product.title}
                      />
                    </div>
                    <div>
                      <Label>Kort beskrivelse</Label>
                      <Textarea
                        rows={3}
                        value={form.short_description}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, short_description: e.target.value }))
                        }
                      />
                    </div>
                    <div>
                      <Label>Lang beskrivelse</Label>
                      <Textarea
                        rows={8}
                        value={form.long_description}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, long_description: e.target.value }))
                        }
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">SEO ({langLabel(code)})</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label>Meta titel</Label>
                      <Input
                        value={form.meta_title}
                        onChange={(e) => setForm((f) => ({ ...f, meta_title: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Meta beskrivelse</Label>
                      <Textarea
                        rows={2}
                        value={form.meta_description}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, meta_description: e.target.value }))
                        }
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Attributter ({langLabel(code)})</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {Object.keys(productAttrs).length === 0 &&
                      Object.keys(form.attributes).length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          Ingen tekniske attributter på produktet.
                        </p>
                      )}
                    {Object.keys({ ...productAttrs, ...form.attributes }).map((key) => (
                      <div key={key} className="grid grid-cols-12 items-center gap-2">
                        <Label className="col-span-3 truncate text-xs">{key}</Label>
                        <p className="col-span-4 truncate text-xs text-muted-foreground">
                          {productAttrs[key] ?? "—"}
                        </p>
                        <Input
                          className="col-span-4"
                          value={form.attributes[key] ?? ""}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              attributes: { ...f.attributes, [key]: e.target.value },
                            }))
                          }
                          placeholder="Oversættelse..."
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="col-span-1 h-8 w-8"
                          onClick={() =>
                            setForm((f) => {
                              const next = { ...f.attributes };
                              delete next[key];
                              return { ...f, attributes: next };
                            })
                          }
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-2">
                      <Input
                        placeholder="Ny attribut nøgle"
                        value={newAttrKey}
                        onChange={(e) => setNewAttrKey(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!newAttrKey.trim()) return;
                          setForm((f) => ({
                            ...f,
                            attributes: { ...f.attributes, [newAttrKey.trim()]: "" },
                          }));
                          setNewAttrKey("");
                        }}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" /> Tilføj
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => save("draft")} disabled={upsert.isPending}>
                    Gem som kladde
                  </Button>
                  <Button onClick={() => save("translated")} disabled={upsert.isPending}>
                    {upsert.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Gem oversat
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => save("approved")}
                    disabled={upsert.isPending}
                  >
                    Godkend
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
