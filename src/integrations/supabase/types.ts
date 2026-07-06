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
      analytics_settings: {
        Row: {
          created_at: string
          id: string
          setting_key: string
          setting_value: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          setting_key: string
          setting_value: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          setting_key?: string
          setting_value?: string
          updated_at?: string
        }
        Relationships: []
      }
      attribute_definitions: {
        Row: {
          created_at: string
          id: string
          is_variant_axis: boolean
          key: string
          label: string
          options: Json
          sort_order: number
          type: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_variant_axis?: boolean
          key: string
          label: string
          options?: Json
          sort_order?: number
          type?: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_variant_axis?: boolean
          key?: string
          label?: string
          options?: Json
          sort_order?: number
          type?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      feed_runs: {
        Row: {
          error: string | null
          feed_key: string
          file_path: string | null
          file_size_bytes: number | null
          finished_at: string | null
          id: string
          product_count: number | null
          started_at: string
          status: string
        }
        Insert: {
          error?: string | null
          feed_key: string
          file_path?: string | null
          file_size_bytes?: number | null
          finished_at?: string | null
          id?: string
          product_count?: number | null
          started_at?: string
          status?: string
        }
        Update: {
          error?: string | null
          feed_key?: string
          file_path?: string | null
          file_size_bytes?: number | null
          finished_at?: string | null
          id?: string
          product_count?: number | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      field_sync_policy: {
        Row: {
          description: string | null
          direction: string
          field_name: string
          master: string
          updated_at: string
        }
        Insert: {
          description?: string | null
          direction?: string
          field_name: string
          master: string
          updated_at?: string
        }
        Update: {
          description?: string | null
          direction?: string
          field_name?: string
          master?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_logs: {
        Row: {
          completed_at: string | null
          created_at: string
          deduplicated: number | null
          duplicate_eans: Json | null
          ean_snapshot: Json | null
          errors: Json | null
          id: string
          imported: number | null
          results: Json
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
          duplicate_eans?: Json | null
          ean_snapshot?: Json | null
          errors?: Json | null
          id?: string
          imported?: number | null
          results?: Json
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
          duplicate_eans?: Json | null
          ean_snapshot?: Json | null
          errors?: Json | null
          id?: string
          imported?: number | null
          results?: Json
          skipped?: number | null
          source?: string
          started_at?: string
          status?: string
          total_fetched?: number | null
        }
        Relationships: []
      }
      master_product_collections: {
        Row: {
          collection_id: string
          created_at: string
          id: string
          master_product_id: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          id?: string
          master_product_id: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          id?: string
          master_product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_product_collections_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "shopify_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_product_collections_master_product_id_fkey"
            columns: ["master_product_id"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["id"]
          },
        ]
      }
      master_products: {
        Row: {
          attributes: Json | null
          auto_stock_sync: boolean
          backorder_policy: string
          backorders_allowed: boolean | null
          brand: string | null
          categories: string[]
          category: string | null
          created_at: string
          custom_markup_percentage: number | null
          ean: string
          exclude_from_feeds: boolean
          id: string
          image_url: string | null
          last_shopify_sync_at: string | null
          last_shopify_sync_status: string | null
          lifecycle_status: string
          long_description: string | null
          low_margin_guard: string
          low_margin_threshold: number | null
          meta_description: string | null
          meta_title: string | null
          min_sync_margin: number | null
          sale_price: number | null
          shopify_product_id: string | null
          shopify_sync_enabled: boolean
          shopify_variant_id: string | null
          short_description: string | null
          sku: string | null
          stock_quantity: number | null
          stock_status: string | null
          stock_sync_interval: string | null
          stock_sync_supplier_id: string | null
          stock_sync_supplier_ids: string[] | null
          sync_tags: string[]
          title: string
          updated_at: string
          webshop_parent_id: string | null
          webshop_platform: string | null
          webshop_price: number | null
          webshop_product_id: string | null
          weight_kg: number | null
        }
        Insert: {
          attributes?: Json | null
          auto_stock_sync?: boolean
          backorder_policy?: string
          backorders_allowed?: boolean | null
          brand?: string | null
          categories?: string[]
          category?: string | null
          created_at?: string
          custom_markup_percentage?: number | null
          ean: string
          exclude_from_feeds?: boolean
          id?: string
          image_url?: string | null
          last_shopify_sync_at?: string | null
          last_shopify_sync_status?: string | null
          lifecycle_status?: string
          long_description?: string | null
          low_margin_guard?: string
          low_margin_threshold?: number | null
          meta_description?: string | null
          meta_title?: string | null
          min_sync_margin?: number | null
          sale_price?: number | null
          shopify_product_id?: string | null
          shopify_sync_enabled?: boolean
          shopify_variant_id?: string | null
          short_description?: string | null
          sku?: string | null
          stock_quantity?: number | null
          stock_status?: string | null
          stock_sync_interval?: string | null
          stock_sync_supplier_id?: string | null
          stock_sync_supplier_ids?: string[] | null
          sync_tags?: string[]
          title: string
          updated_at?: string
          webshop_parent_id?: string | null
          webshop_platform?: string | null
          webshop_price?: number | null
          webshop_product_id?: string | null
          weight_kg?: number | null
        }
        Update: {
          attributes?: Json | null
          auto_stock_sync?: boolean
          backorder_policy?: string
          backorders_allowed?: boolean | null
          brand?: string | null
          categories?: string[]
          category?: string | null
          created_at?: string
          custom_markup_percentage?: number | null
          ean?: string
          exclude_from_feeds?: boolean
          id?: string
          image_url?: string | null
          last_shopify_sync_at?: string | null
          last_shopify_sync_status?: string | null
          lifecycle_status?: string
          long_description?: string | null
          low_margin_guard?: string
          low_margin_threshold?: number | null
          meta_description?: string | null
          meta_title?: string | null
          min_sync_margin?: number | null
          sale_price?: number | null
          shopify_product_id?: string | null
          shopify_sync_enabled?: boolean
          shopify_variant_id?: string | null
          short_description?: string | null
          sku?: string | null
          stock_quantity?: number | null
          stock_status?: string | null
          stock_sync_interval?: string | null
          stock_sync_supplier_id?: string | null
          stock_sync_supplier_ids?: string[] | null
          sync_tags?: string[]
          title?: string
          updated_at?: string
          webshop_parent_id?: string | null
          webshop_platform?: string | null
          webshop_price?: number | null
          webshop_product_id?: string | null
          weight_kg?: number | null
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
      product_analytics: {
        Row: {
          add_to_carts: number | null
          avg_position: number | null
          clicks: number | null
          conversion_rate: number | null
          created_at: string
          ctr: number | null
          id: string
          impressions: number | null
          master_product_id: string
          matched_url: string | null
          page_views: number | null
          period_end: string
          period_start: string
          purchases: number | null
          updated_at: string
        }
        Insert: {
          add_to_carts?: number | null
          avg_position?: number | null
          clicks?: number | null
          conversion_rate?: number | null
          created_at?: string
          ctr?: number | null
          id?: string
          impressions?: number | null
          master_product_id: string
          matched_url?: string | null
          page_views?: number | null
          period_end: string
          period_start: string
          purchases?: number | null
          updated_at?: string
        }
        Update: {
          add_to_carts?: number | null
          avg_position?: number | null
          clicks?: number | null
          conversion_rate?: number | null
          created_at?: string
          ctr?: number | null
          id?: string
          impressions?: number | null
          master_product_id?: string
          matched_url?: string | null
          page_views?: number | null
          period_end?: string
          period_start?: string
          purchases?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_analytics_master_product_id_fkey"
            columns: ["master_product_id"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_change_log: {
        Row: {
          change_type: string
          created_at: string
          field_name: string
          id: string
          master_product_id: string
          new_value: string | null
          old_value: string | null
          source: string | null
        }
        Insert: {
          change_type: string
          created_at?: string
          field_name: string
          id?: string
          master_product_id: string
          new_value?: string | null
          old_value?: string | null
          source?: string | null
        }
        Update: {
          change_type?: string
          created_at?: string
          field_name?: string
          id?: string
          master_product_id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_change_log_master_product_id_fkey"
            columns: ["master_product_id"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_recommendations: {
        Row: {
          action_suggestion: string | null
          created_at: string
          data: Json | null
          description: string
          id: string
          is_dismissed: boolean
          master_product_id: string
          recommendation_type: string
          resolved_at: string | null
          severity: string
          title: string
        }
        Insert: {
          action_suggestion?: string | null
          created_at?: string
          data?: Json | null
          description: string
          id?: string
          is_dismissed?: boolean
          master_product_id: string
          recommendation_type: string
          resolved_at?: string | null
          severity?: string
          title: string
        }
        Update: {
          action_suggestion?: string | null
          created_at?: string
          data?: Json | null
          description?: string
          id?: string
          is_dismissed?: boolean
          master_product_id?: string
          recommendation_type?: string
          resolved_at?: string | null
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_recommendations_master_product_id_fkey"
            columns: ["master_product_id"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_translations: {
        Row: {
          attributes: Json | null
          created_at: string
          id: string
          language_code: string
          long_description: string | null
          master_product_id: string
          meta_description: string | null
          meta_title: string | null
          short_description: string | null
          source: string
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          attributes?: Json | null
          created_at?: string
          id?: string
          language_code: string
          long_description?: string | null
          master_product_id: string
          meta_description?: string | null
          meta_title?: string | null
          short_description?: string | null
          source?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          attributes?: Json | null
          created_at?: string
          id?: string
          language_code?: string
          long_description?: string | null
          master_product_id?: string
          meta_description?: string | null
          meta_title?: string | null
          short_description?: string | null
          source?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_translations_master_product_id_fkey"
            columns: ["master_product_id"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          attributes: Json
          created_at: string
          ean: string | null
          id: string
          master_product_id: string
          position: number
          purchase_price: number | null
          sale_price: number | null
          shopify_inventory_item_id: string | null
          shopify_variant_id: string | null
          sku: string | null
          stock_quantity: number | null
          updated_at: string
          webshop_price: number | null
          weight: number | null
          weight_kg: number | null
        }
        Insert: {
          attributes?: Json
          created_at?: string
          ean?: string | null
          id?: string
          master_product_id: string
          position?: number
          purchase_price?: number | null
          sale_price?: number | null
          shopify_inventory_item_id?: string | null
          shopify_variant_id?: string | null
          sku?: string | null
          stock_quantity?: number | null
          updated_at?: string
          webshop_price?: number | null
          weight?: number | null
          weight_kg?: number | null
        }
        Update: {
          attributes?: Json
          created_at?: string
          ean?: string | null
          id?: string
          master_product_id?: string
          position?: number
          purchase_price?: number | null
          sale_price?: number | null
          shopify_inventory_item_id?: string | null
          shopify_variant_id?: string | null
          sku?: string | null
          stock_quantity?: number | null
          updated_at?: string
          webshop_price?: number | null
          weight?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_master_product_id_fkey"
            columns: ["master_product_id"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_lines: {
        Row: {
          created_at: string
          id: string
          list_price: number
          pim_product_id: string | null
          product_name: string
          purchase_price: number
          quantity: number
          quote_id: string
          quote_price: number
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          list_price?: number
          pim_product_id?: string | null
          product_name?: string
          purchase_price?: number
          quantity?: number
          quote_id: string
          quote_price?: number
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          list_price?: number
          pim_product_id?: string | null
          product_name?: string
          purchase_price?: number
          quantity?: number
          quote_id?: string
          quote_price?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_lines_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          created_at: string
          customer_name: string
          dinero_contact_guid: string | null
          dinero_voucher_guid: string | null
          id: string
          note_customer: string | null
          note_internal: string | null
          package_price: number | null
          quote_date: string
          quote_number: number
          status: string
          total_excl_vat: number
          total_purchase_price: number
          updated_at: string
          valid_days: number
        }
        Insert: {
          created_at?: string
          customer_name?: string
          dinero_contact_guid?: string | null
          dinero_voucher_guid?: string | null
          id?: string
          note_customer?: string | null
          note_internal?: string | null
          package_price?: number | null
          quote_date?: string
          quote_number?: number
          status?: string
          total_excl_vat?: number
          total_purchase_price?: number
          updated_at?: string
          valid_days?: number
        }
        Update: {
          created_at?: string
          customer_name?: string
          dinero_contact_guid?: string | null
          dinero_voucher_guid?: string | null
          id?: string
          note_customer?: string | null
          note_internal?: string | null
          package_price?: number | null
          quote_date?: string
          quote_number?: number
          status?: string
          total_excl_vat?: number
          total_purchase_price?: number
          updated_at?: string
          valid_days?: number
        }
        Relationships: []
      }
      shopify_collections: {
        Row: {
          analytics_updated_at: string | null
          collection_type: string
          created_at: string
          description_html: string | null
          handle: string | null
          id: string
          image_url: string | null
          last_shopify_sync_at: string | null
          meta_description: string | null
          meta_title: string | null
          products_count: number
          sessions_30d: number
          shopify_collection_id: string
          sort_order: string | null
          title: string
          updated_at: string
          views_30d: number
        }
        Insert: {
          analytics_updated_at?: string | null
          collection_type?: string
          created_at?: string
          description_html?: string | null
          handle?: string | null
          id?: string
          image_url?: string | null
          last_shopify_sync_at?: string | null
          meta_description?: string | null
          meta_title?: string | null
          products_count?: number
          sessions_30d?: number
          shopify_collection_id: string
          sort_order?: string | null
          title: string
          updated_at?: string
          views_30d?: number
        }
        Update: {
          analytics_updated_at?: string | null
          collection_type?: string
          created_at?: string
          description_html?: string | null
          handle?: string | null
          id?: string
          image_url?: string | null
          last_shopify_sync_at?: string | null
          meta_description?: string | null
          meta_title?: string | null
          products_count?: number
          sessions_30d?: number
          shopify_collection_id?: string
          sort_order?: string | null
          title?: string
          updated_at?: string
          views_30d?: number
        }
        Relationships: []
      }
      shopify_connection: {
        Row: {
          access_token: string
          id: string
          installed_at: string
          is_active: boolean
          primary_domain_url: string | null
          requested_shop_domain: string | null
          scope: string | null
          shop_domain: string
          shop_name: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          id?: string
          installed_at?: string
          is_active?: boolean
          primary_domain_url?: string | null
          requested_shop_domain?: string | null
          scope?: string | null
          shop_domain: string
          shop_name?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          id?: string
          installed_at?: string
          is_active?: boolean
          primary_domain_url?: string | null
          requested_shop_domain?: string | null
          scope?: string | null
          shop_domain?: string
          shop_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      shopify_oauth_state: {
        Row: {
          created_at: string
          expires_at: string
          shop_domain: string
          state: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          shop_domain: string
          state: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          shop_domain?: string
          state?: string
        }
        Relationships: []
      }
      shopify_processed_orders: {
        Row: {
          line_count: number
          order_id: number
          processed_at: string
          raw: Json | null
          shopify_order_number: string | null
          skipped_reason: string | null
          total_decremented: number
        }
        Insert: {
          line_count?: number
          order_id: number
          processed_at?: string
          raw?: Json | null
          shopify_order_number?: string | null
          skipped_reason?: string | null
          total_decremented?: number
        }
        Update: {
          line_count?: number
          order_id?: number
          processed_at?: string
          raw?: Json | null
          shopify_order_number?: string | null
          skipped_reason?: string | null
          total_decremented?: number
        }
        Relationships: []
      }
      shopify_queue_worker_state: {
        Row: {
          id: boolean
          last_poked_at: string
        }
        Insert: {
          id?: boolean
          last_poked_at?: string
        }
        Update: {
          id?: boolean
          last_poked_at?: string
        }
        Relationships: []
      }
      shopify_skipped_orders: {
        Row: {
          created_at: string
          id: string
          order_id: number
          raw: Json | null
          shopify_order_number: string | null
          skipped_reason: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: number
          raw?: Json | null
          shopify_order_number?: string | null
          skipped_reason: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: number
          raw?: Json | null
          shopify_order_number?: string | null
          skipped_reason?: string
        }
        Relationships: []
      }
      shopify_update_queue: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          master_product_id: string
          max_attempts: number
          next_attempt_at: string
          payload: Json
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          master_product_id: string
          max_attempts?: number
          next_attempt_at?: string
          payload?: Json
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          master_product_id?: string
          max_attempts?: number
          next_attempt_at?: string
          payload?: Json
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      shopify_webhook_config: {
        Row: {
          id: number
          orders_cutoff_at: string | null
          orders_webhook_id: string | null
          registered_at: string | null
          updated_at: string
        }
        Insert: {
          id?: number
          orders_cutoff_at?: string | null
          orders_webhook_id?: string | null
          registered_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: number
          orders_cutoff_at?: string | null
          orders_webhook_id?: string | null
          registered_at?: string | null
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
          weight_kg: number | null
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
          weight_kg?: number | null
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
          weight_kg?: number | null
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
      shopify_connection_status: {
        Row: {
          id: string | null
          installed_at: string | null
          is_active: boolean | null
          is_connected: boolean | null
          scope: string | null
          shop_domain: string | null
          updated_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_low_margin_guard: {
        Args: { p_master_product_id: string }
        Returns: undefined
      }
      approve_ean_suggestion: {
        Args: { p_ean: string; p_master_id: string }
        Returns: Json
      }
      decrement_stock_from_shopify_order: {
        Args: { p_master_product_id: string; p_qty: number }
        Returns: Json
      }
      ean_suggestions_diagnostic: { Args: never; Returns: Json }
      get_change_log_daily: {
        Args: { days?: number }
        Returns: {
          count: number
          day: string
          source: string
        }[]
      }
      get_db_stats: { Args: never; Returns: Json }
      get_monitoring_overview: { Args: never; Returns: Json }
      list_duplicate_eans: {
        Args: never
        Returns: {
          ean: string
          products: Json
        }[]
      }
      list_ean_diagnostic_products: {
        Args: { p_category: string }
        Returns: {
          current_ean: string
          image_url: string
          master_product_id: string
          note: string
          shopify_product_id: string
          sku: string
          title: string
        }[]
      }
      list_ean_suggestions: {
        Args: never
        Returns: {
          current_ean: string
          image_url: string
          master_product_id: string
          shopify_product_id: string
          shopify_variant_id: string
          sku: string
          suggested_ean: string
          title: string
          updated_at: string
        }[]
      }
      list_invalid_ean_product_ids: {
        Args: never
        Returns: {
          id: string
        }[]
      }
      merge_attribute_definitions: {
        Args: { p_source_id: string; p_target_id: string }
        Returns: Json
      }
      reapply_low_margin_guard_all: { Args: never; Returns: number }
      recompute_product_stock: {
        Args: { p_master_product_id: string }
        Returns: undefined
      }
      recompute_stock_for_supplier: {
        Args: { p_supplier_id: string }
        Returns: number
      }
      resolve_duplicate_ean: {
        Args: { p_ean: string; p_keep_id: string }
        Returns: Json
      }
      revert_change_log_entry: { Args: { p_log_id: string }; Returns: Json }
      set_bulk_supplier_import: {
        Args: { enabled: boolean }
        Returns: undefined
      }
      set_change_source: { Args: { source: string }; Returns: undefined }
      set_wc_trigger_enabled: {
        Args: { p_enabled: boolean }
        Returns: undefined
      }
      try_lock_shopify_queue_worker: { Args: never; Returns: boolean }
      unlock_shopify_queue_worker: { Args: never; Returns: boolean }
      verify_internal_invoke_secret: {
        Args: { p_secret: string }
        Returns: boolean
      }
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
