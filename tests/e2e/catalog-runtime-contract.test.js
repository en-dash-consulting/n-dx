/**
 * Catalog-runtime default alignment contract test.
 *
 * The orchestration-tier model catalog (`packages/core/llm-model-catalog.js`)
 * defines recommended models shown during `ndx init`. The foundation-tier
 * packages (`@n-dx/llm-client`) define default model constants used at
 * runtime when no explicit model is configured.
 *
 * These two sources must stay aligned. A change to the catalog's recommended
 * model without a matching change to the runtime default (or vice versa)
 * causes a silent UX/runtime mismatch: init tells the user one model is
 * the default, but runtime uses another.
 *
 * This test imports from both tiers and asserts equality, catching drift
 * the moment either side changes independently.
 *
 * @see packages/core/llm-model-catalog.js — orchestration-tier catalog
 * @see packages/llm-client/src/config.ts — DEFAULT_CLAUDE_MODEL
 * @see packages/llm-client/src/codex-cli-provider.ts — DEFAULT_CODEX_MODEL
 */

import { describe, it, expect } from "vitest";

// Orchestration tier: init-time model catalog
import {
  LLM_MODEL_CATALOG,
  getRecommendedModel,
} from "../../packages/core/llm-model-catalog.js";

// Foundation tier: runtime defaults
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CODEX_MODEL,
} from "../../packages/llm-client/dist/public.js";

describe("catalog-runtime default alignment", () => {
  it("recommended Claude model in catalog equals runtime DEFAULT_CLAUDE_MODEL", () => {
    const recommended = getRecommendedModel("claude");
    expect(recommended).toBeDefined();
    expect(recommended.id).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it("recommended Codex model in catalog equals runtime DEFAULT_CODEX_MODEL", () => {
    const recommended = getRecommendedModel("codex");
    expect(recommended).toBeDefined();
    expect(recommended.id).toBe(DEFAULT_CODEX_MODEL);
  });

  it("catalog recommended Claude model is claude-sonnet-4-6", () => {
    // Pinned assertion — catches both catalog and runtime changes at once.
    // If DEFAULT_CLAUDE_MODEL changes, the cross-reference test above fails.
    // If only the catalog changes, this test fails.
    const recommended = LLM_MODEL_CATALOG.claude.find((m) => m.recommended);
    expect(recommended.id).toBe("claude-sonnet-4-6");
  });

  it("catalog recommended Codex model is gpt-5.5", () => {
    const recommended = LLM_MODEL_CATALOG.codex.find((m) => m.recommended);
    expect(recommended.id).toBe("gpt-5.5");
  });

  it("runtime DEFAULT_CLAUDE_MODEL is claude-sonnet-4-6", () => {
    // Pinned assertion — catches runtime default changes independently.
    expect(DEFAULT_CLAUDE_MODEL).toBe("claude-sonnet-4-6");
  });

  it("runtime DEFAULT_CODEX_MODEL is gpt-5.5", () => {
    expect(DEFAULT_CODEX_MODEL).toBe("gpt-5.5");
  });
});
