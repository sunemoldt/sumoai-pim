import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";
import type { Supplier } from "@/hooks/use-products";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: Supplier | null;
}

export default function SupplierFormDialog({ open, onOpenChange, supplier }: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [name, setName] = useState("");
  const [feedType, setFeedType] = useState("csv");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedSchedule, setFeedSchedule] = useState("manual");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (supplier) {
      setName(supplier.name);
      setFeedType(supplier.feed_type);
      setFeedUrl(supplier.feed_url ?? "");
      setFeedSchedule(supplier.feed_schedule ?? "manual");
      setIsActive(supplier.is_active);
    } else {
      setName("");
      setFeedType("csv");
      setFeedUrl("");
      setFeedSchedule("manual");
      setIsActive(true);
    }
  }, [supplier, open]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("supplier-feeds").upload(path, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("supplier-feeds").getPublicUrl(path);
      setFeedUrl(urlData.publicUrl);
      toast.success("Fil uploadet");
    } catch (err: any) {
      toast.error(err?.message || "Upload fejlede");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Navn er påkrævet");
      return;
    }
    setSaving(true);
    try {
      const row = {
        name: name.trim(),
        feed_type: feedType,
        feed_url: feedUrl.trim() || null,
        feed_schedule: feedSchedule,
        is_active: isActive,
      };

      if (supplier) {
        const { error } = await supabase.from("suppliers").update(row).eq("id", supplier.id);
        if (error) throw error;
        toast.success("Leverandør opdateret");
      } else {
        const { error } = await supabase.from("suppliers").insert(row);
        if (error) throw error;
        toast.success("Leverandør oprettet");
      }
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Fejl ved gemning");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{supplier ? "Rediger leverandør" : "Opret leverandør"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="name">Navn</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="F.eks. EET Group" />
          </div>

          <div className="space-y-2">
            <Label>Feed type</Label>
            <Select value={feedType} onValueChange={setFeedType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="xml">XML</SelectItem>
                <SelectItem value="ftp">FTP (CSV/XML)</SelectItem>
                <SelectItem value="manual">Manuel</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {feedType !== "manual" && (
            <div className="space-y-2">
              <Label>Feed URL</Label>
              <Input
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                placeholder="https://leverandor.dk/feed.csv"
              />
              <div className="text-xs text-muted-foreground">eller upload en fil:</div>
              <label className="flex items-center gap-2 cursor-pointer">
                <Button variant="outline" size="sm" asChild disabled={uploading}>
                  <span>
                    {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                    Upload fil
                  </span>
                </Button>
                <input type="file" accept=".csv,.xml,.xlsx,.xls,.txt" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
          )}

          {feedType !== "manual" && (
            <div className="space-y-2">
              <Label>Synkroniseringsfrekvens</Label>
              <Select value={feedSchedule} onValueChange={setFeedSchedule}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manuel (ingen automatisk)</SelectItem>
                  <SelectItem value="0 * * * *">Hver time</SelectItem>
                  <SelectItem value="0 */2 * * *">Hver 2. time</SelectItem>
                  <SelectItem value="0 */4 * * *">Hver 4. time</SelectItem>
                  <SelectItem value="0 */6 * * *">Hver 6. time</SelectItem>
                  <SelectItem value="0 */12 * * *">Hver 12. time</SelectItem>
                  <SelectItem value="0 6 * * *">Dagligt kl. 06:00</SelectItem>
                  <SelectItem value="0 6 * * 1">Ugentligt (mandag kl. 06:00)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center justify-between">
            <Label htmlFor="active">Aktiv</Label>
            <Switch id="active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuller</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {supplier ? "Gem" : "Opret"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
