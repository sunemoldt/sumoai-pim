import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Save, Send, Trash2, Loader2, Search, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Line = {
  _key?: string;
  id?: string;
  pim_product_id: string | null;
  product_name: string;
  quantity: number;
  purchase_price: number;
  list_price: number;
  quote_price: number;
  sort_order: number;
};

type ProductSearchResult = {
  id: string;
  title: string;
  ean: string | null;
  sku: string | null;
  webshop_price: number | string | null;
  supplier_products?: { purchase_price: number | string | null; in_stock: boolean | null }[];
};

const VAT = 0.25;

export default function QuoteEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isNew = !id || id === "new";

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [quoteId, setQuoteId] = useState<string | null>(isNew ? null : id!);
  const [quoteNumber, setQuoteNumber] = useState<number | null>(null);
  const [voucherGuid, setVoucherGuid] = useState<string | null>(null);
  const [status, setStatus] = useState("draft");

  const [customerName, setCustomerName] = useState("");
  const [contactGuid, setContactGuid] = useState("");
  const [quoteDate, setQuoteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validDays, setValidDays] = useState(30);
  const [noteCustomer, setNoteCustomer] = useState("");
  const [noteInternal, setNoteInternal] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [packagePrice, setPackagePrice] = useState<number | null>(null);

  // Load existing quote
  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    (async () => {
      const { data: q } = await supabase.from("quotes" as any).select("*").eq("id", id!).single();
      if (q) {
        const qq = q as any;
        setQuoteNumber(qq.quote_number);
        setVoucherGuid(qq.dinero_voucher_guid);
        setStatus(qq.status);
        setCustomerName(qq.customer_name || "");
        setContactGuid(qq.dinero_contact_guid || "");
        setQuoteDate(qq.quote_date);
        setValidDays(qq.valid_days);
        setNoteCustomer(qq.note_customer || "");
        setNoteInternal(qq.note_internal || "");
        setPackagePrice(qq.package_price !== null && qq.package_price !== undefined ? Number(qq.package_price) : null);
      }
      const { data: ls } = await supabase.from("quote_lines" as any).select("*").eq("quote_id", id!).order("sort_order");
      if (ls) setLines((ls as any[]).map((l) => ({ ...l, _key: crypto.randomUUID(), quantity: Number(l.quantity), purchase_price: Number(l.purchase_price), list_price: Number(l.list_price), quote_price: Number(l.quote_price) })));
      setLoading(false);
    })();
  }, [id, isNew]);

  // Totals — quote_price/list_price are INCL. VAT (webshop), purchase_price is EX. VAT.
  // packagePrice is stored EX. VAT.
  const totals = useMemo(() => {
    const lineSubtotalIncl = lines.reduce((s, l) => s + l.quantity * l.quote_price, 0);
    const lineSubtotalEx = lineSubtotalIncl / (1 + VAT);
    const subtotalEx = packagePrice !== null && packagePrice >= 0 ? packagePrice : lineSubtotalEx;
    const totalIncl = subtotalEx * (1 + VAT);
    const vat = totalIncl - subtotalEx;
    const purchase = lines.reduce((s, l) => s + l.quantity * l.purchase_price, 0);
    const marginKr = subtotalEx - purchase;
    const marginPct = subtotalEx > 0 ? (marginKr / subtotalEx) * 100 : 0;
    return { subtotal: subtotalEx, lineSubtotal: lineSubtotalEx, purchase, marginKr, marginPct, vat, total: totalIncl };
  }, [lines, packagePrice]);

  const marginColor = (pct: number) =>
    pct < 20 ? "text-destructive" : pct < 35 ? "text-yellow-600" : "text-green-600";

  const addLine = () => {
    setLines((prev) => [...prev, {
      _key: crypto.randomUUID(),
      pim_product_id: null, product_name: "", quantity: 1,
      purchase_price: 0, list_price: 0, quote_price: 0, sort_order: prev.length,
    }]);
  };

  const updateLine = (idx: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const saveQuote = async (): Promise<string | null> => {
    setSaving(true);
    try {
      let theId = quoteId;
      const payload = {
        customer_name: customerName,
        dinero_contact_guid: contactGuid || null,
        quote_date: quoteDate,
        valid_days: validDays,
        note_customer: noteCustomer || null,
        note_internal: noteInternal || null,
        total_excl_vat: totals.subtotal,
        total_purchase_price: totals.purchase,
        package_price: packagePrice,
      };

      if (!theId) {
        const { data, error } = await supabase.from("quotes" as any).insert(payload as any).select().single();
        if (error) throw error;
        theId = (data as any).id;
        setQuoteId(theId);
        setQuoteNumber((data as any).quote_number);
      } else {
        const { error } = await supabase.from("quotes" as any).update(payload as any).eq("id", theId);
        if (error) throw error;
      }

      // Replace lines
      await supabase.from("quote_lines" as any).delete().eq("quote_id", theId!);
      if (lines.length > 0) {
        const rows = lines.map((l, i) => ({
          quote_id: theId,
          pim_product_id: l.pim_product_id,
          product_name: l.product_name,
          quantity: l.quantity,
          purchase_price: l.purchase_price,
          list_price: l.list_price,
          quote_price: l.quote_price,
          sort_order: i,
        }));
        const { error } = await supabase.from("quote_lines" as any).insert(rows as any);
        if (error) throw error;
      }
      toast({ title: "Tilbud gemt" });
      qc.invalidateQueries({ queryKey: ["quotes-list"] });
      if (isNew && theId) navigate(`/quotes/${theId}`, { replace: true });
      return theId;
    } catch (err: any) {
      toast({ title: "Fejl", description: err?.message, variant: "destructive" });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const sendToDinero = async () => {
    const theId = await saveQuote();
    if (!theId) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("dinero-send-quote", { body: { quote_id: theId } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const vGuid = (data as any).voucherGuid;
      const orgId = (data as any).organizationId;
      setVoucherGuid(vGuid);
      setStatus("sent");
      toast({
        title: "Sendt til Dinero",
        description: vGuid ? `Kladde oprettet. Åbn i Dinero` : "Kladde oprettet",
      });
      if (vGuid && orgId) {
        window.open(`https://app.dinero.dk/${orgId}/sales/${vGuid}`, "_blank");
      }
    } catch (err: any) {
      toast({ title: "Fejl ved Dinero", description: err?.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const setOutcome = async (newStatus: "approved" | "rejected") => {
    const theId = quoteId ?? (await saveQuote());
    if (!theId) return;
    const { error } = await supabase.from("quotes" as any).update({ status: newStatus } as any).eq("id", theId);
    if (error) {
      toast({ title: "Fejl", description: error.message, variant: "destructive" });
      return;
    }
    setStatus(newStatus);
    toast({ title: newStatus === "approved" ? "Tilbud godkendt" : "Tilbud afvist" });
    qc.invalidateQueries({ queryKey: ["quotes-list"] });
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6 pb-40">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/quotes")}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{isNew ? "Nyt tilbud" : `Tilbud #${quoteNumber ?? ""}`}</h1>
          {voucherGuid && status === "sent" && (
            <p className="text-sm text-green-600 mt-1">Sendt til Dinero · {voucherGuid}</p>
          )}
          {status === "approved" && (
            <p className="text-sm text-green-600 mt-1">✓ Godkendt af kunde</p>
          )}
          {status === "rejected" && (
            <p className="text-sm text-destructive mt-1">✗ Afvist af kunde</p>
          )}
        </div>
        <Button variant="outline" onClick={saveQuote} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Gem
        </Button>
        <Button onClick={sendToDinero} disabled={sending || saving || lines.length === 0}>
          {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
          Send til Dinero
        </Button>
        <Button
          variant="outline"
          className="text-green-700 border-green-300 hover:bg-green-50 hover:text-green-800"
          onClick={() => setOutcome("approved")}
          disabled={saving || status === "approved"}
        >
          <CheckCircle2 className="h-4 w-4 mr-1" /> Godkendt
        </Button>
        <Button
          variant="outline"
          className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setOutcome("rejected")}
          disabled={saving || status === "rejected"}
        >
          <XCircle className="h-4 w-4 mr-1" /> Afvist
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Kunde og detaljer</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-2 lg:col-span-2">
            <Label>Kunde (navn)</Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Søg kunde / indtast navn" />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label>Dinero ContactGuid (valgfri)</Label>
            <Input value={contactGuid} onChange={(e) => setContactGuid(e.target.value)} placeholder="GUID fra Dinero" />
          </div>
          <div className="space-y-2">
            <Label>Tilbudsdato</Label>
            <Input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Gyldighed (dage)</Label>
            <Input type="number" value={validDays} onChange={(e) => setValidDays(parseInt(e.target.value) || 0)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Produktlinjer</CardTitle>
          <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-4 w-4 mr-1" /> Tilføj linje</Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50">
                <TableHead className="w-[24%]">Produkt</TableHead>
                <TableHead className="text-right w-[100px]">Antal</TableHead>
                <TableHead className="text-right">Indkøb</TableHead>
                <TableHead className="text-right">Webshop pris</TableHead>
                <TableHead className="text-right w-[110px]">Rabat %</TableHead>
                <TableHead className="text-right">Tilbudspris</TableHead>
                <TableHead className="text-right">Avance kr.</TableHead>
                <TableHead className="text-right">Avance %</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Ingen linjer endnu</TableCell></TableRow>
              ) : lines.map((l, idx) => {
                const sub = l.quantity * l.quote_price; // incl. VAT
                const quoteEx = l.quote_price / (1 + VAT);
                const margin = (quoteEx - l.purchase_price) * l.quantity;
                const marginPct = quoteEx > 0 ? ((quoteEx - l.purchase_price) / quoteEx) * 100 : 0;
                const discountPct = l.list_price > 0 ? ((l.list_price - l.quote_price) / l.list_price) * 100 : 0;
                return (
                  <TableRow key={l._key ?? l.id ?? idx}>
                    <TableCell>
                      <ProductPicker
                        value={l.product_name}
                        onSelect={(p) => updateLine(idx, {
                          pim_product_id: p.id,
                          product_name: p.title,
                          purchase_price: p.purchase_price,
                          list_price: p.list_price,
                          quote_price: p.list_price,
                        })}
                        onTextChange={(v) => updateLine(idx, { product_name: v })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input type="number" min={1} step={1} className="h-8 text-right font-mono" value={l.quantity} onChange={(e) => updateLine(idx, { quantity: parseFloat(e.target.value) || 0 })} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{l.purchase_price.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{l.list_price.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.1"
                        className="h-8 text-right font-mono"
                        value={Number.isFinite(discountPct) ? Number(discountPct.toFixed(2)) : 0}
                        onChange={(e) => {
                          const pct = parseFloat(e.target.value) || 0;
                          const newPrice = l.list_price * (1 - pct / 100);
                          updateLine(idx, { quote_price: Math.max(0, newPrice) });
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input type="number" step="0.01" className="h-8 text-right font-mono" value={l.quote_price} onChange={(e) => updateLine(idx, { quote_price: parseFloat(e.target.value) || 0 })} />
                    </TableCell>
                    <TableCell className="text-right font-mono">{margin.toFixed(2)}</TableCell>
                    <TableCell className={cn("text-right font-mono", marginColor(marginPct))}>{marginPct.toFixed(1)}%</TableCell>
                    <TableCell className="text-right font-mono">{sub.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => removeLine(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="border-t border-border bg-secondary/30 px-4 py-3 flex flex-wrap items-center justify-end gap-3">
            <Label htmlFor="package-price" className="text-sm font-medium">Pakkepris ekskl. moms</Label>
            <Input
              id="package-price"
              type="number"
              step="0.01"
              placeholder="Tom = brug linjesum"
              className="h-8 w-40 text-right font-mono"
              value={packagePrice ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setPackagePrice(v === "" ? null : parseFloat(v));
              }}
            />
            <Label htmlFor="package-price-incl" className="text-sm font-medium">inkl. moms</Label>
            <Input
              id="package-price-incl"
              type="number"
              step="0.01"
              placeholder="Tom = brug linjesum"
              className="h-8 w-40 text-right font-mono"
              value={packagePrice !== null ? Number((packagePrice * (1 + VAT)).toFixed(2)) : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") { setPackagePrice(null); return; }
                const incl = parseFloat(v);
                setPackagePrice(Number.isFinite(incl) ? incl / (1 + VAT) : null);
              }}
            />
            {packagePrice !== null && (
              <Button variant="ghost" size="sm" onClick={() => setPackagePrice(null)}>Ryd</Button>
            )}
            <span className="text-xs text-muted-foreground ml-2">
              Linjesum: {totals.lineSubtotal.toFixed(2)} kr.
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Note til kunden</CardTitle></CardHeader>
          <CardContent>
            <Textarea rows={4} value={noteCustomer} onChange={(e) => setNoteCustomer(e.target.value)} placeholder="Vises på tilbudet" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Intern note</CardTitle></CardHeader>
          <CardContent>
            <Textarea rows={4} value={noteInternal} onChange={(e) => setNoteInternal(e.target.value)} placeholder="Kun til intern brug" />
          </CardContent>
        </Card>
      </div>

      {/* Sticky summary */}
      <div className="fixed bottom-0 left-60 right-0 border-t border-border bg-card/95 backdrop-blur px-6 py-3 z-40">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
          <Stat label="Subtotal ekskl. moms" value={`${totals.subtotal.toFixed(2)} kr.`} />
          <Stat label="Moms (25%)" value={`${totals.vat.toFixed(2)} kr.`} />
          <Stat label="Tilbuds pris inkl. moms" value={`${totals.total.toFixed(2)} kr.`} bold />
          <Stat label="Indkøb total inkl. moms" value={`${(totals.purchase * (1 + VAT)).toFixed(2)} kr.`} />
          <Stat label="Avance kr." value={`${totals.marginKr.toFixed(2)} kr.`} />
          <Stat label="Avance %" value={`${totals.marginPct.toFixed(1)}%`} className={marginColor(totals.marginPct)} bold />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, className, bold }: { label: string; value: string; className?: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("font-mono", bold && "font-semibold text-base", className)}>{value}</div>
    </div>
  );
}

function ProductPicker({
  value, onSelect, onTextChange,
}: {
  value: string;
  onSelect: (p: { id: string; title: string; purchase_price: number; list_price: number }) => void;
  onTextChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value || "");
  const [debounced, setDebounced] = useState(search);
  const [dropdownStyle, setDropdownStyle] = useState({ top: 0, left: 0, width: 420 });
  const containerRef = React.useRef<HTMLDivElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const updateDropdownPosition = React.useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(420, window.innerWidth - 24);
    setDropdownStyle({
      top: rect.bottom + 4,
      left: Math.min(rect.left, window.innerWidth - width - 12),
      width,
    });
  }, []);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updateDropdownPosition();
    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);
    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    };
  }, [open, updateDropdownPosition]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["quote-product-search", debounced],
    queryFn: async () => {
      const q = debounced.trim();
      if (q.length < 2) return [];
      const { data } = await supabase
        .from("master_products")
        .select("id, title, ean, sku, webshop_price, supplier_products(purchase_price, in_stock)")
        .or((() => { const isDigits = /^\d+$/.test(q); const s = isDigits ? q.replace(/^0+/, "") : q; const eanF = isDigits && s !== q ? `ean.ilike.%${q}%,ean.ilike.%${s}%` : `ean.ilike.%${q}%`; return `title.ilike.%${q}%,${eanF},sku.ilike.%${q}%`; })())
        .limit(15);
      return (data ?? []) as ProductSearchResult[];
    },
    enabled: debounced.trim().length >= 2,
  });

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2">
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); onTextChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Søg titel, EAN, SKU…"
          className="h-8"
        />
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
      </div>
      {open && typeof document !== "undefined" && createPortal(
        <div ref={dropdownRef} className="fixed z-[100] rounded-md border border-border bg-popover shadow-lg p-2" style={dropdownStyle}>
          <div className="max-h-72 overflow-y-auto">
            {debounced.trim().length < 2 ? (
              <p className="text-xs text-muted-foreground p-2">Skriv mindst 2 tegn</p>
            ) : isFetching && results.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">Søger…</p>
            ) : results.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">Ingen resultater</p>
            ) : results.map((p) => {
              const cheapest = (p.supplier_products ?? []).reduce<ProductSearchResult["supplier_products"][number] | null>((min, sp) => {
                if (!min) return sp;
                return Number(sp.purchase_price ?? Infinity) < Number(min.purchase_price ?? Infinity) ? sp : min;
              }, null);
              const purchase = cheapest?.purchase_price ?? 0;
              const list = Number(p.webshop_price) || 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left p-2 rounded hover:bg-accent text-sm"
                  onClick={() => {
                    onSelect({ id: p.id, title: p.title, purchase_price: Number(purchase), list_price: list });
                    setSearch(p.title);
                    setOpen(false);
                  }}
                >
                  <div className="font-medium truncate">{p.title}</div>
                  <div className="text-xs text-muted-foreground flex gap-3">
                    <span>EAN: {p.ean}</span>
                    <span>Indkøb: {Number(purchase).toFixed(2)}</span>
                    <span>Liste: {list.toFixed(2)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
