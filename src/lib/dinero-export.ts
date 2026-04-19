import type { MasterProductWithSuppliers } from "@/hooks/use-products";
import { exVat } from "@/hooks/use-products";

// Dinero CSV header (must match the Dinero import template exactly)
const DINERO_HEADER = [
  "Varekode",
  "Produktnavn",
  "Kommentar til produktet",
  "Konto",
  "Konto beskrivelse",
  "Antal",
  "Enhed",
  "Pris ekskl. moms",
  "Solgte enheder",
  "Salg (uden moms)",
];

// Danish number format: comma as decimal separator, no thousands separator
function formatDkNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return "0,00";
  return value.toFixed(2).replace(".", ",");
}

// Escape a CSV field for semicolon-separated CSV
function escapeCsv(value: string): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(";") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildDineroCsv(products: MasterProductWithSuppliers[]): string {
  const rows: string[] = [];
  rows.push(DINERO_HEADER.join(";"));

  for (const p of products) {
    // Use webshop price (incl. VAT) → convert to ex VAT for Dinero
    const priceInclVat = p.sale_price ?? p.webshop_price ?? 0;
    const priceExVat = priceInclVat ? exVat(Number(priceInclVat)) : 0;

    // Varekode = SKU (fallback to EAN)
    const varekode = p.sku?.trim() || p.ean || "";

    const fields = [
      escapeCsv(varekode),
      escapeCsv(p.title ?? ""),
      escapeCsv(p.short_description ?? ""),
      "1000",
      "Salg af varer/ydelser m/moms",
      "1",
      "Stk.",
      formatDkNumber(priceExVat),
      "0,00",
      "0,00",
    ];
    rows.push(fields.join(";"));
  }

  // CRLF line endings + UTF-8 BOM for Excel/Dinero compatibility
  return "\uFEFF" + rows.join("\r\n") + "\r\n";
}

export function downloadDineroCsv(products: MasterProductWithSuppliers[], filename = "dinero-produkter.csv") {
  const csv = buildDineroCsv(products);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
