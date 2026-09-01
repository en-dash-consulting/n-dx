import { describe, it, expect } from "vitest";
import {
  resolveReviewModel,
  REVIEW_MODELS,
  TIER_MODELS,
  NEWEST_MODELS,
  MODEL_COSTS,
  MODEL_CONTEXT_WINDOWS,
} from "../../src/config.js";
import type { LLMConfig } from "../../src/llm-types.js";

/**
 * The review model is a separate tier from the execution model on purpose.
 * These tests pin the two properties that make it worth having: the execution
 * model can never leak into it, and the recommended default is a real model
 * the cost tables know about.
 */

describe("resolveReviewModel — precedence", () => {
  it("falls back to the vendor's recommended reviewer with no config", () => {
    expect(resolveReviewModel("claude")).toBe("claude-opus-5");
    expect(resolveReviewModel("codex")).toBe(NEWEST_MODELS.codex);
    expect(resolveReviewModel("google")).toBe(TIER_MODELS.google.heavy);
  });

  it("prefers the vendor-neutral llm.reviewModel over the default", () => {
    const config: LLMConfig = { reviewModel: "claude-fable-5" };

    expect(resolveReviewModel("claude", config)).toBe("claude-fable-5");
  });

  it("prefers the vendor-pinned reviewModel over the vendor-neutral one", () => {
    const config: LLMConfig = {
      reviewModel: "claude-sonnet-5",
      claude: { reviewModel: "claude-fable-5" },
    };

    expect(resolveReviewModel("claude", config)).toBe("claude-fable-5");
  });

  it("lets the explicit override win over every config source", () => {
    const config: LLMConfig = {
      reviewModel: "claude-sonnet-5",
      claude: { reviewModel: "claude-fable-5" },
    };

    expect(resolveReviewModel("claude", config, "claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });

  it("expands a shorthand alias in the override", () => {
    expect(resolveReviewModel("claude", undefined, "opus")).toBe("claude-opus-5");
  });

  it("normalizes a legacy codex id rather than passing it through", () => {
    expect(resolveReviewModel("codex", undefined, "gpt-5-codex")).toBe(NEWEST_MODELS.codex);
  });
});

describe("resolveReviewModel — execution model isolation", () => {
  it("ignores llm.model, so pinning a cheap executor does not downgrade the reviewer", () => {
    const config: LLMConfig = { model: "claude-haiku-4-5" };

    expect(resolveReviewModel("claude", config)).toBe(REVIEW_MODELS.claude);
  });

  it("ignores llm.<vendor>.model too", () => {
    const config: LLMConfig = { claude: { model: "claude-haiku-4-5" } };

    expect(resolveReviewModel("claude", config)).toBe(REVIEW_MODELS.claude);
  });

  it("ignores llm.<vendor>.lightModel", () => {
    const config: LLMConfig = { claude: { lightModel: "claude-haiku-4-5" } };

    expect(resolveReviewModel("claude", config)).toBe(REVIEW_MODELS.claude);
  });
});

describe("resolveReviewModel — local vendor", () => {
  it("returns empty string, meaning 'send no model flag'", () => {
    expect(resolveReviewModel("local")).toBe("");
  });

  it("still honors an explicit reviewModel when the server has a second model loaded", () => {
    expect(resolveReviewModel("local", { local: { reviewModel: "qwen-coder" } })).toBe("qwen-coder");
  });
});

describe("REVIEW_MODELS catalog", () => {
  it("recommends a reviewer at least as capable as the execution default", () => {
    // Sonnet 5 executes; Opus 5 reviews. If these ever collapse to the same
    // model, the separate tier has stopped earning its complexity.
    expect(REVIEW_MODELS.claude).not.toBe(TIER_MODELS.claude.standard);
  });

  it("has cost and context-window entries for every non-empty recommendation", () => {
    for (const [vendor, model] of Object.entries(REVIEW_MODELS)) {
      if (!model) continue;
      expect(MODEL_COSTS[model], `${vendor} → ${model} missing from MODEL_COSTS`).toBeDefined();
      expect(
        MODEL_CONTEXT_WINDOWS[model],
        `${vendor} → ${model} missing from MODEL_CONTEXT_WINDOWS`,
      ).toBeDefined();
    }
  });

  it("prices the Claude reviewer below the Fable tier it could have picked", () => {
    const reviewer = MODEL_COSTS[REVIEW_MODELS.claude];
    const fable = MODEL_COSTS["claude-fable-5"];

    expect(reviewer.inputPerMToken).toBeLessThan(fable.inputPerMToken);
    expect(reviewer.outputPerMToken).toBeLessThan(fable.outputPerMToken);
  });
});
