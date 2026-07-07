import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSaleCampaign, useSaleCampaignProducts } from "@/hooks/use-campaigns";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Play, Square, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import CampaignProductPicker from "@/components/CampaignProductPicker";

type SelectedProduct = { id: string; title: string; ean: string | null; image_url: string | null; webshop_price: number | null; sale_price: number | null };

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CampaignEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: campaign, isLoading } = useSaleCampaign(isNew ? undefined : id);
  const { data: campaignProducts } = useSaleCampaignProducts(isNew ? undefined : id);

  const [name, setName] = useState("");
  const [discount, setDiscount] = useState<string>("10");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [selectedMap, setSelectedMap] = useState<Map<string, SelectedProduct>>(new Map());
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    setName(campaign.name);
    setDiscount(String(campaign.discount_percent));
    setStartsAt(toLocalInput(campaign.starts_at));
    setEndsAt(toLocalInput(campaign.ends_at));
    setOverwrite(campaign.overwrite_existing_sale);
  }, [campaign]);

  useEffect(() => {
    if (!campaignProducts) return;
    const m = new Map<string, SelectedProduct>();
    for (const cp of campaignProducts) {
      if (!cp.master_products) continue;
      m.set(cp.master_product_id, {
        id: cp.master_product_id,
        title: cp.master_products.title,
        ean: cp.master_products.ean,
        image_url: cp.master_products.image_url,
        webshop_price: cp.master_products.webshop_price,
        sale_price: cp.master_products.sale_price,
      });
    }
    setSelectedMap(m);
  }, [campaignProducts]);

  const selectedIds = useMemo(() => new Set(selectedMap.keys()), [selectedMap]);
  const discountNum = Number(discount) || 0;
  const locked = campaign?.status === "active" || campaign?.status === "ended";

  const addProduct = (p: SelectedProduct) => {
    if (locked) return;
    setSelectedMap((prev) => new Map(prev).set(p.id, p));
  };
  const addManyProducts = (ps: SelectedProduct[]) => {
    if (locked) return;
    setSelectedMap((prev) => {
      const m = new Map(prev);
      ps.forEach((p) => m.set(p.id, p));
      return m;
    });
  };

  const removeProduct = (id: string) => {
    if (locked) return;
    setSelectedMap((prev) => { const m = new Map(prev); m.delete(id); return m; });
  };

  const save = async () => {
    if (!name.trim()) return toast.error("Angiv et navn");
    if (!startsAt || !endsAt) return toast.error("Angiv start- og slutdato");
    if (new Date(endsAt) <= new Date(startsAt)) return toast.error("Slut skal være efter start");
    if (discountNum <= 0 || discountNum >= 100) return toast.error("Rabat skal være mellem 1 og 99");
    if (selectedMap.size === 0) return toast.error("Vælg mindst ét produkt");

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        discount_percent: discountNum,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        overwrite_existing_sale: overwrite,
      };

      let campaignId = id;
      if (isNew) {
        const { data, error } = await supabase.from("sale_campaigns").insert(payload).select("id").single();
        if (error) throw error;
        campaignId = data.id;
      } else {
        // For locked campaigns only allow name/ends_at changes
        const patch = locked ? { name: payload.name, ends_at: payload.ends_at } : payload;
        const { error } = await supabase.from("sale_campaigns").update(patch).eq("id", campaignId!);
        if (error) throw error;
      }

      if (!locked) {
        // Sync product list
        const existing = new Set((campaignProducts ?? []).map((cp) => cp.master_product_id));
        const toAdd = [...selectedIds].filter((x) => !existing.has(x));
        const toRemove = [...existing].filter((x) => !selectedIds.has(x));

        if (toAdd.length > 0) {
          const rows = toAdd.map((mid) => ({ campaign_id: campaignId!, master_product_id: mid }));
          const { error } = await supabase.from("sale_campaign_products").insert(rows);
          if (error) throw error;
        }
        if (toRemove.length > 0) {
          const { error } = await supabase
            .from("sale_campaign_products")
            .delete()
            .eq("campaign_id", campaignId!)
            .in("master_product_id", toRemove);
          if (error) throw error;
        }
      }

      toast.success("Kampagne gemt");
      qc.invalidateQueries({ queryKey: ["sale_campaigns"] });
      qc.invalidateQueries({ queryKey: ["sale_campaign", campaignId] });
      qc.invalidateQueries({ queryKey: ["sale_campaign_products", campaignId] });
      if (isNew) navigate(`/campaigns/${campaignId}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Fejl ved gemning");
    } finally {
      setSaving(false);
    }
  };

  const invokeScheduler = async (action: "activate" | "deactivate" | "cancel") => {
    if (!id) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("sale-campaign-scheduler", {
        body: { action, campaign_id: id },
      });
      if (error) throw error;
      toast.success(
        action === "activate" ? "Kampagne aktiveret" :
        action === "deactivate" ? "Kampagne afsluttet" : "Kampagne annulleret"
      );
      qc.invalidateQueries({ queryKey: ["sale_campaigns"] });
      qc.invalidateQueries({ queryKey: ["sale_campaign", id] });
      qc.invalidateQueries({ queryKey: ["sale_campaign_products", id] });
      qc.invalidateQueries({ queryKey: ["master_products"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Fejl");
    } finally {
      setBusy(false);
    }
  };

  const deleteCampaign = async () => {
    if (!id || !confirm("Slet denne kampagne? Aktive rabatter fjernes ikke automatisk.")) return;
    const { error } = await supabase.from("sale_campaigns").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Slettet");
    qc.invalidateQueries({ queryKey: ["sale_campaigns"] });
    navigate("/campaigns");
  };

  if (!isNew && isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/campaigns")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{isNew ? "Ny kampagne" : campaign?.name}</h1>
            {campaign && <Badge variant="outline" className="mt-1">{campaign.status}</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {campaign?.status === "scheduled" && (
            <Button variant="secondary" onClick={() => invokeScheduler("activate")} disabled={busy}>
              <Play className="h-4 w-4 mr-2" /> Aktivér nu
            </Button>
          )}
          {campaign?.status === "active" && (
            <Button variant="secondary" onClick={() => invokeScheduler("deactivate")} disabled={busy}>
              <Square className="h-4 w-4 mr-2" /> Afslut nu
            </Button>
          )}
          {campaign && campaign.status !== "ended" && campaign.status !== "cancelled" && (
            <Button variant="outline" onClick={() => invokeScheduler("cancel")} disabled={busy}>
              Annullér
            </Button>
          )}
          {campaign && (
            <Button variant="ghost" onClick={deleteCampaign} className="text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Gem
          </Button>
        </div>
      </div>

      <Card className="p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Navn</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Fx Black Friday 2026" />
          </div>
          <div>
            <Label>Rabat (%)</Label>
            <Input type="number" min={1} max={99} step="0.1" value={discount} onChange={(e) => setDiscount(e.target.value)} disabled={locked} />
            {locked && <p className="text-xs text-muted-foreground mt-1">Rabatprocent kan ikke ændres efter aktivering</p>}
          </div>
          <div>
            <Label>Overskriv eksisterende tilbud</Label>
            <div className="flex items-center gap-2 h-10">
              <Checkbox checked={overwrite} onCheckedChange={(v) => setOverwrite(!!v)} disabled={locked} id="ovw" />
              <label htmlFor="ovw" className="text-sm">Produkter der allerede har en tilbudspris skal også få kampagnepris</label>
            </div>
          </div>
          <div>
            <Label>Starter</Label>
            <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} disabled={locked} />
          </div>
          <div>
            <Label>Slutter</Label>
            <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>
      </Card>

      {locked ? (
        <Card className="p-4">
          <h3 className="font-medium mb-3">Produkter i kampagne ({selectedMap.size})</h3>
          <div className="grid gap-1 max-h-[500px] overflow-y-auto">
            {[...selectedMap.values()].map((p) => {
              const cp = campaignProducts?.find((x) => x.master_product_id === p.id);
              return (
                <div key={p.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                  <span className="flex-1 truncate">{p.title}</span>
                  {cp?.skipped_reason ? (
                    <Badge variant="outline" className="text-warning border-warning/30">Sprunget over: {cp.skipped_reason}</Badge>
                  ) : cp?.applied_sale_price != null ? (
                    <span className="font-mono text-primary">{cp.applied_sale_price.toFixed(2)} kr</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <CampaignProductPicker
          selectedIds={selectedIds}
          selectedMap={selectedMap}
          onAdd={addProduct}
          onAddMany={addManyProducts}
          onRemove={removeProduct}
          discountPercent={discountNum}
        />
      )}
    </div>
  );
}
