import { describe, it, expect } from "vitest";
import { budgetPreflight } from "../../src/budget-preflight.js";
import {
  MODEL_CONTEXT_WINDOWS,
  MODEL_COSTS,
  GOOGLE_MODELS,
  PRICES_LAST_VERIFIED,
} from "../../src/config.js";

describe("budgetPreflight", () => {
  // ── gemini-3.5-flash-lite ───────────────────────────────────────────────────────

  describe("gemini-3.5-flash-lite (light tier)", () => {
    it("returns modelId in result", () => {
      const result = budgetPreflight("gemini-3.5-flash-lite", 1000);
      expect(result.modelId).toBe("gemini-3.5-flash-lite");
    });

    it("estimates token count as ceil(charCount / 4)", () => {
      const result = budgetPreflight("gemini-3.5-flash-lite", 100);
      expect(result.tokenEstimate).toBe(25); // ceil(100/4)
    });

    it("rounds up fractional token estimate", () => {
      const result = budgetPreflight("gemini-3.5-flash-lite", 101);
      expect(result.tokenEstimate).toBe(26); // ceil(101/4) = ceil(25.25)
    });

    it("reports contextWindow from MODEL_CONTEXT_WINDOWS", () => {
      const result = budgetPreflight("gemini-3.5-flash-lite", 1000);
      expect(result.contextWindow).toBe(MODEL_CONTEXT_WINDOWS["gemini-3.5-flash-lite"]);
      expect(result.contextWindow).toBe(1_000_000);
    });

    it("fits is true for a small prompt", () => {
      const result = budgetPreflight("gemini-3.5-flash-lite", 1000);
      expect(result.fits).toBe(true);
    });

    it("fits is false when prompt exceeds 90% of context window", () => {
      // 90% of 1_000_000 tokens = 900_000 tokens = 3_600_000 chars
      // Use 3_600_001 chars → tokenEstimate = 900_001 > 900_000 threshold
      const result = budgetPreflight("gemini-3.5-flash-lite", 3_600_001);
      expect(result.fits).toBe(false);
    });

    it("computes utilizationPercent correctly", () => {
      // 1000 chars → 250 tokens, context = 1_000_000
      const result = budgetPreflight("gemini-3.5-flash-lite", 1000);
      expect(result.utilizationPercent).toBeCloseTo(0.025);
    });

    it("computes estimatedCostUsd using inputPerMToken", () => {
      // 1_000_000 chars → 250_000 tokens → 0.25 MTok × the model's input rate.
      // Derived from MODEL_COSTS so a price change doesn't require editing this.
      const rate = MODEL_COSTS["gemini-3.5-flash-lite"].inputPerMToken;
      const result = budgetPreflight("gemini-3.5-flash-lite", 1_000_000);
      expect(result.estimatedCostUsd).toBeCloseTo(0.25 * rate, 5);
    });

    it("estimatedCostUsd reflects MODEL_COSTS entry", () => {
      const cost = MODEL_COSTS["gemini-3.5-flash-lite"];
      const result = budgetPreflight("gemini-3.5-flash-lite", 4_000_000); // 1M tokens
      expect(result.estimatedCostUsd).toBeCloseTo(cost.inputPerMToken, 5);
    });

    // Locks the documented input-only contract (see the MODEL_COSTS doc comment in
    // config.ts). If a future change starts folding output cost into this figure,
    // that is a behaviour change and must update the docs — not slip through.
    it("excludes output cost — estimatedCostUsd prices only the input side", () => {
      const cost = MODEL_COSTS["gemini-2.5-pro"];
      // Guard the fixture: this assertion is only meaningful while the two rates differ.
      expect(cost.outputPerMToken).not.toBe(cost.inputPerMToken);

      // 100k tokens — deliberately inside the base tier, so this asserts the
      // input/output split rather than accidentally testing tier selection.
      const result = budgetPreflight("gemini-2.5-pro", 400_000);
      expect(result.costTier).toBe("base");
      expect(result.estimatedCostUsd).toBeCloseTo(0.1 * cost.inputPerMToken, 10);
      expect(result.estimatedCostUsd).not.toBeCloseTo(
        0.1 * (cost.inputPerMToken + cost.outputPerMToken),
        10,
      );
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

    it("computes higher estimated cost than gemini-3.5-flash-lite for same input", () => {
      const flash = budgetPreflight("gemini-3.5-flash-lite", 100_000);
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

  // ── gemini-3.7-flash ───────────────────────────────────────────────────────

  describe("gemini-3.7-flash (standard tier)", () => {
    it("computes cost between gemini-3.5-flash-lite and gemini-2.5-pro", () => {
      const charCount = 4_000_000; // 1M tokens
      const light = budgetPreflight("gemini-3.5-flash-lite", charCount);
      const standard = budgetPreflight("gemini-3.7-flash", charCount);
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

    it("claude-sonnet-4-6 reports 1M token context window", () => {
      const result = budgetPreflight("claude-sonnet-4-6", 1000);
      expect(result.contextWindow).toBe(1_000_000);
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
    // Derived from GOOGLE_MODELS rather than hardcoded IDs so a model bump
    // cannot leave a configured tier without context-window data.
    for (const tier of ["light", "standard", "heavy"] as const) {
      expect(MODEL_CONTEXT_WINDOWS[GOOGLE_MODELS[tier]], tier).toBeDefined();
    }
  });

  it("all values are positive integers", () => {
    for (const [model, tokens] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
      expect(tokens, `${model} context window`).toBeGreaterThan(0);
      expect(Number.isInteger(tokens), `${model} is integer`).toBe(true);
    }
  });
});

// ── Threshold-tiered pricing ────────────────────────────────────────────────
//
// Some vendors charge a higher rate once a prompt crosses a token threshold
// (gemini-2.5-pro: 1.25/10.00 at or below 200k tokens, 2.50/15.00 above it).
// MODEL_COSTS carries those as an optional `aboveThreshold` block and
// budgetPreflight selects by tokenEstimate, so a large prompt is not priced at
// the small-prompt rate.

describe("threshold-tiered pricing", () => {
  const PRO_THRESHOLD = 200_000;

  it("gemini-2.5-pro declares an aboveThreshold tier", () => {
    const tier = MODEL_COSTS["gemini-2.5-pro"].aboveThreshold;
    expect(tier).toBeDefined();
    expect(tier!.thresholdTokens).toBe(PRO_THRESHOLD);
    expect(tier!.inputPerMToken).toBeGreaterThan(
      MODEL_COSTS["gemini-2.5-pro"].inputPerMToken,
    );
  });

  it("prices a prompt at the threshold using the base rate", () => {
    const cost = MODEL_COSTS["gemini-2.5-pro"];
    // Exactly 200_000 tokens — the threshold itself is still the base tier.
    const result = budgetPreflight("gemini-2.5-pro", PRO_THRESHOLD * 4);
    expect(result.tokenEstimate).toBe(PRO_THRESHOLD);
    expect(result.costTier).toBe("base");
    expect(result.estimatedCostUsd).toBeCloseTo(0.2 * cost.inputPerMToken, 10);
  });

  it("prices a prompt above the threshold using the aboveThreshold rate", () => {
    const cost = MODEL_COSTS["gemini-2.5-pro"];
    const tier = cost.aboveThreshold!;
    // 1M tokens — well past the threshold, and within the 1M context window.
    const result = budgetPreflight("gemini-2.5-pro", 4_000_000);
    expect(result.tokenEstimate).toBe(1_000_000);
    expect(result.costTier).toBe("aboveThreshold");
    expect(result.estimatedCostUsd).toBeCloseTo(tier.inputPerMToken, 10);
    // The bug this tier exists to fix: it must NOT be the base rate.
    expect(result.estimatedCostUsd).not.toBeCloseTo(cost.inputPerMToken, 10);
  });

  it("crosses tiers by one token at the threshold boundary", () => {
    const atThreshold = budgetPreflight("gemini-2.5-pro", PRO_THRESHOLD * 4);
    const oneOver = budgetPreflight("gemini-2.5-pro", PRO_THRESHOLD * 4 + 4);
    expect(atThreshold.costTier).toBe("base");
    expect(oneOver.costTier).toBe("aboveThreshold");
    expect(oneOver.estimatedCostUsd).toBeGreaterThan(atThreshold.estimatedCostUsd!);
  });

  it("reports the base tier for models with no aboveThreshold block", () => {
    // Claude 4.6+ bills the full 1M window at standard rates — no premium tier.
    const result = budgetPreflight("claude-sonnet-5", 4_000_000);
    expect(MODEL_COSTS["claude-sonnet-5"].aboveThreshold).toBeUndefined();
    expect(result.costTier).toBe("base");
    expect(result.estimatedCostUsd).toBeCloseTo(
      MODEL_COSTS["claude-sonnet-5"].inputPerMToken,
      10,
    );
  });

  it("reports no cost tier for a model absent from MODEL_COSTS", () => {
    const result = budgetPreflight("unknown-model-xyz", 1000);
    expect(result.estimatedCostUsd).toBeUndefined();
    expect(result.costTier).toBeUndefined();
  });
});

// ── Published-price conformance ─────────────────────────────────────────────
//
// Pinned to the figures verified against vendor pricing pages on the date in
// PRICES_LAST_VERIFIED (config.ts). This is deliberately tautological against
// the source — it cannot detect a real-world vendor price change, only an
// accidental edit. Detecting vendor changes needs the dated re-review that
// PRICES_LAST_VERIFIED exists to schedule.

describe("published-price conformance (verified 2026-09-01)", () => {
  it("claude-sonnet-5 is priced at the post-introductory standard rate", () => {
    // The $2/$10 launch introductory rate became the standard price; the
    // increase to $3/$15 scheduled for 2026-09-01 was cancelled by Anthropic.
    expect(MODEL_COSTS["claude-sonnet-5"]).toMatchObject({
      inputPerMToken: 2.0,
      outputPerMToken: 10.0,
    });
  });

  it("matches the verified per-MTok figures for every claude entry", () => {
    const verified: Record<string, [number, number]> = {
      "claude-haiku-4-5": [1.0, 5.0],
      "claude-fable-5": [10.0, 50.0],
      "claude-opus-5": [5.0, 25.0],
      "claude-opus-4-8": [5.0, 25.0],
      "claude-sonnet-5": [2.0, 10.0],
      "claude-sonnet-4-6": [3.0, 15.0],
      "claude-opus-4-7": [5.0, 25.0],
    };
    for (const [model, [input, output]] of Object.entries(verified)) {
      expect(MODEL_COSTS[model], model).toMatchObject({
        inputPerMToken: input,
        outputPerMToken: output,
      });
    }
  });

  it("records when prices were last verified against the vendors", () => {
    expect(PRICES_LAST_VERIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(PRICES_LAST_VERIFIED))).toBe(false);
  });
});

// ── MODEL_COSTS coverage ────────────────────────────────────────────────────
//
// These are shape guards on the table, not coverage of a cost calculation. Only
// `inputPerMToken` feeds one (via budgetPreflight); `outputPerMToken` is
// informational and asserted on for presence and ordering only. Passing this
// block does not mean the output rates affect any computed value — they do not.

describe("MODEL_COSTS", () => {
  it("covers all three Google Gemini tiers", () => {
    for (const tier of ["light", "standard", "heavy"] as const) {
      expect(MODEL_COSTS[GOOGLE_MODELS[tier]], tier).toBeDefined();
    }
  });

  it("all entries have inputPerMToken and outputPerMToken", () => {
    for (const [model, cost] of Object.entries(MODEL_COSTS)) {
      expect(cost.inputPerMToken, `${model}.inputPerMToken`).toBeGreaterThan(0);
      expect(cost.outputPerMToken, `${model}.outputPerMToken`).toBeGreaterThan(0);
    }
  });

  it("any aboveThreshold tier is well-formed and costlier than its base", () => {
    for (const [model, cost] of Object.entries(MODEL_COSTS)) {
      const tier = cost.aboveThreshold;
      if (tier === undefined) continue;
      expect(tier.thresholdTokens, `${model}.thresholdTokens`).toBeGreaterThan(0);
      // A premium tier that is not more expensive is either a data error or a
      // tier that should have been deleted.
      expect(tier.inputPerMToken, `${model} tier input`).toBeGreaterThan(cost.inputPerMToken);
      expect(tier.outputPerMToken, `${model} tier output`).toBeGreaterThanOrEqual(
        cost.outputPerMToken,
      );
      expect(tier.outputPerMToken, `${model} tier output >= tier input`).toBeGreaterThanOrEqual(
        tier.inputPerMToken,
      );
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
