import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type MasterProduct = Tables<"master_products"> & {
  sale_price?: number | null;
  custom_markup_percentage?: number | null;
  short_description?: string | null;
  long_description?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  sku?: string | null;
  attributes?: Record<string, string> | null;
};
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

// Columns needed by ProductListPage (table view). Excludes heavy fields
// like long_description, attributes, metadata that aren't shown in the list.
const LIST_COLUMNS =
  "id,title,ean,sku,brand,category,categories,image_url,webshop_price,sale_price," +
  "stock_quantity,stock_status,lifecycle_status,auto_stock_sync,shopify_sync_enabled," +
  "shopify_product_id,shopify_variant_id,custom_markup_percentage,min_sync_margin," +
  "low_margin_guard,low_margin_threshold,backorder_policy,backorders_allowed," +
  "webshop_platform,webshop_product_id,weight_kg,short_description,meta_title,meta_description," +
  "sync_tags,updated_at,created_at";

const LIST_SUPPLIER_COLUMNS =
  "id,supplier_id,master_product_id,purchase_price,stock_quantity,in_stock,suppliers(id,name)";

export function useMasterProducts(search?: string) {
  return useQuery({
    queryKey: ["master_products", search],
    staleTime: 60_000,
    queryFn: async () => {
      let query = supabase
        .from("master_products")
        .select(`${LIST_COLUMNS}, supplier_products(${LIST_SUPPLIER_COLUMNS})`)
        .order("title");
      
      if (search) {
        // EAN: match regardless of leading zeros (e.g. "0810177161929" should also find "810177161929" and vice versa)
        const isDigits = /^\d+$/.test(search);
        const eanStripped = isDigits ? search.replace(/^0+/, "") : search;
        const eanFilters = isDigits && eanStripped !== search
          ? `ean.ilike.%${search}%,ean.ilike.%${eanStripped}%`
          : `ean.ilike.%${search}%`;
        query = query.or(`title.ilike.%${search}%,${eanFilters},brand.ilike.%${search}%,sku.ilike.%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as MasterProductWithSuppliers[];
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

export type ProductChangeLog = {
  id: string;
  master_product_id: string;
  change_type: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  created_at: string;
};

export function useProductChangeLog(productId: string) {
  return useQuery({
    queryKey: ["product_change_log", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_change_log")
        .select("*")
        .eq("master_product_id", productId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as ProductChangeLog[];
    },
    enabled: !!productId,
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

// Utility: get cheapest supplier regardless of stock status
export function getCheapestSupplierAny(
  supplierProducts: (SupplierProduct & { suppliers: Supplier | null })[]
) {
  if (supplierProducts.length === 0) return null;
  return supplierProducts.reduce((min, sp) => (sp.purchase_price < min.purchase_price ? sp : min));
}

// Danish VAT rate
export const VAT_RATE = 0.25;

// Analytics types
export type ProductAnalytics = {
  id: string;
  master_product_id: string;
  period_start: string;
  period_end: string;
  page_views: number;
  add_to_carts: number;
  purchases: number;
  conversion_rate: number;
  impressions: number;
  clicks: number;
  avg_position: number;
  ctr: number;
  matched_url: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductRecommendation = {
  id: string;
  master_product_id: string;
  recommendation_type: string;
  severity: string;
  title: string;
  description: string;
  action_suggestion: string | null;
  is_dismissed: boolean;
  data: Record<string, any>;
  created_at: string;
  resolved_at: string | null;
};

export function useProductAnalytics(productId: string) {
  return useQuery({
    queryKey: ["product_analytics", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_analytics")
        .select("*")
        .eq("master_product_id", productId)
        .order("updated_at", { ascending: false })
        .order("period_end", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] ?? null) as ProductAnalytics | null;
    },
    enabled: !!productId,
  });
}

export function useAllProductAnalytics() {
  return useQuery({
    queryKey: ["all_product_analytics"],
    queryFn: async () => {
      // Trim to only the columns Dashboard/ProductList read, and dedupe to one row per product.
      const { data, error } = await supabase
        .from("product_analytics")
        .select("master_product_id, page_views, add_to_carts, purchases, conversion_rate, impressions, clicks, ctr, avg_position, period_end, updated_at")
        .order("updated_at", { ascending: false })
        .order("period_end", { ascending: false });
      if (error) throw error;
      const byProduct = new Map<string, ProductAnalytics>();
      for (const row of (data ?? []) as unknown as ProductAnalytics[]) {
        if (!byProduct.has(row.master_product_id)) {
          byProduct.set(row.master_product_id, row);
        }
      }
      return byProduct;
    },
  });
}

export function useProductRecommendations(productId?: string) {
  return useQuery({
    queryKey: ["product_recommendations", productId],
    queryFn: async () => {
      let query = supabase
        .from("product_recommendations")
        .select("*")
        .eq("is_dismissed", false)
        .is("resolved_at", null)
        .order("created_at", { ascending: false });
      if (productId) {
        query = query.eq("master_product_id", productId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as ProductRecommendation[];
    },
  });
}

// Utility: remove VAT from an incl-VAT price
export function exVat(priceInclVat: number): number {
  return Math.round((priceInclVat / (1 + VAT_RATE)) * 100) / 100;
}

// Utility: add VAT to an ex-VAT price
export function inclVat(priceExVat: number): number {
  return Math.round(priceExVat * (1 + VAT_RATE) * 100) / 100;
}

// Utility: calculate recommended price (ex-VAT → ex-VAT, then add VAT for shop price)
export function getRecommendedPrice(purchasePrice: number, markupPct: number): number {
  return Math.round(purchasePrice * (1 + markupPct / 100) * 100) / 100;
}

// Utility: recommended price incl VAT (for display as webshop price)
export function getRecommendedPriceInclVat(purchasePrice: number, markupPct: number): number {
  return inclVat(getRecommendedPrice(purchasePrice, markupPct));
}

// Utility: calculate margin percentage (both prices must be ex-VAT)
export function getMarginPercent(salePriceExVat: number, purchasePriceExVat: number): number {
  if (salePriceExVat === 0) return 0;
  return Math.round(((salePriceExVat - purchasePriceExVat) / salePriceExVat) * 10000) / 100;
}
