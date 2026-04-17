/**
 * Unit tests for printVendorModelHeader.
 *
 * Verifies the single-line vendor/model output that is printed at the start of
 * every ndx command that invokes an LLM. Tests cover:
 *
 * - Default model source label ("default" when no config provided)
 * - Configured model source label ("configured" when model is set in config)
 * - CLI override source label ("cli-override" when --model flag used)
 * - Tier label rendering (light, standard, configured-override, flag-override)
 * - Suppression in --format=json mode
 * - Suppression in quiet mode
 * - Model-change warning when lastModel differs from resolved model
 * - No warning when lastModel matches resolved model
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setQuiet } from "../../src/output.js";
import { printVendorModelHeader } from "../../src/vendor-header.js";
import { NEWEST_MODELS, TIER_MODELS } from "../../src/config.js";
import type { LLMConfig } from "../../src/llm-types.js";

describe("printVendorModelHeader", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setQuiet(false);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setQuiet(false);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // ── Default model ──────────────────────────────────────────────────────────

  it("prints header with default model source when no config provided", () => {
    printVendorModelHeader("claude", undefined);
    expect(logSpy).toHaveBeenCalledOnce();
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("Vendor: claude");
    expect(line).toContain(`Model: ${NEWEST_MODELS.claude}`);
    expect(line).toContain("(default)");
  });

  it("prints header with default model source when config has no model field", () => {
    const config: LLMConfig = { vendor: "claude", claude: { api_key: "sk-ant-test" } };
    printVendorModelHeader("claude", config);
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("(default)");
  });

  // ── Configured model ───────────────────────────────────────────────────────

  it("prints header with configured model source when claude.model is set", () => {
    const config: LLMConfig = {
      vendor: "claude",
      claude: { model: "claude-opus-4-20250514" },
    };
    printVendorModelHeader("claude", config);
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("Model: claude-opus-4-20250514");
    expect(line).toContain("(configured)");
  });

  it("prints header with configured model source for codex vendor", () => {
    const config: LLMConfig = {
      vendor: "codex",
      codex: { model: "gpt-5-codex-custom" },
    };
    printVendorModelHeader("codex", config);
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("Vendor: codex");
    expect(line).toContain("Model: gpt-5-codex-custom");
    expect(line).toContain("(configured)");
  });

  // ── Suppression ────────────────────────────────────────────────────────────

  it("suppresses output when format is 'json'", () => {
    printVendorModelHeader("claude", undefined, { format: "json" });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("suppresses output in quiet mode", () => {
    setQuiet(true);
    printVendorModelHeader("claude", undefined);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("does not suppress when format is not 'json'", () => {
    printVendorModelHeader("claude", undefined, { format: "table" });
    expect(logSpy).toHaveBeenCalledOnce();
  });

  // ── Model-change warning ───────────────────────────────────────────────────

  it("emits warning when lastModel differs from resolved model", () => {
    const config: LLMConfig = { vendor: "claude" };
    // lastModel is an older model — different from current NEWEST_MODELS.claude
    printVendorModelHeader("claude", config, {
      lastModel: "claude-haiku-4-20250414",
    });
    expect(errorSpy).toHaveBeenCalledOnce();
    const warning = errorSpy.mock.calls[0][0] as string;
    expect(warning).toContain("model changed since last run");
    expect(warning).toContain("claude-haiku-4-20250414");
    expect(warning).toContain(NEWEST_MODELS.claude);
  });

  it("does not emit warning when lastModel matches resolved model", () => {
    const config: LLMConfig = { vendor: "claude" };
    printVendorModelHeader("claude", config, {
      lastModel: NEWEST_MODELS.claude,
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("resolves shorthand alias before comparing with lastModel", () => {
    const config: LLMConfig = {
      vendor: "claude",
      claude: { model: "sonnet" }, // shorthand — resolves to NEWEST_MODELS.claude
    };
    printVendorModelHeader("claude", config, {
      lastModel: NEWEST_MODELS.claude, // full name — should match after alias expansion
    });
    // Both sides resolve to the same model; no warning expected
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("does not emit warning when no lastModel is provided", () => {
    printVendorModelHeader("claude", undefined);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // ── Tier label rendering (modelSource option) ────────────────────────────────

  describe("tier label rendering with modelSource", () => {
    it("renders '(cli-override)' when modelSource is cli-override", () => {
      printVendorModelHeader("claude", undefined, {
        resolvedModel: "claude-opus-4-20250514",
        modelSource: "cli-override",
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain("Model: claude-opus-4-20250514");
      expect(line).toContain("(cli-override)");
    });

    it("renders '(configured)' when modelSource is configured", () => {
      printVendorModelHeader("claude", undefined, {
        resolvedModel: "claude-sonnet-4-6",
        modelSource: "configured",
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain("(configured)");
    });

    it("renders '(default)' when modelSource is default", () => {
      printVendorModelHeader("claude", undefined, {
        resolvedModel: NEWEST_MODELS.claude,
        modelSource: "default",
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain("(default)");
    });

    it("uses resolvedModel over config-resolved model when provided", () => {
      const config: LLMConfig = {
        vendor: "claude",
        claude: { model: "claude-opus-4-20250514" },
      };
      // resolvedModel should override config lookup
      printVendorModelHeader("claude", config, {
        resolvedModel: TIER_MODELS.claude.light,
        modelSource: "default",
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain(`Model: ${TIER_MODELS.claude.light}`);
      expect(line).toContain("(default)");
    });

    it("renders light-tier model with cli-override source for flag override scenario", () => {
      // Simulates: user ran `ndx add --model=haiku "task"` (CLI flag → light model)
      printVendorModelHeader("claude", undefined, {
        resolvedModel: TIER_MODELS.claude.light,
        modelSource: "cli-override",
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain(`Model: ${TIER_MODELS.claude.light}`);
      expect(line).toContain("(cli-override)");
    });

    it("renders codex light-tier model with configured source", () => {
      // Simulates: lightModel configured in .n-dx.json for codex
      const config: LLMConfig = {
        vendor: "codex",
        codex: { lightModel: "gpt-4o-mini" },
      };
      printVendorModelHeader("codex", config, {
        resolvedModel: "gpt-4o-mini",
        modelSource: "configured",
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain("Vendor: codex");
      expect(line).toContain("Model: gpt-4o-mini");
      expect(line).toContain("(configured)");
    });

    it("renders standard-tier model with default source when no config", () => {
      // Simulates: analyze command using standard tier with no overrides
      printVendorModelHeader("claude", undefined, {
        resolvedModel: TIER_MODELS.claude.standard,
        modelSource: "default",
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain(`Model: ${TIER_MODELS.claude.standard}`);
      expect(line).toContain("(default)");
    });

    it("renders codex standard-tier model with default source", () => {
      printVendorModelHeader("codex", undefined, {
        resolvedModel: TIER_MODELS.codex.standard,
        modelSource: "default",
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain(`Model: ${TIER_MODELS.codex.standard}`);
      expect(line).toContain("(default)");
    });
  });

  // ── Tier label rendering (tier option) ───────────────────────────────────────

  describe("tier label rendering with tier option", () => {
    it("renders '(light tier)' when tier is light and source is default", () => {
      printVendorModelHeader("claude", undefined, {
        resolvedModel: TIER_MODELS.claude.light,
        modelSource: "default",
        tier: "light",
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain(`Model: ${TIER_MODELS.claude.light}`);
      expect(line).toContain("(light tier)");
      expect(line).not.toContain("configured");
    });

    it("renders '(light tier, configured)' when tier is light and lightModel is configured", () => {
      const config: LLMConfig = {
        vendor: "claude",
        claude: { lightModel: "claude-haiku-4-20250414" },
      };
      printVendorModelHeader("claude", config, {
        resolvedModel: TIER_MODELS.claude.light,
        modelSource: "configured",
        tier: "light",
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain("(light tier, configured)");
    });

    it("renders '(standard tier)' when tier is standard and source is default", () => {
      printVendorModelHeader("claude", undefined, {
        resolvedModel: TIER_MODELS.claude.standard,
        modelSource: "default",
        tier: "standard",
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain(`Model: ${TIER_MODELS.claude.standard}`);
      expect(line).toContain("(standard tier)");
    });

    it("omits tier label when modelSource is cli-override even if tier is provided", () => {
      printVendorModelHeader("claude", undefined, {
        resolvedModel: "claude-opus-4-20250514",
        modelSource: "cli-override",
        tier: "light",
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain("(cli-override)");
      expect(line).not.toContain("tier");
    });

    it("uses legacy format when tier is not provided (backward compat)", () => {
      printVendorModelHeader("claude", undefined, {
        resolvedModel: TIER_MODELS.claude.light,
        modelSource: "default",
        // tier not provided — legacy behavior
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain("(default)");
      expect(line).not.toContain("tier");
    });

    it("renders codex light-tier with tier label", () => {
      printVendorModelHeader("codex", undefined, {
        resolvedModel: TIER_MODELS.codex.light,
        modelSource: "default",
        tier: "light",
      });
      const line = logSpy.mock.calls[0][0] as string;
      expect(line).toContain("Vendor: codex");
      expect(line).toContain(`Model: ${TIER_MODELS.codex.light}`);
      expect(line).toContain("(light tier)");
    });
  });
});
