import { describe, it, expect } from "vitest";
import { resolveWeeklyBudget } from "../../../src/server/routes-token-usage.js";

describe("resolveWeeklyBudget", () => {
  it("returns vendor_model when vendor+model budget exists (with normalized keys)", () => {
    const result = resolveWeeklyBudget(
      { vendor: " CoDeX ", model: " GPT-5-CODEX " },
      {
        globalDefault: 100_000,
        vendors: {
          " CoDeX ": {
            default: 80_000,
            models: {
              " GPT-5-CODEX ": 120_000,
            },
          },
        },
      },
    );

    expect(result).toEqual({ budget: 120_000, source: "vendor_model" });
  });

  it("returns vendor_default when model budget is missing", () => {
    const result = resolveWeeklyBudget(
      { vendor: "codex", model: "gpt-5-codex" },
      {
        globalDefault: 100_000,
        vendors: {
          codex: {
            default: 80_000,
            models: {},
          },
        },
      },
    );

    expect(result).toEqual({
      budget: 80_000,
      source: "vendor_default",
      reasonCode: "fallback_model_budget_missing_or_invalid",
    });
  });

  it("returns global_default when vendor scope is missing", () => {
    const result = resolveWeeklyBudget(
      { vendor: "codex", model: "gpt-5-codex" },
      {
        globalDefault: 100_000,
        vendors: {
          claude: {
            default: 80_000,
          },
        },
      },
    );

    expect(result).toEqual({
      budget: 100_000,
      source: "global_default",
      reasonCode: "fallback_vendor_budget_missing_or_invalid",
    });
  });

  it("returns missing_budget with stable reason when no budget config is present", () => {
    const result = resolveWeeklyBudget(
      { vendor: "codex", model: "gpt-5-codex" },
      undefined,
      { hasConfiguredBudget: false },
    );

    expect(result).toEqual({
      budget: null,
      source: "missing_budget",
      reasonCode: "missing_budget_config_not_set",
    });
  });

  it("returns missing_budget invalid-config reason when only invalid budget values are provided", () => {
    const result = resolveWeeklyBudget(
      { vendor: "codex", model: "gpt-5-codex" },
      {
        globalDefault: -10,
        vendors: {
          codex: {
            default: Number.NaN,
            models: {
              "gpt-5-codex": 0,
            },
          },
        },
      },
      {
        hasConfiguredBudget: true,
        validationErrors: [
          { code: "invalid_budget_value", path: "tokenUsage.weeklyBudget.globalDefault", message: "x", received: -10 },
        ],
      },
    );

    expect(result).toEqual({
      budget: null,
      source: "missing_budget",
      reasonCode: "missing_budget_invalid_config",
    });
  });
});
