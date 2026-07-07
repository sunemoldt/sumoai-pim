import { Link, useNavigate } from "react-router-dom";
import { useSaleCampaigns } from "@/hooks/use-campaigns";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Loader2, Tag } from "lucide-react";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  scheduled: { label: "Planlagt", className: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  active: { label: "Aktiv", className: "bg-green-500/10 text-green-600 border-green-500/30" },
  ended: { label: "Afsluttet", className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Annulleret", className: "bg-destructive/10 text-destructive border-destructive/30" },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" });
}

export default function CampaignListPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useSaleCampaigns();

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Tag className="h-6 w-6" /> Tilbudskampagner
          </h1>
          <p className="text-sm text-muted-foreground">Opret bulk-kampagner med procentrabat og start/slutdato</p>
        </div>
        <Button onClick={() => navigate("/campaigns/new")}>
          <Plus className="mr-2 h-4 w-4" /> Ny kampagne
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          Ingen kampagner endnu. Klik "Ny kampagne" for at komme i gang.
        </Card>
      ) : (
        <div className="grid gap-3">
          {data.map((c) => {
            const s = STATUS_LABEL[c.status] ?? STATUS_LABEL.ended;
            return (
              <Link
                key={c.id}
                to={`/campaigns/${c.id}`}
                className="block"
              >
                <Card className="p-4 hover:border-primary/40 hover:shadow-sm transition-all">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium truncate">{c.name}</h3>
                        <Badge variant="outline" className={s.className}>{s.label}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {fmtDate(c.starts_at)} → {fmtDate(c.ends_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-semibold text-primary">-{Number(c.discount_percent)}%</div>
                      <div className="text-xs text-muted-foreground">
                        {c.sale_campaign_products?.length ?? 0} produkter
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
