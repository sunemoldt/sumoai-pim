# Fix supplier import/rematch 504 timeouts

## Problem
- `supplier-feed-import`: 11× 504 in 24h. Also 65 runtime errors "No rows found in feed" at index.ts line 448 (unrelated parsing issue on some feeds).
- `supplier-rematch-product`: 10× 504 in 24h. It fans out to all active auto-feed suppliers in parallel and waits for each `supplier-feed-import` call to finish — inherits the largest feed's runtime, hitting the edge wall-clock limit.

## Approach: async jobs with status polling
1. Add table `public.supplier_import_jobs` (id, supplier_id, target_ean, status: pending|running|done|failed, started_at, finished_at, imported, error, source). RLS + GRANTs.
2. Refactor `supplier-feed-import`:
   - Accept optional `job_id`. If missing, create one, return `202 { job_id }` immediately, and run the existing pipeline inside `EdgeRuntime.waitUntil(...)`, updating the job row on completion/failure.
   - Keep a `sync=true` flag for internal cron callers that want the old blocking behavior.
3. Refactor `supplier-rematch-product`:
   - Create one parent job, spawn child `supplier-feed-import` calls with `waitUntil`, return `202 { job_id }` immediately.
4. Frontend (`QuickSupplierSyncButton`, `SupplierStatusTable`, rematch caller): after invoke, poll `supplier_import_jobs` by `job_id` (or realtime subscribe) and show progress; toast on final status.
5. Investigate the "No rows found in feed" errors at `supplier-feed-import/index.ts:448` — likely a parser edge case for certain CSV/XML shapes; add defensive logging of feed shape before throwing.

## Files
- new migration: `supplier_import_jobs` table + policies + GRANTs
- `supabase/functions/supplier-feed-import/index.ts`
- `supabase/functions/supplier-rematch-product/index.ts`
- `src/components/QuickSupplierSyncButton.tsx`
- `src/components/monitoring/SupplierStatusTable.tsx`
- any other callers of the two functions

## Risks
- Cron path (`scheduled-sync`) currently reads the response body — must pass `sync=true` or switch to polling.
- Concurrent rematch on the same supplier could duplicate work — dedupe on `(supplier_id, status in (pending,running))`.
