import { describe, it, expect } from "vitest";
import { budgetPreflight } from "../../src/budget-preflight.js";
import { MODEL_CONTEXT_WINDOWS, MODEL_COSTS } from "../../src/config.js";

describe("budgetPreflight", () => {
  // ── gemini-2.0-flash ───────────────────────────────────────────────────────

  describe("gemini-2.0-flash (light tier)", () => {
    it("returns modelId in result", () => {
      const result = budgetPreflight("gemini-2.0-flash", 1000);
      expect(result.modelId).toBe("gemini-2.0-flash");
    });

    it("estimates token count as ceil(charCount / 4)", () => {
      const result = budgetPreflight("gemini-2.0-flash", 100);
      expect(result.tokenEstimate).toBe(25); // ceil(100/4)
    });

    it("rounds up fractional token estimate", () => {
      const result = budgetPreflight("gemini-2.0-flash", 101);
      expect(result.tokenEstimate).toBe(26); // ceil(101/4) = ceil(25.25)
    });

    it("reports contextWindow from MODEL_CONTEXT_WINDOWS", () => {
      const result = budgetPreflight("gemini-2.0-flash", 1000);
      expect(result.contextWindow).toBe(MODEL_CONTEXT_WINDOWS["gemini-2.0-flash"]);
      expect(result.contextWindow).toBe(1_000_000);
    });

    it("fits is true for a small prompt", () => {
      const result = budgetPreflight("gemini-2.0-flash", 1000);
      expect(result.fits).toBe(true);
    });

    it("fits is false when prompt exceeds 90% of context window", () => {
      // 90% of 1_000_000 tokens = 900_000 tokens = 3_600_000 chars
      // Use 3_600_001 chars → tokenEstimate = 900_001 > 900_000 threshold
      const result = budgetPreflight("gemini-2.0-flash", 3_600_001);
      expect(result.fits).toBe(false);
    });

    it("computes utilizationPercent correctly", () => {
      // 1000 chars → 250 tokens, context = 1_000_000
      const result = budgetPreflight("gemini-2.0-flash", 1000);
      expect(result.utilizationPercent).toBeCloseTo(0.025);
    });

    it("computes estimatedCostUsd using inputPerMToken", () => {
      // 1_000_000 chars → 250_000 tokens → 0.25 MTok × $0.10 = $0.025
      const result = budgetPreflight("gemini-2.0-flash", 1_000_000);
      expect(result.estimatedCostUsd).toBeCloseTo(0.025, 5);
    });

    it("estimatedCostUsd reflects MODEL_COSTS entry", () => {
      const cost = MODEL_COSTS["gemini-2.0-flash"];
      const result = budgetPreflight("gemini-2.0-flash", 4_000_000); // 1M tokens
      expect(result.estimatedCostUsd).toBeCloseTo(cost.inputPerMToken, 5);
    });
  });

  // ── gemini-2.5-pro ─────────────────────────────────────────────────────────

  describe("gemini-2.5-pro (heavy tier)", () => {
    it("returns modelId in result", () => {
      const result = budgetPreflight("gemini-2.5-pro", 1000);
      expect(result.modelId).toBe("gemini-2.5-pro");
    });

    it("reports contextWindow from MODEL_CONTEXT_WINDOWS", () => {
      const result = budgetPreflight("gemini-2.5-pro", 1000);
      expect(result.contextWindow).toBe(MODEL_CONTEXT_WINDOWS["gemini-2.5-pro"]);
    });

    it("computes higher estimated cost than gemini-2.0-flash for same input", () => {
      const flash = budgetPreflight("gemini-2.0-flash", 100_000);
      const pro = budgetPreflight("gemini-2.5-pro", 100_000);
      expect(pro.estimatedCostUsd).toBeGreaterThan(flash.estimatedCostUsd!);
    });

    it("fits is true for a small prompt", () => {
      const result = budgetPreflight("gemini-2.5-pro", 100_000);
      expect(result.fits).toBe(true);
    });

    it("estimatedCostUsd is higher for gemini-2.5-pro than gemini-2.5-flash", () => {
      const flash = budgetPreflight("gemini-2.5-flash", 4_000_000);
      const pro = budgetPreflight("gemini-2.5-pro", 4_000_000);
      expect(pro.estimatedCostUsd).toBeGreaterThan(flash.estimatedCostUsd!);
    });
  });

  // ── gemini-2.5-flash ───────────────────────────────────────────────────────

  describe("gemini-2.5-flash (standard tier)", () => {
    it("computes cost between gemini-2.0-flash and gemini-2.5-pro", () => {
      const charCount = 4_000_000; // 1M tokens
      const light = budgetPreflight("gemini-2.0-flash", charCount);
      const standard = budgetPreflight("gemini-2.5-flash", charCount);
      const heavy = budgetPreflight("gemini-2.5-pro", charCount);
      expect(standard.estimatedCostUsd).toBeGreaterThan(light.estimatedCostUsd!);
      expect(standard.estimatedCostUsd).toBeLessThan(heavy.estimatedCostUsd!);
    });
  });

  // ── Claude models ──────────────────────────────────────────────────────────

  describe("claude models", () => {
    it("claude-opus-4-7 has higher cost than claude-haiku-4-5", () => {
      const charCount = 4_000_000;
      const haiku = budgetPreflight("claude-haiku-4-5", charCount);
      const opus = budgetPreflight("claude-opus-4-7", charCount);
      expect(opus.estimatedCostUsd).toBeGreaterThan(haiku.estimatedCostUsd!);
    });

    it("claude-sonnet-4-6 reports 200_000 token context window", () => {
      const result = budgetPreflight("claude-sonnet-4-6", 1000);
      expect(result.contextWindow).toBe(200_000);
    });
  });

  // ── Unknown model ──────────────────────────────────────────────────────────

  describe("unknown model", () => {
    it("falls back to default 128_000 token context window", () => {
      const result = budgetPreflight("unknown-model-xyz", 1000);
      expect(result.contextWindow).toBe(128_000);
    });

    it("estimatedCostUsd is undefined for unknown model", () => {
      const result = budgetPreflight("unknown-model-xyz", 1000);
      expect(result.estimatedCostUsd).toBeUndefined();
    });

    it("fits is still computed correctly against default window", () => {
      // 128_000 * 0.9 = 115_200 tokens = 460_800 chars
      const smallResult = budgetPreflight("unknown-model-xyz", 1000);
      expect(smallResult.fits).toBe(true);
      const largeResult = budgetPreflight("unknown-model-xyz", 460_801);
      expect(largeResult.fits).toBe(false);
    });
  });
});

// ── MODEL_CONTEXT_WINDOWS coverage ─────────────────────────────────────────

describe("MODEL_CONTEXT_WINDOWS", () => {
  it("covers all three Google Gemini tiers", () => {
    expect(MODEL_CONTEXT_WINDOWS["gemini-2.0-flash"]).toBeDefined();
    expect(MODEL_CONTEXT_WINDOWS["gemini-2.5-flash"]).toBeDefined();
    expect(MODEL_CONTEXT_WINDOWS["gemini-2.5-pro"]).toBeDefined();
  });

  it("all values are positive integers", () => {
    for (const [model, tokens] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
      expect(tokens, `${model} context window`).toBeGreaterThan(0);
      expect(Number.isInteger(tokens), `${model} is integer`).toBe(true);
    }
  });
});

// ── MODEL_COSTS coverage ────────────────────────────────────────────────────

describe("MODEL_COSTS", () => {
  it("covers all three Google Gemini tiers", () => {
    expect(MODEL_COSTS["gemini-2.0-flash"]).toBeDefined();
    expect(MODEL_COSTS["gemini-2.5-flash"]).toBeDefined();
    expect(MODEL_COSTS["gemini-2.5-pro"]).toBeDefined();
  });

  it("all entries have inputPerMToken and outputPerMToken", () => {
    for (const [model, cost] of Object.entries(MODEL_COSTS)) {
      expect(cost.inputPerMToken, `${model}.inputPerMToken`).toBeGreaterThan(0);
      expect(cost.outputPerMToken, `${model}.outputPerMToken`).toBeGreaterThan(0);
    }
  });

  it("output cost is always higher than input cost for the same model", () => {
    for (const [model, cost] of Object.entries(MODEL_COSTS)) {
      expect(
        cost.outputPerMToken,
        `${model} output cost should be >= input cost`,
      ).toBeGreaterThanOrEqual(cost.inputPerMToken);
    }
  });
});
