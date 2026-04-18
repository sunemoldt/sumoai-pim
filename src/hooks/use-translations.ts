import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ProductTranslation = {
  id: string;
  master_product_id: string;
  language_code: string;
  title: string | null;
  short_description: string | null;
  long_description: string | null;
  meta_title: string | null;
  meta_description: string | null;
  attributes: Record<string, string> | null;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
};

export const PRIMARY_LANGUAGE = "da";

export const ALL_LANGUAGES: { code: string; label: string }[] = [
  { code: "da", label: "Dansk" },
  { code: "en", label: "Engelsk" },
  { code: "de", label: "Tysk" },
  { code: "sv", label: "Svensk" },
  { code: "no", label: "Norsk" },
  { code: "fi", label: "Finsk" },
  { code: "nl", label: "Hollandsk" },
  { code: "fr", label: "Fransk" },
  { code: "es", label: "Spansk" },
  { code: "it", label: "Italiensk" },
  { code: "pt", label: "Portugisisk" },
  { code: "pl", label: "Polsk" },
  { code: "cs", label: "Tjekkisk" },
  { code: "sk", label: "Slovakisk" },
  { code: "hu", label: "Ungarsk" },
  { code: "ro", label: "Rumænsk" },
  { code: "bg", label: "Bulgarsk" },
  { code: "el", label: "Græsk" },
  { code: "et", label: "Estisk" },
  { code: "lv", label: "Lettisk" },
  { code: "lt", label: "Litauisk" },
  { code: "sl", label: "Slovensk" },
  { code: "hr", label: "Kroatisk" },
];

export function useSupportedLanguages() {
  return useQuery({
    queryKey: ["supported_languages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analytics_settings")
        .select("setting_value")
        .eq("setting_key", "supported_languages")
        .maybeSingle();
      if (error) throw error;
      try {
        const arr = data?.setting_value ? JSON.parse(data.setting_value) : [];
        return Array.isArray(arr) ? (arr as string[]) : [];
      } catch {
        return [] as string[];
      }
    },
  });
}

export function useUpdateSupportedLanguages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (codes: string[]) => {
      const value = JSON.stringify(codes);
      const { data: existing } = await supabase
        .from("analytics_settings")
        .select("id")
        .eq("setting_key", "supported_languages")
        .maybeSingle();
      if (existing) {
        const { error } = await supabase
          .from("analytics_settings")
          .update({ setting_value: value })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("analytics_settings")
          .insert({ setting_key: "supported_languages", setting_value: value });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supported_languages"] });
      toast.success("Sprogliste opdateret");
    },
    onError: (err: any) => toast.error(err?.message ?? "Fejl"),
  });
}

export function useProductTranslations(productId: string) {
  return useQuery({
    queryKey: ["product_translations", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_translations")
        .select("*")
        .eq("master_product_id", productId);
      if (error) throw error;
      return (data ?? []) as ProductTranslation[];
    },
    enabled: !!productId,
  });
}

export function useUpsertTranslation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      master_product_id: string;
      language_code: string;
      title?: string | null;
      short_description?: string | null;
      long_description?: string | null;
      meta_title?: string | null;
      meta_description?: string | null;
      attributes?: Record<string, string> | null;
      status?: string;
    }) => {
      const { error } = await supabase
        .from("product_translations")
        .upsert(payload, { onConflict: "master_product_id,language_code" });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["product_translations", vars.master_product_id] });
      toast.success("Oversættelse gemt");
    },
    onError: (err: any) => toast.error(err?.message ?? "Fejl"),
  });
}
