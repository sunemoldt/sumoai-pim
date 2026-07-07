import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SaleCampaign = {
  id: string;
  name: string;
  discount_percent: number;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "active" | "ended" | "cancelled";
  overwrite_existing_sale: boolean;
  activated_at: string | null;
  deactivated_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SaleCampaignProduct = {
  id: string;
  campaign_id: string;
  master_product_id: string;
  original_sale_price: number | null;
  applied_sale_price: number | null;
  applied_at: string | null;
  reverted_at: string | null;
  skipped_reason: string | null;
};

export function useSaleCampaigns() {
  return useQuery({
    queryKey: ["sale_campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_campaigns")
        .select("*, sale_campaign_products(id)")
        .order("starts_at", { ascending: false });
      if (error) throw error;
      return data as (SaleCampaign & { sale_campaign_products: { id: string }[] })[];
    },
  });
}

export function useSaleCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ["sale_campaign", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_campaigns")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as SaleCampaign;
    },
  });
}

export function useSaleCampaignProducts(campaignId: string | undefined) {
  return useQuery({
    queryKey: ["sale_campaign_products", campaignId],
    enabled: !!campaignId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_campaign_products")
        .select("*, master_products(id, title, ean, image_url, webshop_price, sale_price, brand)")
        .eq("campaign_id", campaignId!);
      if (error) throw error;
      return data as (SaleCampaignProduct & {
        master_products: {
          id: string;
          title: string;
          ean: string | null;
          image_url: string | null;
          webshop_price: number | null;
          sale_price: number | null;
          brand: string | null;
        } | null;
      })[];
    },
  });
}
