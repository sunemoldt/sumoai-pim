import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import DOMPurify from "dompurify";

type FieldType = "text" | "number" | "textarea" | "html" | "select" | "boolean";

interface Props {
  productId: string;
  field: string;
  value: any;
  type?: FieldType;
  options?: { value: string; label: string }[];
  display?: (v: any) => React.ReactNode;
  parse?: (raw: string) => any;
  placeholder?: string;
  invalidateKeys?: (string | undefined)[][];
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
  onSaved?: (next: any) => void | Promise<void>;
}

export default function InlineEditField({
  productId,
  field,
  value,
  type = "text",
  options,
  display,
  parse,
  placeholder = "—",
  invalidateKeys,
  className = "",
  inputClassName = "",
  onSaved,
}: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      const v = value == null ? "" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
      setDraft(v);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [editing, value]);

  const save = async (rawOverride?: string) => {
    const raw = rawOverride !== undefined ? rawOverride : draft;
    setSaving(true);
    try {
      let next: any;
      if (parse) {
        next = parse(raw);
      } else if (type === "number") {
        const trimmed = raw.trim();
        if (trimmed === "") {
          next = null;
        } else {
          // Accept both "1.234,56" (Danish) and "1234.56" (dot decimal).
          // Strip thousands separators, then normalise comma → dot.
          const normalised = trimmed
            .replace(/\s/g, "")
            .replace(/\.(?=\d{3}(\D|$))/g, "")
            .replace(",", ".");
          next = Number(normalised);
          if (Number.isNaN(next)) throw new Error(`Ugyldigt tal: "${raw}"`);
        }
      } else if (type === "boolean") {
        next = raw === "true";
      } else {
        next = raw === "" ? null : raw;
      }

      const { error } = await supabase
        .from("master_products")
        .update({ [field]: next } as any)
        .eq("id", productId);
      if (error) throw error;
      toast.success("Gemt");
      (invalidateKeys ?? [["master_product", productId], ["product_change_log", productId], ["master_products"]])
        .forEach((k) => qc.invalidateQueries({ queryKey: k as any }));
      await onSaved?.(next);
      setEditing(false);
    } catch (e: any) {
      toast.error(e?.message || "Fejl ved gemning");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => { setEditing(false); setDraft(""); };

  if (!editing) {
    return (
      <div className={`group flex items-start gap-2 ${className}`}>
        <div className="flex-1 min-w-0">
          {display ? display(value) : (
            value == null || value === "" ? (
              <span className="text-muted-foreground text-sm">{placeholder}</span>
            ) : type === "html" ? (
              <div className="prose prose-sm max-w-none text-sm overflow-hidden break-words"
                   dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(String(value)) }} />
            ) : type === "boolean" ? (
              <span className="text-sm">{value ? "Ja" : "Nej"}</span>
            ) : (
              <span className="text-sm whitespace-pre-wrap break-words">{String(value)}</span>
            )
          )}
        </div>
        <Button
          variant="ghost" size="sm"
          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 shrink-0"
          onClick={() => setEditing(true)}
          aria-label="Rediger"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") cancel();
    if (e.key === "Enter" && !e.shiftKey && type !== "textarea" && type !== "html") {
      e.preventDefault();
      save();
    }
  };

  return (
    <div className={`flex items-start gap-2 ${className}`}>
      <div className="flex-1 min-w-0">
        {type === "textarea" || type === "html" ? (
          <Textarea
            ref={inputRef as any}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            rows={type === "html" ? 8 : 4}
            className={inputClassName}
          />
        ) : type === "select" && options ? (
          <Select value={draft} onValueChange={(v) => { setDraft(v); save(v); }}>
            <SelectTrigger className={inputClassName}><SelectValue /></SelectTrigger>
            <SelectContent>
              {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : type === "boolean" ? (
          <Select value={draft} onValueChange={(v) => { setDraft(v); save(v); }}>
            <SelectTrigger className={inputClassName}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Ja</SelectItem>
              <SelectItem value="false">Nej</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            ref={inputRef as any}
            type={type === "number" ? "number" : "text"}
            step={type === "number" ? "any" : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            className={inputClassName}
          />
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0 pt-0.5">
        <Button size="sm" className="h-7 w-7 p-0" onClick={() => save()} disabled={saving} aria-label="Gem">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={cancel} disabled={saving} aria-label="Annullér">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
