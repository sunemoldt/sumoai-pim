import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Plus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  productId: string;
  value: string[] | null | undefined;
}

export default function SyncTagsEditor({ productId, value }: Props) {
  const qc = useQueryClient();
  const [tags, setTags] = useState<string[]>(value ?? []);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTags(value ?? []); }, [value]);

  // Fetch suggestions: all distinct sync_tags across products
  const { data: allTags = [] } = useQuery({
    queryKey: ["all_sync_tags"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("master_products")
        .select("sync_tags")
        .not("sync_tags", "is", null);
      if (error) throw error;
      const set = new Set<string>();
      for (const row of (data as any[]) ?? []) {
        for (const t of (row.sync_tags ?? []) as string[]) {
          if (t) set.add(t);
        }
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, "da"));
    },
    staleTime: 60_000,
  });

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return allTags
      .filter((t) => !tags.includes(t) && (!q || t.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [allTags, tags, draft]);

  const persist = async (next: string[]) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("master_products")
        .update({ sync_tags: next } as any)
        .eq("id", productId);
      if (error) throw error;
      setTags(next);
      qc.invalidateQueries({ queryKey: ["master_product", productId] });
      qc.invalidateQueries({ queryKey: ["master_products"] });
      qc.invalidateQueries({ queryKey: ["all_sync_tags"] });
      qc.invalidateQueries({ queryKey: ["product_change_log", productId] });
    } catch (e: any) {
      toast.error(e?.message || "Kunne ikke gemme tags");
    } finally {
      setSaving(false);
    }
  };

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/,$/, "").trim();
    if (!t) return;
    if (tags.includes(t)) { setDraft(""); return; }
    persist([...tags, t]);
    setDraft("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const removeTag = (t: string) => {
    persist(tags.filter((x) => x !== t));
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(draft);
    } else if (e.key === "Backspace" && !draft && tags.length) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setDraft("");
      inputRef.current?.blur();
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.length === 0 && !open && (
          <span className="text-sm text-muted-foreground">Ingen tags</span>
        )}
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-md bg-secondary text-secondary-foreground px-2 py-0.5 text-xs font-medium"
          >
            {t}
            <button
              type="button"
              onClick={() => removeTag(t)}
              disabled={saving}
              className="hover:text-foreground/70 disabled:opacity-50"
              aria-label={`Fjern ${t}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {open ? (
          <div className="relative">
            <Input
              ref={inputRef}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onBlur={() => {
                // small delay to allow suggestion click
                setTimeout(() => { setOpen(false); setDraft(""); }, 150);
              }}
              placeholder="Tilføj tag…"
              className="h-7 w-40 text-xs"
            />
            {suggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-48 rounded-md border bg-popover p-1 shadow-md">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
                    className="w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setOpen(true)}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Tilføj
          </Button>
        )}
      </div>
    </div>
  );
}
