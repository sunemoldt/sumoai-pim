export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      import_logs: {
        Row: {
          completed_at: string | null
          created_at: string
          deduplicated: number | null
          ean_snapshot: Json | null
          errors: Json | null
          id: string
          imported: number | null
          skipped: number | null
          source: string
          started_at: string
          status: string
          total_fetched: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          deduplicated?: number | null
          ean_snapshot?: Json | null
          errors?: Json | null
          id?: string
          imported?: number | null
          skipped?: number | null
          source: string
          started_at?: string
          status?: string
          total_fetched?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          deduplicated?: number | null
          ean_snapshot?: Json | null
          errors?: Json | null
          id?: string
          imported?: number | null
          skipped?: number | null
          source?: string
          started_at?: string
          status?: string
          total_fetched?: number | null
        }
        Relationships: []
      }
      master_products: {
        Row: {
          attributes: Json | null
          brand: string | null
          category: string | null
          created_at: string
          custom_markup_percentage: number | null
          ean: string
          id: string
          image_url: string | null
          long_description: string | null
          meta_description: string | null
          meta_title: string | null
          sale_price: number | null
          short_description: string | null
          sku: string | null
          title: string
          updated_at: string
          webshop_platform: string | null
          webshop_price: number | null
          webshop_product_id: string | null
        }
        Insert: {
          attributes?: Json | null
          brand?: string | null
          category?: string | null
          created_at?: string
          custom_markup_percentage?: number | null
          ean: string
          id?: string
          image_url?: string | null
          long_description?: string | null
          meta_description?: string | null
          meta_title?: string | null
          sale_price?: number | null
          short_description?: string | null
          sku?: string | null
          title: string
          updated_at?: string
          webshop_platform?: string | null
          webshop_price?: number | null
          webshop_product_id?: string | null
        }
        Update: {
          attributes?: Json | null
          brand?: string | null
          category?: string | null
          created_at?: string
          custom_markup_percentage?: number | null
          ean?: string
          id?: string
          image_url?: string | null
          long_description?: string | null
          meta_description?: string | null
          meta_title?: string | null
          sale_price?: number | null
          short_description?: string | null
          sku?: string | null
          title?: string
          updated_at?: string
          webshop_platform?: string | null
          webshop_price?: number | null
          webshop_product_id?: string | null
        }
        Relationships: []
      }
      price_history: {
        Row: {
          id: string
          price: number
          recorded_at: string
          supplier_product_id: string
        }
        Insert: {
          id?: string
          price: number
          recorded_at?: string
          supplier_product_id: string
        }
        Update: {
          id?: string
          price?: number
          recorded_at?: string
          supplier_product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_history_supplier_product_id_fkey"
            columns: ["supplier_product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      price_settings: {
        Row: {
          created_at: string
          id: string
          markup_percentage: number
          minimum_margin: number
          scope: string
          scope_value: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          markup_percentage?: number
          minimum_margin?: number
          scope?: string
          scope_value?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          markup_percentage?: number
          minimum_margin?: number
          scope?: string
          scope_value?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      supplier_products: {
        Row: {
          created_at: string
          id: string
          in_stock: boolean
          last_updated: string
          master_product_id: string
          purchase_price: number
          stock_quantity: number | null
          supplier_id: string
          supplier_sku: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          in_stock?: boolean
          last_updated?: string
          master_product_id: string
          purchase_price: number
          stock_quantity?: number | null
          supplier_id: string
          supplier_sku?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          in_stock?: boolean
          last_updated?: string
          master_product_id?: string
          purchase_price?: number
          stock_quantity?: number | null
          supplier_id?: string
          supplier_sku?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_products_master_product_id_fkey"
            columns: ["master_product_id"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          column_mapping: Json | null
          created_at: string
          feed_schedule: string | null
          feed_type: string
          feed_url: string | null
          id: string
          is_active: boolean
          last_sync_at: string | null
          name: string
          updated_at: string
        }
        Insert: {
          column_mapping?: Json | null
          created_at?: string
          feed_schedule?: string | null
          feed_type?: string
          feed_url?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          column_mapping?: Json | null
          created_at?: string
          feed_schedule?: string | null
          feed_type?: string
          feed_url?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      webhook_configs: {
        Row: {
          created_at: string
          event_types: string[]
          id: string
          is_active: boolean
          name: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          event_types?: string[]
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          event_types?: string[]
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
