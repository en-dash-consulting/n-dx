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
  TIER_MODELS,
  REVIEW_MODELS,
} from "../../packages/llm-client/dist/public.js";

// These surfaces derive from the runtime registry; they must not freeze an
// old default into a fresh project or disagree with what the dashboard shows.
import { renderCodexConfigToml } from "../../packages/core/assistant-assets.js";
import { buildVendorTiers } from "../../packages/web/dist/server/llm-tiers.js";
import { buildReviewInfo } from "../../packages/web/dist/server/llm-review.js";
import { resolveEffectiveAgentConfigFrom } from "../../packages/web/dist/server/effective-agent-config.js";

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

  it("catalog recommended Claude model is claude-sonnet-5-5", () => {
    // Pinned assertion — catches both catalog and runtime changes at once.
    // If DEFAULT_CLAUDE_MODEL changes, the cross-reference test above fails.
    // If only the catalog changes, this test fails.
    const recommended = LLM_MODEL_CATALOG.claude.find((m) => m.recommended);
    expect(recommended.id).toBe("claude-sonnet-5-5");
  });

  it("catalog recommended Codex model is gpt-6.1-sol", () => {
    const recommended = LLM_MODEL_CATALOG.codex.find((m) => m.recommended);
    expect(recommended.id).toBe("gpt-6.1-sol");
  });

  it("runtime DEFAULT_CLAUDE_MODEL is claude-sonnet-5-5", () => {
    // Pinned assertion — catches runtime default changes independently.
    expect(DEFAULT_CLAUDE_MODEL).toBe("claude-sonnet-5-5");
  });

  it("runtime DEFAULT_CODEX_MODEL is gpt-6.1-sol", () => {
    expect(DEFAULT_CODEX_MODEL).toBe("gpt-6.1-sol");
  });
});


describe("Codex catalog, template and dashboard upgrade contract", () => {
  it("offers every execution and review default in the init picker", () => {
    expect(TIER_MODELS.codex).toEqual({ light: "gpt-6-luna", standard: "gpt-6.1-sol", heavy: "gpt-6-astra" });
    const ids = LLM_MODEL_CATALOG.codex.map((m) => m.id);
    for (const model of [...Object.values(TIER_MODELS.codex), REVIEW_MODELS.codex]) expect(ids).toContain(model);
    expect(LLM_MODEL_CATALOG.codex.find((m) => m.id === "gpt-5.5")).toMatchObject({
      recommended: false, label: expect.stringContaining("API key only"),
    });
  });

  it("keeps the generated Codex template free of execution and effort pins", () => {
    const template = renderCodexConfigToml("n-dx");
    expect(template).toContain("[mcp_servers.rex]");
    expect(template).not.toMatch(/^\s*(model|model_reasoning_effort)\s*=/m);
  });

  it("reports the new defaults in dashboard tiers, execution and review", () => {
    const { effective, llmConfig } = resolveEffectiveAgentConfigFrom({ ndx: { llm: { vendor: "codex" } }, hench: {} });
    expect(effective.model).toBe(DEFAULT_CODEX_MODEL);
    expect(Object.fromEntries(buildVendorTiers(llmConfig).codex.map(({ tier, model }) => [tier, model]))).toEqual(TIER_MODELS.codex);
    expect(buildReviewInfo(effective, llmConfig, {}).models.codex.model).toBe(REVIEW_MODELS.codex);
  });

  it("reports explicit historical dashboard pins literally", () => {
    const llm = { vendor: "codex", codex: { model: "gpt-5.5", reviewModel: "gpt-5.4" }, tiers: { codex: { heavy: "gpt-5.6-sol" } } };
    const before = JSON.stringify(llm);
    const { effective, llmConfig } = resolveEffectiveAgentConfigFrom({ ndx: { llm }, hench: {} });
    expect(effective.model).toBe("gpt-5.5");
    expect(buildVendorTiers(llmConfig).codex.find(({ tier }) => tier === "heavy").model).toBe("gpt-5.6-sol");
    expect(buildReviewInfo(effective, llmConfig, {}).models.codex.model).toBe("gpt-5.4");
    expect(JSON.stringify(llm)).toBe(before);
  });
});
