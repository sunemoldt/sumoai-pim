import { useState } from "react";
import { useForm } from "react-hook-form";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import type { WebhookConfig } from "@/hooks/use-products";

const EVENT_OPTIONS = [
  { value: "product.created", label: "Produkt oprettet" },
  { value: "product.updated", label: "Produkt opdateret" },
  { value: "product.price_changed", label: "Pris ændret" },
  { value: "product.stock_changed", label: "Lager ændret" },
  { value: "supplier.synced", label: "Leverandør synkroniseret" },
  { value: "import.completed", label: "Import fuldført" },
  { value: "high_traffic_no_sales", label: "⚠️ Høj trafik, nul salg" },
  { value: "high_traffic_low_stock", label: "⚠️ Høj trafik, lavt lager" },
  { value: "good_position_bad_ctr", label: "💡 God placering, lav CTR" },
];

const PLATFORM_OPTIONS = [
  { value: "n8n", label: "n8n" },
  { value: "make", label: "Make.com" },
  { value: "zapier", label: "Zapier" },
  { value: "custom", label: "Andet" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  webhook?: WebhookConfig | null;
}

export default function WebhookFormDialog({ open, onOpenChange, webhook }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<string[]>(webhook?.event_types ?? []);
  const [isActive, setIsActive] = useState(webhook?.is_active ?? true);
  const [platform, setPlatform] = useState("n8n");

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    defaultValues: {
      name: webhook?.name ?? "",
      url: webhook?.url ?? "",
    },
  });

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const onSubmit = async (values: { name: string; url: string }) => {
    if (selectedEvents.length === 0) {
      toast({ title: "Vælg mindst én hændelse", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (webhook) {
        const { error } = await supabase
          .from("webhook_configs")
          .update({ name: values.name, url: values.url, event_types: selectedEvents, is_active: isActive })
          .eq("id", webhook.id);
        if (error) throw error;
        toast({ title: "Webhook opdateret" });
      } else {
        const { error } = await supabase
          .from("webhook_configs")
          .insert({ name: values.name, url: values.url, event_types: selectedEvents, is_active: isActive });
        if (error) throw error;
        toast({ title: "Webhook oprettet" });
      }
      qc.invalidateQueries({ queryKey: ["webhook_configs"] });
      reset();
      setSelectedEvents([]);
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Fejl", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{webhook ? "Rediger webhook" : "Tilføj webhook"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Platform</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLATFORM_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wh-name">Navn</Label>
            <Input id="wh-name" placeholder={`F.eks. "${platform === "make" ? "Make" : "n8n"} – Ordreflow"`} {...register("name", { required: true })} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wh-url">Webhook URL</Label>
            <Input
              id="wh-url"
              type="url"
              placeholder={
                platform === "n8n"
                  ? "https://din-n8n.app/webhook/..."
                  : platform === "make"
                  ? "https://hook.eu2.make.com/..."
                  : "https://..."
              }
              {...register("url", { required: true })}
            />
            <p className="text-xs text-muted-foreground">
              {platform === "n8n"
                ? "Find URL'en i din n8n webhook-trigger node"
                : platform === "make"
                ? "Find URL'en i dit Make.com scenario under webhook-modulet"
                : "Indtast webhook URL'en fra din automation-platform"}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Hændelser</Label>
            <div className="grid grid-cols-2 gap-2">
              {EVENT_OPTIONS.map((ev) => (
                <label key={ev.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={selectedEvents.includes(ev.value)}
                    onCheckedChange={() => toggleEvent(ev.value)}
                  />
                  {ev.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label>Aktiv</Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annuller</Button>
            <Button type="submit" disabled={saving}>{webhook ? "Gem ændringer" : "Opret"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
