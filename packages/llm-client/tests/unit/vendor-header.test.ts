/**
 * Unit tests for printVendorModelHeader.
 *
 * Verifies the single-line vendor/model output that is printed at the start of
 * every ndx command that invokes an LLM. Tests cover:
 *
 * - Default model source label ("default" when no config provided)
 * - Configured model source label ("configured" when model is set in config)
 * - Suppression in --format=json mode
 * - Suppression in quiet mode
 * - Model-change warning when lastModel differs from resolved model
 * - No warning when lastModel matches resolved model
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setQuiet } from "../../src/output.js";
import { printVendorModelHeader } from "../../src/vendor-header.js";
import { NEWEST_MODELS } from "../../src/config.js";
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
});
