---
name: comtek-pim
description: Architecture, conventions, and operational rules for the Comtek PIM (pim.sumoai.dk) — a single-tenant Product Information Management system built on Lovable + Supabase, syncing master product data to Shopify with legacy WooCommerce support. Use this skill whenever working on the Comtek PIM codebase, adding features, debugging sync issues, writing migrations, or extending edge functions.
---

# Comtek PIM — Build & Operations Skill

A complete reference for how the Comtek PIM is designed and built. Drop this into Claude (or any agent) as project documentation.

---

## 1. Product overview

**What it is:** A single-tenant Product Information Management (PIM) system at **pim.sumoai.dk**. One Comtek-internal team manages products; users are created manually (no public sign-up).

**Core job:** Be the single source of truth for product data (titles, descriptions, EANs, pricing, stock, metadata, SEO) and push that data to a webshop — currently **Shopify** (active) with **WooCommerce** kept as legacy/paused.

**Key product principles:**
- **Shopify is master for product texts** (`title`, `short_description`, `long_description`). The PIM pulls texts from Shopify and never overwrites them with WooCommerce data.
- **PIM is master for pricing, stock, SEO metadata, supplier links, lifecycle.**
- **Margins are calculated excl. 25% Danish VAT.** Webshop prices are stored incl. VAT; supplier purchase prices are stored excl. VAT.
- **EAN normalization:** Always strip leading zeros before matching (`810177161929` matches `0810177161929`).
- **Single-tenant:** No multi-org logic. RLS still enabled everywhere, but policies are user-scoped, not org-scoped.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript 5 + Tailwind v3 + shadcn/ui |
| State / data | TanStack Query (React Query) |
| Routing | react-router-dom |
| Backend | Lovable Cloud (Supabase under the hood) |
| Database | Postgres with RLS, pg_cron, pg_net |
| Edge runtime | Deno (Supabase Edge Functions) |
| Auth | Supabase Auth (email/password + Google), manual user creation only |
| AI | Lovable AI Gateway (Gemini 2.5 Flash for content, RAG-lite) |
| Deploy | Lovable (preview + custom domain pim.sumoai.dk) |

Never call the backend "Supabase" in user-facing copy — use **Lovable Cloud / backend / database / auth / functions / storage**.

---

## 3. Data model (essentials)

### Core tables

- **`master_products`** — the canonical product. Holds `title`, `ean` (normalized, no leading zeros), `brand`, `category`, `webshop_price` (incl. VAT), `sale_price`, `stock_quantity`, `stock_status`, `lifecycle_status`, `auto_stock_sync`, `stock_sync_interval` (`hourly` | `daily` | `weekly`), `shopify_product_id`, `shopify_variant_id`, `webshop_parent_id` (variant grouping), `metadata` (JSONB technical attributes), `attributes`, descriptions, SEO fields, `sync_tags`.
- **`suppliers`** — supplier registry with `feed_url`, `feed_type` (`csv` | `xml` | `ftp` | `api` | `manual`), `feed_schedule` (cron expression or `manual`), `is_active`.
- **`supplier_products`** — per-supplier offer linked to a `master_product_id`. Holds `purchase_price` (excl. VAT), `stock_quantity`, `in_stock`, supplier-specific SKU. The cheapest **in-stock** supplier wins for pricing logic.
- **`price_settings`** — global + per-scope settings (`scope`, `scope_value`): default markup %, rounding rules, WC schedule, backorder policy, etc. Global settings require an explicit manual save.
- **`price_history`** — append-only purchase-price changes per `supplier_product_id`.
- **`product_change_log`** — audit trail of every field change (source: ui, sync, ai, import).
- **`product_analytics`** — page views, add-to-carts, purchases, conversion, GSC impressions/clicks/CTR/position per product.
- **`product_recommendations`** — AI-generated proactive recommendations (30-day window, dismiss/resolve).
- **`shopify_update_queue`** — outbound Shopify writes are enqueued, never direct. Drained by `shopify-queue-worker`.
- **`webhook_configs`** — outbound webhooks.
- **`user_roles`** — separate roles table (never store roles on profiles). Roles enum: `admin`, `moderator`, `user`. Checked via `public.has_role(uuid, app_role)` SECURITY DEFINER function.

### Required pattern for every public table

```sql
CREATE TABLE public.<name> (...);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<name> TO authenticated;
GRANT ALL ON public.<name> TO service_role;
-- only add: GRANT SELECT ON public.<name> TO anon; if a policy allows anon reads
ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY;
CREATE POLICY ... ;
```

PostgREST does **not** auto-grant on `public` — missing GRANTs = permission errors at runtime, even with RLS policies.

---

## 4. Edge functions (responsibilities)

All edge functions live under `supabase/functions/<name>/index.ts`. Conventions:

- CORS preflight handled at top.
- Auth: accept service-role / anon (pg_cron) tokens OR validate user JWT. Sensitive ops (admin actions, OAuth start, backups) **require** user JWT.
- Long-running external APIs → set timeouts to **55s** (just under Supabase's 60s edge limit).
- Use `SUPABASE_SERVICE_ROLE_KEY` only server-side (never returned, never logged).

### Function map

| Function | Purpose |
|---|---|
| `scheduled-sync` | Master cron entry. Runs supplier feeds, WC import schedule, and the stock-sync safety-net sweep (only at minute 0, filtered by `stock_sync_interval`). |
| `supplier-feed-import` / `supplier-feed-preview` | Parse CSV/XML/FTP/API supplier feeds, EAN-match, upsert `supplier_products`. |
| `supplier-rematch-product` | Manually re-link a master product to supplier offers. |
| `wc-import` / `wc-update-product` | Legacy WooCommerce sync (paused). |
| `shopify-oauth-start` / `shopify-oauth-callback` | OAuth dance. User JWT required on GET and POST. |
| `shopify-import` / `shopify-pull` | Pull products + texts from Shopify (Shopify is text master). |
| `shopify-match` / `shopify-rematch` / `shopify-dedupe-product` | Match PIM ↔ Shopify products by EAN/SKU. |
| `shopify-create-product` / `shopify-update-product` | Write to Shopify. Always called via the queue. |
| `shopify-queue-worker` | Drains `shopify_update_queue`. Scheduled by pg_cron. Early-exit when queue empty. |
| `shopify-order-webhook` / `shopify-register-webhook` | Order events back into PIM analytics. |
| `shopify-seo-backfill`, `shopify-clear-barcode`, `shopify-fix-barcode`, `shopify-metafield-probe`, `shopify-compare`, `shopify-admin-test`, `shopify-connections` | Maintenance/admin tools. |
| `ai-generate-product` / `ai-rewrite-description` / `ai-analyze` / `bulk-clean-descriptions` | Lovable AI Gateway (Gemini 2.5 Flash) for content. |
| `fetch-analytics` | Pulls GSC + GA into `product_analytics`. |
| `nightly-backup` | EAN-keyed CSV export (UTF-8 BOM, semicolon delimiter). User JWT OR pg_cron token required. |
| `mcp-server` | MCP (Model Context Protocol) server with OAuth 2.1 + mandatory PKCE + redirect_uri host allowlist. Exposes 15 tools to Claude / Manus.ai. |
| `n8n-proxy` | n8n workflow integration. |
| `dinero-send-quote` | Dinero invoicing integration. |

---

## 5. Sync architecture

### Pull (Shopify → PIM)
`shopify-import` / `shopify-pull` pulls product texts. Texts overwrite local — Shopify wins.

### Push (PIM → Shopify)
Never call Shopify directly from app code. Every outbound write is **enqueued** into `shopify_update_queue` and drained by `shopify-queue-worker` (pg_cron). This gives:
- Retry on transient failures.
- Rate-limit safety.
- Auditability.

A DB trigger `auto_enqueue_shopify_update` enqueues a job when relevant fields change.

### Stock sync
- DB triggers keep stock live on every `supplier_products` change via `recompute_product_stock(p_master_product_id)`.
- `scheduled-sync` runs a **safety-net sweep** only at minute 0, filtered server-side by `stock_sync_interval`:
  - `hourly` — every hour at :00.
  - `daily` — at 06:00 UTC.
  - `weekly` — at 06:00 UTC on Monday.
- `recompute_product_stock` is no-op-guarded with `IS DISTINCT FROM` to avoid pointless UPDATEs / WAL / trigger fanout.

### Supplier feeds
Per-supplier cron expression in `suppliers.feed_schedule`. `scheduled-sync` evaluates the expression each tick and invokes `supplier-feed-import` for matching suppliers.

---

## 6. Pricing & margin rules (non-negotiable)

- All margin math is **excl. VAT** (Danish VAT 25%).
- `webshop_price` and `sale_price` stored **incl. VAT**.
- `purchase_price` (supplier) stored **excl. VAT**.
- Helpers in `src/hooks/use-products.ts`:
  - `exVat(p)` / `inclVat(p)` — convert.
  - `getRecommendedPrice(purchaseEx, markupPct)` — ex-VAT result.
  - `getRecommendedPriceInclVat(...)` — incl-VAT result for display.
  - `getMarginPercent(saleEx, purchaseEx)` — % margin.
  - `getCheapestSupplier(list)` — cheapest **in-stock** supplier.
  - `getCheapestSupplierAny(list)` — cheapest regardless of stock.
- Low-margin guard: dashboard flags products with margin `< 10%` or `> 40%` (top 10).
- Rounding rules and default markup live in `price_settings` and require explicit user save.

---

## 7. Frontend conventions

### Routing & pages (`src/pages/`)
`DashboardPage`, `ProductListPage`, `ProductDetailPage`, `NewProductPage`, `SupplierListPage`, `ImportPage`, `ShopifyPage`, `MonitoringPage`, `SettingsPage`, `QuoteListPage`, `QuoteEditorPage`, `N8nWorkflowsPage`, `LoginPage`, `ResetPasswordPage`.

### Data layer
`src/hooks/use-products.ts` is the central data hook module. Patterns:
- **Explicit column lists** for list queries — never `select("*")` on `master_products` in the list view (40 columns incl. heavy JSONB). Use `LIST_COLUMNS` and `LIST_SUPPLIER_COLUMNS`.
- **`staleTime: 60_000`** on list queries to avoid refetch-on-navigation.
- Detail query (`useMasterProduct`) can use `*` since it's one row.
- Search: EAN search must try both with and without leading zeros.

### URL state
Filters, search, and pagination live in URL params. Back navigation uses browser history (`navigate(-1)`), never reset to root.

### UI direction
Shopify- and Notion-inspired clean UI. Tables merge product + supplier data. Protect against HTML overflow in long descriptions (truncate/scroll containers). Semantic design tokens in `src/index.css` — never hardcode `text-white` / `bg-black` / `bg-[#...]`.

### Components of note
- `ShopifyQueueCard`, `ShopifyBulkPullCard`, `ShopifyRematchCard`, `ShopifyOrderSyncCard` — Shopify ops.
- `WoocommerceForcePushCard`, `WoocommerceToggleCard` — legacy WC.
- `NightlyBackupCard`, `CleanupAuditCard`, `LowMarginGuardCard`, `ProductLowMarginGuardCard`.
- `AiInsightsWidget`, `AiGenerateAllDialog`, `DescriptionAiActions`.
- `SupplierMappingDialog`, `SupplierFormDialog`, `ManualSupplierPriceDialog`, `QuickSupplierSyncButton`.
- `MergeProductDialog`, `ProductVariantsTab`, `ProductTranslationsTab`.
- `AttributeDefinitionsCard`, `FieldSyncPolicyCard`, `LanguageSettingsCard`, `SyncTagsEditor`.

---

## 8. Variants & duplicates

- Variants are linked via `webshop_parent_id` on `master_products`.
- WooCommerce variants prioritized `_avecdo_ean` meta when matching.
- Duplicate management: a fallback-EAN strategy with `wc-` prefix for products missing real EANs, and a "shared EAN best-match" picker for true duplicates.

---

## 9. Security model

- **RLS enabled on every public table.** Single-tenant scoping is via `auth.uid()`.
- **Roles in `user_roles`** with `has_role()` SECURITY DEFINER. Never on the profile/users table.
- **No anonymous sign-ups.** Manual user provisioning only.
- **No auto-confirm email** unless explicitly requested.
- **Google auth** is a supported provider.
- **MCP server**: OAuth 2.1 with **mandatory PKCE** (`code_challenge` at `/authorize`, SHA-256 verified `code_verifier` at `/token`) and a **redirect_uri host allowlist** (Claude/Anthropic/ChatGPT/OpenAI/localhost; extend via `MCP_ALLOWED_REDIRECT_HOSTS`).
- **Service role key / DB password are not available on Lovable Cloud** — never reference them in user-facing flows or instructions.
- **Edge functions that pg_cron calls** accept service-role/anon key OR a valid user JWT; everything else must present a user JWT.

---

## 10. Automation surface

- **pg_cron schedules** (created with `verify_jwt=false` so cron can hit functions):
  - `scheduled-sync` — every minute (cheap; minute-0 gate inside).
  - `shopify-queue-worker` — drains queue (early-exit when empty).
  - Customizable per supplier via `feed_schedule`.
- **MCP server** exposes 15 tools (search products, update fields, run syncs, fetch analytics, etc.) to Claude / Manus.ai via Bearer token.
- **Webhooks** — outbound configured in `webhook_configs`, Shopify order webhook inbound.
- **n8n** integration via `n8n-proxy`.

---

## 11. Performance rules (learned the hard way)

1. **Index everything you sort or filter on at scale.** Mandatory indexes:
   - `idx_master_products_title` on `master_products(title)` — list view sort.
   - Partial `idx_master_products_auto_stock_sync_true` where `auto_stock_sync = true`.
   - `idx_product_analytics_updated_at` DESC.
2. **No `select("*")` on `master_products` in list views.** Use explicit column lists; heavy JSONB (`metadata`, `long_description`, `attributes`) stays out.
3. **`recompute_product_stock` must use `IS DISTINCT FROM`** to skip no-op UPDATEs.
4. **`scheduled-sync` gates by `minute === 0` BEFORE querying**, and filters `stock_sync_interval` server-side with `.in([...])`.
5. **React Query `staleTime: 60_000`** on list queries.
6. **Edge function timeouts: 55s** for slow external APIs (Aurdel/Distit/Aurora XML, Shopify bulk).

---

## 12. Intelligence layer

- **Lovable AI Gateway** with Gemini 2.5 Flash, RAG-lite over product context.
- 30-day rolling window for `product_recommendations`.
- Bulk content tools: `ai-generate-product`, `ai-rewrite-description`, `bulk-clean-descriptions`, `ai-analyze`.
- AI never overwrites Shopify-mastered texts unless the user explicitly accepts.

---

## 13. Data governance

- **Nightly backup** → EAN-keyed CSV, UTF-8 with BOM, semicolon delimiter (Excel/DK compatible).
- **Batch import logs** with diff-checking before commit.
- **`product_change_log`** records every change with source attribution.
- **EAN normalization is mandatory at every entry point** (import, manual entry, API).

---

## 14. Working agreements for an agent on this codebase

When modifying this project:

1. **Read before editing.** Check `src/hooks/use-products.ts`, the relevant page, and the relevant edge function before changing behavior.
2. **Never `select("*")` on `master_products` list queries.** Add the column to `LIST_COLUMNS` in `src/hooks/use-products.ts` if needed — and verify it exists in the table first (a non-existent column breaks the whole list with a 400).
3. **Every new public table needs GRANTs + RLS + policies in the same migration.**
4. **Shopify writes go through the queue.** Don't call Shopify APIs directly from new code.
5. **VAT math: ex-VAT for margins, incl-VAT for display prices.** Use the helpers.
6. **Strip leading zeros from EANs** at every entry point.
7. **Don't rename Lovable Cloud to "Supabase"** in UI copy.
8. **Don't touch** `src/integrations/supabase/client.ts`, `types.ts`, the auto-generated `.env`, or `supabase/config.toml` project-level settings.
9. **Global settings need an explicit save action** — never auto-apply.
10. **Filters live in URL params**; back navigation uses `navigate(-1)`.

---

## 15. Quick reference — file map

```
src/
  pages/                    # route-level screens
  components/               # feature components + ui/ (shadcn)
  hooks/use-products.ts     # central data layer (queries, VAT helpers, types)
  contexts/AuthContext.tsx  # session
  integrations/supabase/    # auto-generated client + types (DO NOT EDIT)
  index.css                 # semantic design tokens
supabase/
  functions/<name>/         # edge functions (Deno)
  migrations/               # SQL migrations (with GRANTs + RLS)
  config.toml               # auto-generated (DO NOT EDIT project-level)
docs/
  PIM_SYSTEM.md             # human-readable product spec
  VERCEL_DEPLOYMENT.md
  COMTEK_PIM_SKILL.md       # this file
```

---

**End of skill.** This file is the canonical onboarding doc for any agent touching the Comtek PIM.
