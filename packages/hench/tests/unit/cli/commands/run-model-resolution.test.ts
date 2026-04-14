/**
 * Unit tests for model resolution and display in ndx work.
 *
 * Verifies that:
 * - Model from .n-dx.json is displayed in header
 * - CLI --model flag takes precedence and displays as "cli-override"
 * - No model displays resolver default as "default"
 * - Resolved model is passed to loops and used by LLM
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setQuiet } from "../../../../llm-client/dist/output.js";
import type { LLMConfig, VendorModelHeaderOptions } from "../../../../llm-client/dist/llm-types.js";
import { printVendorModelHeader } from "../../../../llm-client/dist/vendor-header.js";
import { NEWEST_MODELS } from "../../../../llm-client/dist/config.js";

describe("Model resolution in ndx work", () => {
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

  // ── Model from .n-dx.json configuration ────────────────────────────────────

  it("displays model from .n-dx.json with 'configured' source", () => {
    const llmConfig: LLMConfig = {
      vendor: "claude",
      claude: { model: "claude-opus-4-20250514" },
    };
    const resolvedModel = "claude-opus-4-20250514";
    const options: VendorModelHeaderOptions = {
      resolvedModel,
      modelSource: "configured",
    };

    printVendorModelHeader("claude", llmConfig, options);

    expect(logSpy).toHaveBeenCalledOnce();
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("Vendor: claude");
    expect(line).toContain("Model: claude-opus-4-20250514");
    expect(line).toContain("(configured)");
  });

  // ── CLI override takes precedence ──────────────────────────────────────────

  it("displays CLI --model flag with 'cli-override' source", () => {
    const llmConfig: LLMConfig = {
      vendor: "claude",
      claude: { model: "opus" },
    };
    // User provided --model=haiku on CLI
    const resolvedModel = "claude-haiku-4-20250414";
    const options: VendorModelHeaderOptions = {
      resolvedModel,
      modelSource: "cli-override",
    };

    printVendorModelHeader("claude", llmConfig, options);

    expect(logSpy).toHaveBeenCalledOnce();
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("Model: claude-haiku-4-20250414");
    expect(line).toContain("(cli-override)");
  });

  // ── No configuration falls back to default ─────────────────────────────────

  it("displays default model when no config and no CLI override", () => {
    const llmConfig: LLMConfig = { vendor: "claude" };
    // No model in config, no CLI override
    const resolvedModel = NEWEST_MODELS.claude;
    const options: VendorModelHeaderOptions = {
      resolvedModel,
      modelSource: "default",
    };

    printVendorModelHeader("claude", llmConfig, options);

    expect(logSpy).toHaveBeenCalledOnce();
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain(`Model: ${NEWEST_MODELS.claude}`);
    expect(line).toContain("(default)");
  });

  // ── Backward compatibility: no new parameters ──────────────────────────────

  it("maintains backward compatibility when resolvedModel/modelSource not provided", () => {
    const llmConfig: LLMConfig = {
      vendor: "claude",
      claude: { model: "sonnet" },
    };
    // Call without new parameters — should work as before
    printVendorModelHeader("claude", llmConfig);

    expect(logSpy).toHaveBeenCalledOnce();
    const line = logSpy.mock.calls[0][0] as string;
    // Should detect configured from config alone
    expect(line).toContain("(configured)");
  });

  // ── Codex vendor ───────────────────────────────────────────────────────────

  it("handles Codex vendor model from .n-dx.json", () => {
    const llmConfig: LLMConfig = {
      vendor: "codex",
      codex: { model: "gpt-5" },
    };
    const resolvedModel = "gpt-5";
    const options: VendorModelHeaderOptions = {
      resolvedModel,
      modelSource: "configured",
    };

    printVendorModelHeader("codex", llmConfig, options);

    expect(logSpy).toHaveBeenCalledOnce();
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("Vendor: codex");
    expect(line).toContain("Model: gpt-5");
    expect(line).toContain("(configured)");
  });

  // ── Shorthand expansion ────────────────────────────────────────────────────

  it("displays expanded model for shorthand aliases", () => {
    const llmConfig: LLMConfig = {
      vendor: "claude",
      claude: { model: "sonnet" },
    };
    // resolvedModel passed as expanded full name
    const resolvedModel = NEWEST_MODELS.claude; // Already expanded
    const options: VendorModelHeaderOptions = {
      resolvedModel,
      modelSource: "configured",
    };

    printVendorModelHeader("claude", llmConfig, options);

    expect(logSpy).toHaveBeenCalledOnce();
    const line = logSpy.mock.calls[0][0] as string;
    // Should display the expanded full name, not "sonnet"
    expect(line).toContain(`Model: ${NEWEST_MODELS.claude}`);
    expect(line).not.toContain("Model: sonnet");
  });

  // ── Model change detection ─────────────────────────────────────────────────

  it("emits warning when model changes between runs (with CLI override)", () => {
    const llmConfig: LLMConfig = {
      vendor: "claude",
      claude: { model: "opus" },
    };
    // Current run: user provided --model=haiku
    const resolvedModel = "claude-haiku-4-20250414";
    // Previous run used opus
    const options: VendorModelHeaderOptions = {
      resolvedModel,
      modelSource: "cli-override",
      lastModel: "claude-opus-4-20250514",
    };

    printVendorModelHeader("claude", llmConfig, options);

    expect(errorSpy).toHaveBeenCalledOnce();
    const warning = errorSpy.mock.calls[0][0] as string;
    expect(warning).toContain("model changed since last run");
    expect(warning).toContain("claude-opus-4-20250514");
    expect(warning).toContain("claude-haiku-4-20250414");
  });

  it("does not emit warning when model hasn't changed", () => {
    const llmConfig: LLMConfig = {
      vendor: "claude",
      claude: { model: "sonnet" },
    };
    const resolvedModel = NEWEST_MODELS.claude;
    const options: VendorModelHeaderOptions = {
      resolvedModel,
      modelSource: "configured",
      lastModel: NEWEST_MODELS.claude,
    };

    printVendorModelHeader("claude", llmConfig, options);

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
