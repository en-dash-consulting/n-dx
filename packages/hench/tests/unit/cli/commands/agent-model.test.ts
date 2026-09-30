/**
 * Agent model resolution for `ndx work`.
 *
 * The precedence chain under test is:
 *   --model  >  hench.models.<active vendor>  >  llm.*  >  vendor default
 *
 * The middle rung is the agent-only override: it must reach `ndx work` and
 * nothing else, must apply only for the vendor actually in use, and must fail
 * the same way a bad `llm.model` does rather than silently running the wrong
 * vendor's model.
 */

import { describe, it, expect } from "vitest";
import { NEWEST_MODELS, resolveModel } from "@n-dx/llm-client";
import type { LLMConfig } from "@n-dx/llm-client";
import { resolveAgentModel } from "../../../../src/cli/commands/agent-model.js";
import { CLIError } from "../../../../src/cli/errors.js";

describe("resolveAgentModel", () => {
  // ── hench.models.<vendor> is honoured ─────────────────────────────────────

  it("uses hench.models.<active vendor> and reports it as hench-override", () => {
    const result = resolveAgentModel({
      vendor: "claude",
      henchModels: { claude: "opus" },
    });

    expect(result.model).toBe(resolveModel("opus"));
    expect(result.source).toBe("hench-override");
  });

  it("expands a shorthand alias in the override, as the other rungs do", () => {
    const result = resolveAgentModel({
      vendor: "claude",
      henchModels: { claude: "sonnet" },
    });

    expect(result.model).toBe(resolveModel("sonnet"));
    expect(result.model).not.toBe("sonnet");
  });

  it("beats every llm.* model field", () => {
    const llmConfig: LLMConfig = {
      vendor: "claude",
      model: "claude-haiku-4-5",
      claude: { model: "claude-sonnet-4-6" },
    };

    const result = resolveAgentModel({
      vendor: "claude",
      henchModels: { claude: "opus" },
      llmConfig,
    });

    expect(result.model).toBe(resolveModel("opus"));
    expect(result.source).toBe("hench-override");
  });

  // ── --model still wins ────────────────────────────────────────────────────

  it("yields to an explicit --model flag", () => {
    const result = resolveAgentModel({
      vendor: "claude",
      cliModelOverride: "haiku",
      henchModels: { claude: "opus" },
    });

    expect(result.model).toBe(resolveModel("haiku"));
    expect(result.source).toBe("cli-override");
  });

  // ── Only the active vendor's entry is read ────────────────────────────────

  it("ignores an override for a vendor other than the active one", () => {
    const llmConfig: LLMConfig = { vendor: "codex", codex: { model: "gpt-5" } };

    const result = resolveAgentModel({
      vendor: "codex",
      henchModels: { claude: "opus" },
      llmConfig,
    });

    expect(result.model).toBe("gpt-5");
    expect(result.source).toBe("configured");
  });

  it("ignores an inactive vendor's override even when it would be incompatible", () => {
    // A Claude pin left behind while the user is on codex must not throw —
    // carrying a model per vendor is the whole point of the map.
    expect(() =>
      resolveAgentModel({
        vendor: "codex",
        henchModels: { claude: "opus" },
      }),
    ).not.toThrow();
  });

  it("treats an empty or whitespace override as absent", () => {
    const result = resolveAgentModel({
      vendor: "claude",
      henchModels: { claude: "   " },
    });

    expect(result.source).toBe("default");
    expect(result.model).toBe(NEWEST_MODELS.claude);
  });

  // ── Vendor compatibility ──────────────────────────────────────────────────

  it("rejects an override incompatible with the active vendor", () => {
    expect(() =>
      resolveAgentModel({
        vendor: "claude",
        henchModels: { claude: "gpt-5.6-terra" },
      }),
    ).toThrow(CLIError);
  });

  it("gives the incompatible override the same actionable error a bad llm.model gets", () => {
    let overrideMessage = "";
    let configuredMessage = "";

    try {
      resolveAgentModel({ vendor: "claude", henchModels: { claude: "gpt-5.6-terra" } });
    } catch (err) {
      overrideMessage = (err as CLIError).message;
    }
    try {
      resolveAgentModel({
        vendor: "claude",
        llmConfig: { vendor: "claude", model: "gpt-5.6-terra" },
      });
    } catch (err) {
      configuredMessage = (err as CLIError).message;
    }

    expect(overrideMessage).toContain('not compatible with vendor="claude"');
    expect(overrideMessage).toBe(configuredMessage);
  });

  it("rejects a Claude model pinned for codex", () => {
    expect(() =>
      resolveAgentModel({ vendor: "codex", henchModels: { codex: "opus" } }),
    ).toThrow(/not compatible with vendor="codex"/);
  });

  it("accepts any non-empty model for the local vendor", () => {
    const result = resolveAgentModel({
      vendor: "local",
      henchModels: { local: "qwen3-coder-30b" },
    });

    expect(result.model).toBe("qwen3-coder-30b");
    expect(result.source).toBe("hench-override");
  });

  // ── Regression: behaviour with no override is unchanged ───────────────────

  it("falls through to llm.<vendor>.model as configured when no override is set", () => {
    const llmConfig: LLMConfig = { vendor: "claude", claude: { model: "opus" } };

    const result = resolveAgentModel({ vendor: "claude", llmConfig });

    expect(result.model).toBe(resolveModel("opus"));
    expect(result.source).toBe("configured");
  });

  it("falls through to top-level llm.model as configured when no override is set", () => {
    const llmConfig: LLMConfig = { vendor: "claude", model: "claude-haiku-4-5" };

    const result = resolveAgentModel({ vendor: "claude", llmConfig });

    expect(result.model).toBe("claude-haiku-4-5");
    expect(result.source).toBe("configured");
  });

  it("falls through to the vendor default when nothing is configured", () => {
    const result = resolveAgentModel({ vendor: "claude", llmConfig: { vendor: "claude" } });

    expect(result.model).toBe(NEWEST_MODELS.claude);
    expect(result.source).toBe("default");
  });

  it("still rejects an incompatible llm.model when no override is set", () => {
    expect(() =>
      resolveAgentModel({ vendor: "claude", llmConfig: { vendor: "claude", model: "gpt-5.6-terra" } }),
    ).toThrow(CLIError);
  });

  it("does not consult the deprecated hench.model scalar", () => {
    // `models` absent, legacy scalar set to something that would be visible
    // if it were read: the result must still be the vendor default.
    const result = resolveAgentModel({
      vendor: "claude",
      henchModels: undefined,
      llmConfig: { vendor: "claude" },
    });

    expect(result.model).toBe(NEWEST_MODELS.claude);
    expect(result.source).toBe("default");
  });
});
