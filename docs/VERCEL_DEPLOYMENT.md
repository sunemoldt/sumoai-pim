# Vercel Deployment Guide

Frontend hostes på Vercel, backend (database + edge functions) forbliver på Lovable Cloud.

## 1. Forbind GitHub
I Lovable: **Plus (+) → GitHub → Connect project** og opret et repo.

## 2. Importér i Vercel
1. Gå til https://vercel.com/new
2. Vælg dit GitHub repo
3. Vercel detekterer Vite automatisk (vercel.json er allerede sat op)
4. Tilføj environment variables (se nedenfor)
5. Klik **Deploy**

## 3. Environment Variables (Vercel → Settings → Environment Variables)
```
VITE_SUPABASE_URL=https://qanxmacwntyxfhznxriz.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhbnhtYWN3bnR5eGZoem54cml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg4NTMsImV4cCI6MjA5MDU0NDg1M30.IzMFm6WSjjGtGCwDoxGmDQ_SRQ4WZu_9Ofqt5TLsyNI
VITE_SUPABASE_PROJECT_ID=qanxmacwntyxfhznxriz
```
Sæt for **Production**, **Preview** og **Development**.

## 4. Custom domæne (pim.sumoai.dk)
1. Vercel → Project → **Settings → Domains** → tilføj `pim.sumoai.dk`
2. Hos din DNS-udbyder: peg `pim` CNAME mod `cname.vercel-dns.com`
3. Fjern domænet fra Lovable publish settings når Vercel er live

## 5. Auto-deploy
Vercel deployer automatisk ved hver `git push` til main. Lovable pusher ændringer til GitHub i realtid, så Lovable-edits trigger Vercel-deploys automatisk.

## Notes
- `supabase/` mappen ignoreres (`.vercelignore`) — edge functions deployes stadig via Lovable.
- SPA-routing håndteres af `rewrites` i `vercel.json`.
- Alle assets caches 1 år (immutable hash i filnavn fra Vite).
