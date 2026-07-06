// Single source of truth for price rounding rules.
// All modes return "nearest" match, never one-sided floor/ceil, so a price
// like 748 rounds *up* to 749 for nearest_49 (not down to 739).

export type RoundingMode =
  | "none"
  | "nearest_1"
  | "nearest_5"
  | "nearest_10"
  | "nearest_25"
  | "nearest_49"
  | "nearest_95"
  | "nearest_99";

/** Round `price` to the nearest value of the form `k * step + offset`. */
function nearestOf(price: number, step: number, offset: number): number {
  const k = Math.round((price - offset) / step);
  const val = k * step + offset;
  // Guard against negative offsets (e.g. never return a negative price).
  return val < 0 ? offset : val;
}

export function applyRounding(price: number, mode: string): number {
  if (price == null || !Number.isFinite(price)) return price;
  switch (mode) {
    case "nearest_1":
      return Math.round(price);
    case "nearest_5":
      return Math.round(price / 5) * 5;
    case "nearest_10":
      return Math.round(price / 10) * 10;
    case "nearest_25":
      return Math.round(price / 25) * 25;
    // Nearest whole ending in 9 (…9, …19, …29 …). Step 10, offset 9.
    case "nearest_49":
      return nearestOf(price, 10, 9);
    // Nearest value ending in ,95 (…4.95, …9.95, …14.95). Step 5, offset 4.95.
    case "nearest_95":
      return Math.round(nearestOf(price, 5, 4.95) * 100) / 100;
    // Nearest value ending in ,99 (…9.99, …19.99, …29.99). Step 10, offset 9.99.
    case "nearest_99":
      return Math.round(nearestOf(price, 10, 9.99) * 100) / 100;
    case "none":
    default:
      return Math.round(price * 100) / 100;
  }
}

export const ROUNDING_EXAMPLES: Record<string, string> = {
  none: "741,57 → 741,57",
  nearest_1: "741,57 → 742",
  nearest_5: "741,57 → 740",
  nearest_10: "741,57 → 740",
  nearest_25: "741,57 → 750",
  nearest_49: "741,57 → 739 (nærmeste ,9)",
  nearest_95: "741,57 → 739,95",
  nearest_99: "741,57 → 739,99",
};
