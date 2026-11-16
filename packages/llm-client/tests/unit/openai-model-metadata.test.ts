import { describe, expect, it } from "vitest";
import { budgetPreflight } from "../../src/budget-preflight.js";
import { resolveModelPricing } from "../../src/model-pricing.js";
import { resolveOpenAIModel, resolveOpenAICost } from "../../src/openai-model-metadata.js";

describe("dated OpenAI metadata", () => {
  it.each(["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna", "gpt-5.5", "gpt-5.4-mini", "gpt-5.1-codex-mini"])("accepts a supported 150K prompt for %s", (model) => {
    expect(budgetPreflight(model, 600_000)).toMatchObject({ fits: true, contextKnown: true });
  });
  it("separates API maximum, input maximum and Codex/Work default", () => {
    expect(resolveOpenAIModel("gpt-6.1-sol")).toMatchObject({ apiContext: 1_050_000, apiMaxInput: 922_000, codexContext: 500_000, workContext: 500_000 });
    expect(budgetPreflight("gpt-6.1-sol", 600_000, { surface: "codex" }).contextWindow).toBe(500_000);
    expect(budgetPreflight("gpt-6.1-sol", 923_000 * 4).fits).toBe(false);
    expect(budgetPreflight("gpt-6-astra", 600_000, { surface: "codex" }).contextKnown).toBe(false);
  });
  it("uses literal pinned model rates, including dated snapshots", () => {
    expect(resolveModelPricing("gpt-5.5-2026-04-23")).toMatchObject({ known: true, pricing: { inputPerMillion: 5, outputPerMillion: 30 } });
    expect(resolveModelPricing("gpt-5.1-codex-mini")).toMatchObject({ known: true, pricing: { inputPerMillion: 0.25, outputPerMillion: 2 } });
    expect(resolveOpenAIModel("gpt-5.3-codex-spark")).toBeUndefined();
    expect(resolveModelPricing("GPT-5.5-2026-04-23").known).toBe(true);
    expect(resolveModelPricing("constructor").known).toBe(false);
    expect(budgetPreflight("gpt-unknown", 600_000)).toMatchObject({ contextKnown: false, estimatedCostUsd: undefined });
  });
  it("prices the full request above, but not at, 272K", () => {
    expect(resolveOpenAICost("gpt-6.1-sol", { inputTokens: 272_000 })?.inputPerMToken).toBe(2);
    expect(resolveOpenAICost("gpt-6.1-sol", { inputTokens: 272_001 })).toMatchObject({ inputPerMToken: 4, outputPerMToken: 15, cacheReadPerMToken: 0.2, cacheWritePerMToken: 5 });
    expect(budgetPreflight("gpt-6.1-sol", 300_000 * 4).estimatedCostUsd).toBe(1.2);
  });
  it("selects only published modes and cache durations", () => {
    expect(resolveOpenAICost("gpt-6.1-sol", { mode: "fast", cacheDuration: "12h", inputTokens: 300_000 })).toMatchObject({ inputPerMToken: 8, outputPerMToken: 30, cacheWritePerMToken: 20 });
    expect(resolveOpenAICost("gpt-6-astra", { mode: "ultrafast" })?.inputPerMToken).toBe(60);
    expect(resolveOpenAICost("gpt-6-luna", { mode: "ultrafast" })).toBeUndefined();
    expect(resolveOpenAICost("gpt-5.5", { mode: "fast", inputTokens: 300_000 })).toBeUndefined();
    expect(resolveOpenAICost("gpt-5.4", { mode: "batch" })?.cacheReadPerMToken).toBe(0.13);
    expect(resolveOpenAICost("gpt-5.5", { cacheDuration: "12h" })).toBeUndefined();
  });
  it("does not invoice subscription usage at API rates", () => {
    expect(resolveOpenAICost("gpt-6.1-sol", { billing: "subscription" })).toBeUndefined();
    expect(resolveOpenAICost("gpt-6.1-sol", { surface: "work" })).toBeUndefined();
    expect(resolveOpenAICost("gpt-6.1-sol", { surface: "codex", billing: "api" })?.inputPerMToken).toBe(2);
    expect(budgetPreflight("gpt-6.1-sol", 600_000, { surface: "codex", billing: "subscription" }).estimatedCostUsd).toBeUndefined();
  });
});
