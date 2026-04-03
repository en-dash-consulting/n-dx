import { describe, it, expect, vi } from "vitest";
import {
  resolveInitLLMSelection,
  promptLLMSelection,
} from "../../packages/core/init-llm.js";

describe("resolveInitLLMSelection", () => {
  // ── Flag precedence ──────────────────────────────────────────────────────

  describe("flags take precedence over existing config", () => {
    it("uses provider from flag even when config has a different vendor", () => {
      const result = resolveInitLLMSelection({
        flags: { provider: "codex" },
        existingConfig: { vendor: "claude", model: "claude-sonnet-4-6" },
        isTTY: true,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("flag");
    });

    it("uses model from flag even when config has a different model", () => {
      const result = resolveInitLLMSelection({
        flags: { provider: "claude", model: "claude-opus-4-20250514" },
        existingConfig: { vendor: "claude", model: "claude-sonnet-4-6" },
        isTTY: true,
      });
      expect(result.model).toBe("claude-opus-4-20250514");
      expect(result.modelSource).toBe("flag");
    });

    it("uses both provider and model from flags when both are given", () => {
      const result = resolveInitLLMSelection({
        flags: { provider: "codex", model: "gpt-5-codex" },
        existingConfig: {},
        isTTY: true,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("flag");
      expect(result.model).toBe("gpt-5-codex");
      expect(result.modelSource).toBe("flag");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });
  });

  // ── Existing config skips prompting ──────────────────────────────────────

  describe("existing config skips prompting when both vendor and model are set", () => {
    it("uses existing vendor and model without prompting", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "claude", model: "claude-sonnet-4-6" },
        isTTY: true,
      });
      expect(result.provider).toBe("claude");
      expect(result.providerSource).toBe("config");
      expect(result.model).toBe("claude-sonnet-4-6");
      expect(result.modelSource).toBe("config");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });

    it("uses existing codex vendor and model without prompting", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "codex", model: "gpt-5-codex" },
        isTTY: true,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("config");
      expect(result.model).toBe("gpt-5-codex");
      expect(result.modelSource).toBe("config");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });
  });

  // ── Missing model triggers model-only prompt ─────────────────────────────

  describe("missing model triggers model-only prompt when vendor is already set", () => {
    it("needs model prompt when vendor exists but model is absent", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "claude" },
        isTTY: true,
      });
      expect(result.provider).toBe("claude");
      expect(result.providerSource).toBe("config");
      expect(result.model).toBeUndefined();
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(true);
    });

    it("needs model prompt when vendor exists but model is undefined", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "codex", model: undefined },
        isTTY: true,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("config");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(true);
    });

    it("does not need model prompt when flag provides model for existing vendor", () => {
      const result = resolveInitLLMSelection({
        flags: { model: "claude-opus-4-20250514" },
        existingConfig: { vendor: "claude" },
        isTTY: true,
      });
      expect(result.provider).toBe("claude");
      expect(result.providerSource).toBe("config");
      expect(result.model).toBe("claude-opus-4-20250514");
      expect(result.modelSource).toBe("flag");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });
  });

  // ── Non-TTY environments ─────────────────────────────────────────────────

  describe("non-TTY environments skip prompts and use defaults/flags", () => {
    it("skips all prompts in non-TTY even when nothing is configured", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: {},
        isTTY: false,
      });
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });

    it("uses flags in non-TTY when provided", () => {
      const result = resolveInitLLMSelection({
        flags: { provider: "codex", model: "gpt-5-codex" },
        existingConfig: {},
        isTTY: false,
      });
      expect(result.provider).toBe("codex");
      expect(result.model).toBe("gpt-5-codex");
      expect(result.providerSource).toBe("flag");
      expect(result.modelSource).toBe("flag");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });

    it("uses existing config in non-TTY", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "claude", model: "claude-sonnet-4-6" },
        isTTY: false,
      });
      expect(result.provider).toBe("claude");
      expect(result.model).toBe("claude-sonnet-4-6");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });

    it("skips model prompt in non-TTY even when vendor exists but model is absent", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "codex" },
        isTTY: false,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("config");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });
  });

  // ── Fresh init (no config, no flags) ─────────────────────────────────────

  describe("fresh init with no config and no flags", () => {
    it("needs both prompts in TTY mode", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: {},
        isTTY: true,
      });
      expect(result.provider).toBeUndefined();
      expect(result.model).toBeUndefined();
      expect(result.needsProviderPrompt).toBe(true);
      expect(result.needsModelPrompt).toBe(true);
    });
  });

  // ── Provider flag without model ──────────────────────────────────────────

  describe("provider flag without model", () => {
    it("needs model prompt in TTY when only provider flag is given", () => {
      const result = resolveInitLLMSelection({
        flags: { provider: "claude" },
        existingConfig: {},
        isTTY: true,
      });
      expect(result.provider).toBe("claude");
      expect(result.providerSource).toBe("flag");
      expect(result.model).toBeUndefined();
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(true);
    });

    it("skips model prompt in non-TTY when only provider flag is given", () => {
      const result = resolveInitLLMSelection({
        flags: { provider: "codex" },
        existingConfig: {},
        isTTY: false,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("flag");
      expect(result.needsProviderPrompt).toBe(false);
      expect(result.needsModelPrompt).toBe(false);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty string model in config as missing", () => {
      const result = resolveInitLLMSelection({
        flags: {},
        existingConfig: { vendor: "claude", model: "" },
        isTTY: true,
      });
      expect(result.needsModelPrompt).toBe(true);
    });

    it("flag model overrides config model even when provider comes from config", () => {
      const result = resolveInitLLMSelection({
        flags: { model: "claude-haiku-4-20250414" },
        existingConfig: { vendor: "claude", model: "claude-sonnet-4-6" },
        isTTY: true,
      });
      expect(result.provider).toBe("claude");
      expect(result.providerSource).toBe("config");
      expect(result.model).toBe("claude-haiku-4-20250414");
      expect(result.modelSource).toBe("flag");
    });

    it("flag provider with config model from different vendor needs model prompt", () => {
      // Switching vendors means the old model is irrelevant
      const result = resolveInitLLMSelection({
        flags: { provider: "codex" },
        existingConfig: { vendor: "claude", model: "claude-sonnet-4-6" },
        isTTY: true,
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("flag");
      // Model from config is for claude, not codex — should not carry over
      expect(result.model).toBeUndefined();
      expect(result.needsModelPrompt).toBe(true);
    });
  });
});

// ─── promptLLMSelection ───────────────────────────────────────────────────────

describe("promptLLMSelection", () => {
  // ── Pass-through (no prompting needed) ────────────────────────────────────

  describe("passes through existing values when no prompts are needed", () => {
    it("returns config-resolved provider and model unchanged", async () => {
      const resolution = {
        provider: "claude",
        model: "claude-sonnet-4-6",
        providerSource: "config",
        modelSource: "config",
        needsProviderPrompt: false,
        needsModelPrompt: false,
      };
      const result = await promptLLMSelection(resolution);
      expect(result).toEqual({
        provider: "claude",
        model: "claude-sonnet-4-6",
        providerSource: "config",
        modelSource: "config",
      });
    });

    it("returns flag-resolved provider and model unchanged", async () => {
      const resolution = {
        provider: "codex",
        model: "gpt-5-codex",
        providerSource: "flag",
        modelSource: "flag",
        needsProviderPrompt: false,
        needsModelPrompt: false,
      };
      const result = await promptLLMSelection(resolution);
      expect(result).toEqual({
        provider: "codex",
        model: "gpt-5-codex",
        providerSource: "flag",
        modelSource: "flag",
      });
    });

    it("strips needsProviderPrompt and needsModelPrompt from output", async () => {
      const resolution = {
        provider: "claude",
        model: "claude-sonnet-4-6",
        providerSource: "config",
        modelSource: "config",
        needsProviderPrompt: false,
        needsModelPrompt: false,
      };
      const result = await promptLLMSelection(resolution);
      expect(result).not.toHaveProperty("needsProviderPrompt");
      expect(result).not.toHaveProperty("needsModelPrompt");
    });
  });

  // ── Provider prompting ────────────────────────────────────────────────────

  describe("prompts for provider when needsProviderPrompt is true", () => {
    it("sets provider and providerSource from prompt result", async () => {
      const resolution = {
        provider: undefined,
        model: undefined,
        providerSource: undefined,
        modelSource: undefined,
        needsProviderPrompt: true,
        needsModelPrompt: true,
      };
      const result = await promptLLMSelection(resolution, {
        promptProvider: async () => "codex",
        promptModel: async () => "gpt-5-codex",
      });
      expect(result.provider).toBe("codex");
      expect(result.providerSource).toBe("prompt");
    });

    it("marks providerSource as 'prompt' not 'flag' or 'config'", async () => {
      const resolution = {
        provider: undefined,
        model: undefined,
        providerSource: undefined,
        modelSource: undefined,
        needsProviderPrompt: true,
        needsModelPrompt: true,
      };
      const result = await promptLLMSelection(resolution, {
        promptProvider: async () => "claude",
        promptModel: async () => undefined,
      });
      expect(result.providerSource).toBe("prompt");
    });
  });

  // ── Model prompting ──────────────────────────────────────────────────────

  describe("prompts for model when needsModelPrompt is true", () => {
    it("sets model and modelSource from prompt result", async () => {
      const resolution = {
        provider: "claude",
        model: undefined,
        providerSource: "config",
        modelSource: undefined,
        needsProviderPrompt: false,
        needsModelPrompt: true,
      };
      const result = await promptLLMSelection(resolution, {
        promptModel: async () => "claude-opus-4-20250514",
      });
      expect(result.model).toBe("claude-opus-4-20250514");
      expect(result.modelSource).toBe("prompt");
      // Provider stays from config
      expect(result.provider).toBe("claude");
      expect(result.providerSource).toBe("config");
    });

    it("passes provider to model prompt function", async () => {
      const resolution = {
        provider: "codex",
        model: undefined,
        providerSource: "flag",
        modelSource: undefined,
        needsProviderPrompt: false,
        needsModelPrompt: true,
      };
      let receivedProvider;
      await promptLLMSelection(resolution, {
        promptModel: async (provider) => {
          receivedProvider = provider;
          return "gpt-5-codex";
        },
      });
      expect(receivedProvider).toBe("codex");
    });

    it("passes newly-prompted provider to model prompt", async () => {
      const resolution = {
        provider: undefined,
        model: undefined,
        providerSource: undefined,
        modelSource: undefined,
        needsProviderPrompt: true,
        needsModelPrompt: true,
      };
      let receivedProvider;
      await promptLLMSelection(resolution, {
        promptProvider: async () => "claude",
        promptModel: async (provider) => {
          receivedProvider = provider;
          return "claude-sonnet-4-6";
        },
      });
      expect(receivedProvider).toBe("claude");
    });
  });

  // ── Cancellation ─────────────────────────────────────────────────────────

  describe("handles prompt cancellation gracefully", () => {
    it("skips model prompt when provider prompt is cancelled", async () => {
      const resolution = {
        provider: undefined,
        model: undefined,
        providerSource: undefined,
        modelSource: undefined,
        needsProviderPrompt: true,
        needsModelPrompt: true,
      };
      const modelPrompt = vi.fn();
      const result = await promptLLMSelection(resolution, {
        promptProvider: async () => undefined,
        promptModel: modelPrompt,
      });
      expect(result.provider).toBeUndefined();
      expect(result.providerSource).toBeUndefined();
      expect(modelPrompt).not.toHaveBeenCalled();
    });

    it("keeps existing values when model prompt is cancelled", async () => {
      const resolution = {
        provider: "claude",
        model: undefined,
        providerSource: "config",
        modelSource: undefined,
        needsProviderPrompt: false,
        needsModelPrompt: true,
      };
      const result = await promptLLMSelection(resolution, {
        promptModel: async () => undefined,
      });
      expect(result.provider).toBe("claude");
      expect(result.providerSource).toBe("config");
      expect(result.model).toBeUndefined();
      expect(result.modelSource).toBeUndefined();
    });
  });

  // ── Both prompts in sequence ──────────────────────────────────────────────

  describe("runs both prompts in sequence for fresh init", () => {
    it("sets both provider and model with 'prompt' source", async () => {
      const resolution = {
        provider: undefined,
        model: undefined,
        providerSource: undefined,
        modelSource: undefined,
        needsProviderPrompt: true,
        needsModelPrompt: true,
      };
      const result = await promptLLMSelection(resolution, {
        promptProvider: async () => "codex",
        promptModel: async () => "gpt-5-codex",
      });
      expect(result).toEqual({
        provider: "codex",
        model: "gpt-5-codex",
        providerSource: "prompt",
        modelSource: "prompt",
      });
    });

    it("calls promptProvider before promptModel", async () => {
      const callOrder = [];
      const resolution = {
        provider: undefined,
        model: undefined,
        providerSource: undefined,
        modelSource: undefined,
        needsProviderPrompt: true,
        needsModelPrompt: true,
      };
      await promptLLMSelection(resolution, {
        promptProvider: async () => {
          callOrder.push("provider");
          return "claude";
        },
        promptModel: async () => {
          callOrder.push("model");
          return "claude-sonnet-4-6";
        },
      });
      expect(callOrder).toEqual(["provider", "model"]);
    });
  });

  // ── No-prompt flags ───────────────────────────────────────────────────────

  describe("does not invoke prompts when flags fully resolve selection", () => {
    it("never calls prompt functions when nothing needs prompting", async () => {
      const resolution = {
        provider: "claude",
        model: "claude-sonnet-4-6",
        providerSource: "flag",
        modelSource: "flag",
        needsProviderPrompt: false,
        needsModelPrompt: false,
      };
      const providerPrompt = vi.fn();
      const modelPrompt = vi.fn();
      await promptLLMSelection(resolution, {
        promptProvider: providerPrompt,
        promptModel: modelPrompt,
      });
      expect(providerPrompt).not.toHaveBeenCalled();
      expect(modelPrompt).not.toHaveBeenCalled();
    });
  });

  // ── Return shape ──────────────────────────────────────────────────────────

  describe("returns normalized selection object", () => {
    it("always has exactly four keys", async () => {
      const resolution = {
        provider: undefined,
        model: undefined,
        providerSource: undefined,
        modelSource: undefined,
        needsProviderPrompt: false,
        needsModelPrompt: false,
      };
      const result = await promptLLMSelection(resolution);
      expect(Object.keys(result).sort()).toEqual(
        ["model", "modelSource", "provider", "providerSource"],
      );
    });
  });
});
