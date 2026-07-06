import { describe, it, expect } from "vitest";
import { applyRounding } from "@/lib/price-rounding";

describe("applyRounding", () => {
  it("nearest_5 rounds both directions", () => {
    expect(applyRounding(741.57, "nearest_5")).toBe(740);
    expect(applyRounding(743, "nearest_5")).toBe(745);
  });

  it("nearest_10", () => {
    expect(applyRounding(741.57, "nearest_10")).toBe(740);
    expect(applyRounding(746, "nearest_10")).toBe(750);
  });

  it("nearest_49 finds nearest ending in 9 (not floor)", () => {
    expect(applyRounding(748, "nearest_49")).toBe(749);
    expect(applyRounding(741.57, "nearest_49")).toBe(739);
    expect(applyRounding(745, "nearest_49")).toBe(749);
    expect(applyRounding(743, "nearest_49")).toBe(739);
  });

  it("nearest_95 rounds up when appropriate", () => {
    expect(applyRounding(748, "nearest_95")).toBe(749.95);
    expect(applyRounding(741.57, "nearest_95")).toBe(739.95);
    expect(applyRounding(743, "nearest_95")).toBe(744.95);
  });

  it("nearest_99 rounds up when appropriate", () => {
    expect(applyRounding(748, "nearest_99")).toBe(749.99);
    expect(applyRounding(741.57, "nearest_99")).toBe(739.99);
    expect(applyRounding(746, "nearest_99")).toBe(749.99);
  });

  it("none passes through with 2 decimals", () => {
    expect(applyRounding(741.573, "none")).toBe(741.57);
  });
});
