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

/** Step/offset grid per mode, used to walk to the next valid price upwards. */
function gridFor(mode: string): { step: number; offset: number } | null {
  switch (mode) {
    case "nearest_1":
      return { step: 1, offset: 0 };
    case "nearest_5":
      return { step: 5, offset: 0 };
    case "nearest_10":
      return { step: 10, offset: 0 };
    case "nearest_25":
      return { step: 25, offset: 0 };
    case "nearest_49":
      return { step: 10, offset: 9 };
    case "nearest_95":
      return { step: 5, offset: 4.95 };
    case "nearest_99":
      return { step: 10, offset: 9.99 };
    default:
      return null;
  }
}

/** Smallest rounded price (on the mode's grid) that is >= `floor`. */
export function roundUpToGrid(floor: number, mode: string): number {
  const g = gridFor(mode);
  if (!g) return Math.ceil(floor * 100) / 100;
  const k = Math.ceil((floor - g.offset) / g.step - 1e-9);
  const val = k * g.step + g.offset;
  return Math.round(val * 100) / 100;
}

const VAT_RATE = 0.25;

/**
 * Round a price, but never below the minimum margin. If the normal (nearest)
 * rounding pushes the margin under `minMarginPct`, step up to the next value
 * on the rounding grid that satisfies the minimum margin.
 */
export function applyRoundingWithMinMargin(
  priceInclVat: number,
  mode: string,
  purchasePriceExVat: number | null | undefined,
  minMarginPct: number | null | undefined,
): number {
  const rounded = applyRounding(priceInclVat, mode);
  if (
    purchasePriceExVat == null ||
    !Number.isFinite(purchasePriceExVat) ||
    purchasePriceExVat <= 0 ||
    minMarginPct == null ||
    !Number.isFinite(minMarginPct) ||
    minMarginPct >= 100
  ) {
    return rounded;
  }
  const marginOf = (inclVat: number) => {
    const ex = inclVat / (1 + VAT_RATE);
    return ex <= 0 ? -Infinity : ((ex - purchasePriceExVat) / ex) * 100;
  };
  if (marginOf(rounded) >= minMarginPct - 1e-9) return rounded;

  // Minimum incl. VAT price that satisfies the margin, then round up to grid.
  const minInclVat = (purchasePriceExVat / (1 - minMarginPct / 100)) * (1 + VAT_RATE);
  let candidate = roundUpToGrid(minInclVat, mode);
  const g = gridFor(mode);
  // Safety: walk up a few steps in case of float edge cases.
  for (let i = 0; i < 5 && marginOf(candidate) < minMarginPct - 1e-9; i++) {
    candidate = g ? Math.round((candidate + g.step) * 100) / 100 : Math.round((candidate + 0.01) * 100) / 100;
  }
  return candidate;
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
