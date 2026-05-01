import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, CheckCircle2, XCircle, Workflow, ExternalLink, X, Tag, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { da } from "date-fns/locale";

const DEFAULT_PIM_TAGS = ["pim", "sumoai-pim", "sumoai", "comtek-pim"];
const TAGS_SETTING_KEY = "n8n_pim_tags";

interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  tags?: { id: string; name: string }[];
}

interface N8nExecution {
  id: string;
  workflowId: string;
  finished: boolean;
  status?: string;
  startedAt: string;
  stoppedAt?: string;
  mode: string;
}

async function callN8nProxy(action: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("n8n-proxy", {
    body: { action, ...extra },
  });
  if (error) throw error;
  return data;
}

export default function N8nWorkflowsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; baseUrl?: string } | null>(null);
  const [tagInput, setTagInput] = useState("");

  const tagsQuery = useQuery({
    queryKey: ["n8n-pim-tags"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analytics_settings")
        .select("setting_value")
        .eq("setting_key", TAGS_SETTING_KEY)
        .maybeSingle();
      if (error) throw error;
      if (!data?.setting_value) return DEFAULT_PIM_TAGS;
      try {
        const parsed = JSON.parse(data.setting_value);
        return Array.isArray(parsed) && parsed.length > 0 ? parsed.map(String) : DEFAULT_PIM_TAGS;
      } catch {
        return DEFAULT_PIM_TAGS;
      }
    },
  });

  const pimTags = tagsQuery.data ?? DEFAULT_PIM_TAGS;

  const saveTagsMutation = useMutation({
    mutationFn: async (next: string[]) => {
      const value = JSON.stringify(next);
      const { data: existing } = await supabase
        .from("analytics_settings")
        .select("id")
        .eq("setting_key", TAGS_SETTING_KEY)
        .maybeSingle();
      if (existing) {
        const { error } = await supabase
          .from("analytics_settings")
          .update({ setting_value: value, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("analytics_settings")
          .insert({ setting_key: TAGS_SETTING_KEY, setting_value: value });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["n8n-pim-tags"] });
      toast({ title: "Tags gemt" });
    },
    onError: (err: Error) => toast({ title: "Kunne ikke gemme", description: err.message, variant: "destructive" }),
  });

  const addTag = () => {
    const v = tagInput.trim().toLowerCase();
    if (!v) return;
    if (pimTags.map((t) => t.toLowerCase()).includes(v)) {
      setTagInput("");
      return;
    }
    saveTagsMutation.mutate([...pimTags, v]);
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    saveTagsMutation.mutate(pimTags.filter((t) => t !== tag));
  };

  const workflowsQuery = useQuery({
    queryKey: ["n8n-workflows"],
    queryFn: async () => {
      const data = await callN8nProxy("list_workflows", { limit: 100 });
      return (data?.data ?? []) as N8nWorkflow[];
    },
  });

  const executionsQuery = useQuery({
    queryKey: ["n8n-executions"],
    queryFn: async () => {
      const data = await callN8nProxy("list_executions", { limit: 20 });
      return (data?.data ?? []) as N8nExecution[];
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      return callN8nProxy(active ? "activate_workflow" : "deactivate_workflow", { id });
    },
    onSuccess: (_d, vars) => {
      toast({ title: vars.active ? "Workflow aktiveret" : "Workflow deaktiveret" });
      qc.invalidateQueries({ queryKey: ["n8n-workflows"] });
    },
    onError: (err: Error) => {
      toast({ title: "Fejl", description: err.message, variant: "destructive" });
    },
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const data = await callN8nProxy("test");
      setTestResult({ ok: data.ok, message: data.message, baseUrl: data.baseUrl });
      toast({ title: data.ok ? "Forbindelse OK ✅" : "Forbindelse fejlede" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ukendt fejl";
      setTestResult({ ok: false, message: msg });
      toast({ title: "Fejl", description: msg, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const tagSet = new Set(pimTags.map((t) => t.toLowerCase().trim()));
  const allWorkflows = workflowsQuery.data ?? [];
  const workflows = allWorkflows.filter((w) =>
    (w.tags ?? []).some((t) => tagSet.has(t.name.toLowerCase().trim()))
  );
  const hiddenCount = allWorkflows.length - workflows.length;
  const pimWorkflowIds = new Set(workflows.map((w) => w.id));
  const allExecutions = executionsQuery.data ?? [];
  const executions = allExecutions.filter((ex) => pimWorkflowIds.has(ex.workflowId));
  const activeCount = workflows.filter((w) => w.active).length;

  const workflowMap = new Map(workflows.map((w) => [w.id, w.name]));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">n8n Workflows</h1>
          <p className="text-sm text-muted-foreground">
            Viser kun workflows tagget med {pimTags.length === 0 ? <em>ingen tags konfigureret</em> : pimTags.map((t) => <code key={t} className="mr-1 rounded bg-muted px-1">{t}</code>)} i n8n
            {hiddenCount > 0 && ` · ${hiddenCount} skjult`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Test forbindelse
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["n8n-workflows"] });
              qc.invalidateQueries({ queryKey: ["n8n-executions"] });
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Opdater
          </Button>
        </div>
      </div>

      {testResult && (
        <Card className={testResult.ok ? "border-green-500/40" : "border-destructive/40"}>
          <CardContent className="flex items-center gap-3 p-4">
            {testResult.ok ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : (
              <XCircle className="h-5 w-5 text-destructive" />
            )}
            <div className="flex-1">
              <p className="text-sm font-medium">{testResult.message}</p>
              {testResult.baseUrl && (
                <p className="text-xs text-muted-foreground">{testResult.baseUrl}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Tag className="h-4 w-4" /> PIM-tags
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Workflows i n8n med ét af disse tags vises her. Tilføj samme tag på workflowet i n8n.
          </p>
          <div className="flex flex-wrap gap-2">
            {pimTags.length === 0 ? (
              <span className="text-xs text-muted-foreground">Ingen tags – tilføj mindst ét nedenfor</span>
            ) : (
              pimTags.map((t) => (
                <Badge key={t} variant="secondary" className="gap-1 pr-1">
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    disabled={saveTagsMutation.isPending}
                    className="ml-1 rounded p-0.5 hover:bg-background/60"
                    aria-label={`Fjern ${t}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="fx pim, sumoai-pim"
              className="max-w-xs"
            />
            <Button onClick={addTag} disabled={saveTagsMutation.isPending || !tagInput.trim()} variant="outline">
              <Plus className="mr-1 h-4 w-4" /> Tilføj
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Workflows total</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{workflows.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Aktive</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-green-600">{activeCount}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Seneste executions</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{executions.length}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Workflow className="h-5 w-5" /> Workflows</CardTitle>
        </CardHeader>
        <CardContent>
          {workflowsQuery.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : workflowsQuery.error ? (
            <p className="text-sm text-destructive">Fejl: {(workflowsQuery.error as Error).message}</p>
          ) : workflows.length === 0 ? (
            <div className="space-y-1 py-2">
              <p className="text-sm text-muted-foreground">Ingen PIM-koblede workflows fundet.</p>
              <p className="text-xs text-muted-foreground">
                Tilføj et af tags ({pimTags.join(", ") || "ingen konfigureret"}) til de workflows i n8n du vil se her.
                {allWorkflows.length > 0 && ` (${allWorkflows.length} andre workflows ignoreret.)`}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {workflows.map((wf) => (
                <div key={wf.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{wf.name}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{wf.id}</span>
                      <span>•</span>
                      <span>Opdateret {formatDistanceToNow(new Date(wf.updatedAt), { addSuffix: true, locale: da })}</span>
                      {wf.tags?.map((t) => (
                        <Badge key={t.id} variant="secondary" className="text-xs">{t.name}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={wf.active ? "default" : "secondary"}>
                      {wf.active ? "Aktiv" : "Inaktiv"}
                    </Badge>
                    <Switch
                      checked={wf.active}
                      disabled={toggleMutation.isPending}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: wf.id, active: checked })}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ExternalLink className="h-5 w-5" /> Seneste executions</CardTitle>
        </CardHeader>
        <CardContent>
          {executionsQuery.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : executions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen executions endnu</p>
          ) : (
            <div className="divide-y divide-border">
              {executions.map((ex) => {
                const ok = ex.status === "success" || (ex.finished && !ex.status);
                const failed = ex.status === "error" || ex.status === "failed";
                return (
                  <div key={ex.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                    <div className="flex items-center gap-3">
                      {failed ? (
                        <XCircle className="h-4 w-4 text-destructive" />
                      ) : ok ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      <div>
                        <p className="font-medium">{workflowMap.get(ex.workflowId) ?? ex.workflowId}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(ex.startedAt), { addSuffix: true, locale: da })} • {ex.mode}
                        </p>
                      </div>
                    </div>
                    <Badge variant={failed ? "destructive" : ok ? "default" : "secondary"}>
                      {ex.status ?? (ex.finished ? "done" : "running")}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
