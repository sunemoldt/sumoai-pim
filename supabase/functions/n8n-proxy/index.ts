import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const N8N_API_KEY = Deno.env.get("N8N_API_KEY");
const N8N_BASE_URL_RAW = Deno.env.get("N8N_BASE_URL");

function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  // Strip trailing /api/v1 if user included it
  url = url.replace(/\/api\/v1$/, "");
  return url;
}

async function n8nFetch(path: string, init: RequestInit = {}) {
  const baseUrl = normalizeBaseUrl(N8N_BASE_URL_RAW!);
  const url = `${baseUrl}/api/v1${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "X-N8N-API-KEY": N8N_API_KEY!,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!N8N_API_KEY || !N8N_BASE_URL_RAW) {
    return new Response(JSON.stringify({ error: "n8n credentials not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action ?? "test";

    const ID_RE = /^[a-zA-Z0-9_-]+$/;
    const requireValidId = (val: unknown): string | Response => {
      if (typeof val !== "string" || !ID_RE.test(val) || val.length > 64) {
        return new Response(JSON.stringify({ error: "Invalid id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return val;
    };

    switch (action) {
      case "test": {
        // Lightweight verification call
        const r = await n8nFetch("/workflows?limit=1");
        return new Response(JSON.stringify({
          ok: r.ok,
          status: r.status,
          baseUrl: normalizeBaseUrl(N8N_BASE_URL_RAW),
          message: r.ok ? "Connection verified" : "n8n returned error",
          sample: r.ok ? r.data : undefined,
          error: !r.ok ? r.data : undefined,
        }), {
          status: r.ok ? 200 : 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      case "list_workflows": {
        const r = await n8nFetch(`/workflows?limit=${body.limit ?? 100}${body.active !== undefined ? `&active=${body.active}` : ""}`);
        return new Response(JSON.stringify(r.data), {
          status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      case "get_workflow": {
        const id = requireValidId(body.id); if (id instanceof Response) return id;
        const r = await n8nFetch(`/workflows/${id}`);
        return new Response(JSON.stringify(r.data), {
          status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      case "activate_workflow": {
        const id = requireValidId(body.id); if (id instanceof Response) return id;
        const r = await n8nFetch(`/workflows/${id}/activate`, { method: "POST" });
        return new Response(JSON.stringify(r.data), {
          status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      case "deactivate_workflow": {
        const id = requireValidId(body.id); if (id instanceof Response) return id;
        const r = await n8nFetch(`/workflows/${id}/deactivate`, { method: "POST" });
        return new Response(JSON.stringify(r.data), {
          status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      case "list_executions": {
        const params = new URLSearchParams();
        if (body.workflowId !== undefined) {
          const wid = requireValidId(body.workflowId); if (wid instanceof Response) return wid;
          params.set("workflowId", wid);
        }
        if (body.status) {
          const s = String(body.status);
          if (!/^[a-zA-Z_]+$/.test(s) || s.length > 32) {
            return new Response(JSON.stringify({ error: "Invalid status" }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          params.set("status", s);
        }
        const limit = Math.min(Math.max(parseInt(String(body.limit ?? 20), 10) || 20, 1), 250);
        params.set("limit", String(limit));
        const r = await n8nFetch(`/executions?${params.toString()}`);
        return new Response(JSON.stringify(r.data), {
          status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("n8n-proxy error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
