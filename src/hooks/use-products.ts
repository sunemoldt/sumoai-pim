import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type MasterProduct = Tables<"master_products">;
export type Supplier = Tables<"suppliers">;
export type SupplierProduct = Tables<"supplier_products">;
export type PriceSetting = Tables<"price_settings">;
export type WebhookConfig = Tables<"webhook_configs">;
export type PriceHistory = Tables<"price_history">;

export type MasterProductWithSuppliers = MasterProduct & {
  supplier_products: (SupplierProduct & { suppliers: Supplier | null })[];
};

export function useSuppliers() {
  return useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").order("name");
      if (error) throw error;
      return data as Supplier[];
    },
  });
}

export function useMasterProducts(search?: string) {
  return useQuery({
    queryKey: ["master_products", search],
    queryFn: async () => {
      let query = supabase
        .from("master_products")
        .select("*, supplier_products(*, suppliers(*))")
        .order("title");
      
      if (search) {
        query = query.or(`title.ilike.%${search}%,ean.ilike.%${search}%,brand.ilike.%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as MasterProductWithSuppliers[];
    },
  });
}

export function useMasterProduct(id: string) {
  return useQuery({
    queryKey: ["master_product", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("master_products")
        .select("*, supplier_products(*, suppliers(*))")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as MasterProductWithSuppliers;
    },
    enabled: !!id,
  });
}

export function usePriceSettings() {
  return useQuery({
    queryKey: ["price_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("price_settings").select("*").order("scope");
      if (error) throw error;
      return data as PriceSetting[];
    },
  });
}

export function useWebhookConfigs() {
  return useQuery({
    queryKey: ["webhook_configs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("webhook_configs").select("*").order("name");
      if (error) throw error;
      return data as WebhookConfig[];
    },
  });
}

export function usePriceHistory(supplierProductId: string) {
  return useQuery({
    queryKey: ["price_history", supplierProductId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_history")
        .select("*")
        .eq("supplier_product_id", supplierProductId)
        .order("recorded_at", { ascending: true });
      if (error) throw error;
      return data as PriceHistory[];
    },
    enabled: !!supplierProductId,
  });
}

// Utility: get cheapest in-stock supplier for a product
export function getCheapestSupplier(
  supplierProducts: (SupplierProduct & { suppliers: Supplier | null })[]
) {
  const inStock = supplierProducts.filter((sp) => sp.in_stock);
  if (inStock.length === 0) return null;
  return inStock.reduce((min, sp) => (sp.purchase_price < min.purchase_price ? sp : min));
}

// Utility: calculate recommended price
export function getRecommendedPrice(purchasePrice: number, markupPct: number): number {
  return Math.round(purchasePrice * (1 + markupPct / 100) * 100) / 100;
}

// Utility: calculate margin percentage
export function getMarginPercent(salePrice: number, purchasePrice: number): number {
  if (salePrice === 0) return 0;
  return Math.round(((salePrice - purchasePrice) / salePrice) * 10000) / 100;
}
