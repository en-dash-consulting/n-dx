/**
 * The shared price table and its lookup.
 *
 * Two things are load-bearing here and neither is obvious from the call sites:
 * every model the toolkit can *select* must be priceable (otherwise a routing
 * change silently moves spend onto the fallback rate), and an unknown id must
 * degrade to a labelled fallback rather than throwing or pricing at zero.
 */

import { describe, it, expect } from "vitest";
import { MODEL_COSTS, TIER_MODELS } from "../../src/config.js";
import { LLM_VENDOR } from "../../src/provider-interface.js";
import {
  resolveModelPricing,
  priceTokens,
  FALLBACK_MODEL_PRICING,
  FALLBACK_PRICING_MODEL,
} from "../../src/model-pricing.js";

const PRICED_VENDORS = [LLM_VENDOR.CLAUDE, LLM_VENDOR.CODEX, LLM_VENDOR.GOOGLE] as const;

describe("MODEL_COSTS covers the selectable catalog", () => {
  it("prices every model in TIER_MODELS for claude, codex and google", () => {
    const missing: string[] = [];
    for (const vendor of PRICED_VENDORS) {
      for (const modelId of Object.values(TIER_MODELS[vendor])) {
        if (!MODEL_COSTS[modelId]) missing.push(`${vendor}: ${modelId}`);
      }
    }
    expect(missing, `models the router can select but cannot price`).toEqual([]);
  });

  it("gives every entry all four token kinds at a positive rate", () => {
    for (const [modelId, cost] of Object.entries(MODEL_COSTS)) {
      for (const kind of [
        "inputPerMToken",
        "outputPerMToken",
        "cacheWritePerMToken",
        "cacheReadPerMToken",
      ] as const) {
        expect(cost[kind], `${modelId}.${kind}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps cache writes at or above input and cache reads below it", () => {
    // A write is at worst free of premium (OpenAI, Google) and at best a
    // premium (Claude); a read is always a fraction. A rate that inverts this
    // ordering is a transcription error, not a price change.
    for (const [modelId, cost] of Object.entries(MODEL_COSTS)) {
      expect(cost.cacheWritePerMToken, `${modelId} cache write`).toBeGreaterThanOrEqual(
        cost.inputPerMToken,
      );
      expect(cost.cacheReadPerMToken, `${modelId} cache read`).toBeLessThan(cost.inputPerMToken);
    }
  });

  it("prices output above input for every model", () => {
    for (const [modelId, cost] of Object.entries(MODEL_COSTS)) {
      expect(cost.outputPerMToken, `${modelId}`).toBeGreaterThan(cost.inputPerMToken);
    }
  });
});

describe("resolveModelPricing", () => {
  it("returns catalog rates for an exact model id", () => {
    const resolved = resolveModelPricing("claude-opus-5");
    expect(resolved.known).toBe(true);
    expect(resolved.modelId).toBe("claude-opus-5");
    expect(resolved.pricing.inputPerMillion).toBe(5);
    expect(resolved.pricing.outputPerMillion).toBe(25);
  });

  it("expands a Claude CLI shorthand", () => {
    expect(resolveModelPricing("opus")).toMatchObject({ modelId: "claude-opus-5", known: true });
  });

  it("remaps a retired Codex model to its replacement's rates", () => {
    const resolved = resolveModelPricing("gpt-5.1-codex-mini");
    expect(resolved.known).toBe(true);
    expect(resolved.pricing).toEqual(resolveModelPricing("gpt-5.6-luna").pricing);
  });

  it("degrades an unknown id to a labelled fallback rather than throwing", () => {
    const resolved = resolveModelPricing("some-model-that-does-not-exist");
    expect(resolved.known).toBe(false);
    expect(resolved.modelId).toBe(FALLBACK_PRICING_MODEL);
    expect(resolved.pricing).toEqual(FALLBACK_MODEL_PRICING);
  });

  it("degrades a missing or blank id the same way", () => {
    for (const id of [undefined, "", "   "]) {
      expect(resolveModelPricing(id).known, `id=${JSON.stringify(id)}`).toBe(false);
    }
  });

  it("never falls back to a zero rate", () => {
    // Pricing an unknown model at zero reads as "this run was free", which is
    // a worse failure than being wrong by a known ratio.
    const { pricing } = resolveModelPricing("unknown");
    expect(pricing.inputPerMillion).toBeGreaterThan(0);
    expect(pricing.outputPerMillion).toBeGreaterThan(0);
  });
});

describe("priceTokens", () => {
  const oneMillionEach = {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreationTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
  };

  it("sums all four token kinds", () => {
    const cost = priceTokens(oneMillionEach, resolveModelPricing("claude-sonnet-5").pricing);
    expect(cost.inputCost).toBe(3);
    expect(cost.outputCost).toBe(15);
    expect(cost.cacheWriteCost).toBe(3.75);
    expect(cost.cacheReadCost).toBe(0.3);
    expect(cost.totalRaw).toBeCloseTo(22.05, 10);
  });

  it("prices the same tokens higher on Opus than on Sonnet", () => {
    const sonnet = priceTokens(oneMillionEach, resolveModelPricing("claude-sonnet-5").pricing);
    const opus = priceTokens(oneMillionEach, resolveModelPricing("claude-opus-5").pricing);
    expect(opus.totalRaw).toBeGreaterThan(sonnet.totalRaw);
  });

  it("returns zero for zero tokens", () => {
    const cost = priceTokens(
      { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
      FALLBACK_MODEL_PRICING,
    );
    expect(cost.totalRaw).toBe(0);
  });
});
