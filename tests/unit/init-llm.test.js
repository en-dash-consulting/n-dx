import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveInitLLMSelection,
  promptLLMSelection,
  isInteractiveTerminal,
  validateInitFlags,
  SUPPORTED_PROVIDERS,
  PROVIDER_LABELS,
  LLM_MODEL_CATALOG,
  getModelsForVendor,
  getRecommendedModel,
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
        cancelled: false,
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
        cancelled: false,
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
      expect(result).toHaveProperty("cancelled", false);
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
      expect(result.cancelled).toBe(true);
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
      expect(result.cancelled).toBe(true);
    });

    it("sets cancelled to false when no prompts are needed", async () => {
      const resolution = {
        provider: "claude",
        model: "claude-sonnet-4-6",
        providerSource: "config",
        modelSource: "config",
        needsProviderPrompt: false,
        needsModelPrompt: false,
      };
      const result = await promptLLMSelection(resolution);
      expect(result.cancelled).toBe(false);
    });

    it("sets cancelled to false when all prompts succeed", async () => {
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
      expect(result.cancelled).toBe(false);
    });

    it("sets cancelled when model prompt is cancelled after successful provider prompt", async () => {
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
      expect(result.provider).toBe("claude");
      expect(result.providerSource).toBe("prompt");
      expect(result.model).toBeUndefined();
      expect(result.cancelled).toBe(true);
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
        cancelled: false,
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
    it("always has exactly five keys", async () => {
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
        ["cancelled", "model", "modelSource", "provider", "providerSource"],
      );
    });
  });
});

// ─── isInteractiveTerminal ────────────────────────────────────────────────────

describe("isInteractiveTerminal", () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalCI = process.env.CI;

  afterEach(() => {
    // Restore original values
    if (originalIsTTY === undefined) {
      delete process.stdin.isTTY;
    } else {
      process.stdin.isTTY = originalIsTTY;
    }
    if (originalCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCI;
    }
  });

  it("returns false when stdin is not a TTY", () => {
    process.stdin.isTTY = false;
    delete process.env.CI;
    expect(isInteractiveTerminal()).toBe(false);
  });

  it("returns false when stdin.isTTY is undefined (piped input)", () => {
    delete process.stdin.isTTY;
    delete process.env.CI;
    expect(isInteractiveTerminal()).toBe(false);
  });

  it("returns false when CI environment variable is set", () => {
    process.stdin.isTTY = true;
    process.env.CI = "true";
    expect(isInteractiveTerminal()).toBe(false);
  });

  it("returns false when CI is set to any truthy string", () => {
    process.stdin.isTTY = true;
    process.env.CI = "1";
    expect(isInteractiveTerminal()).toBe(false);
  });

  it("returns true when stdin is TTY and CI is not set", () => {
    process.stdin.isTTY = true;
    delete process.env.CI;
    expect(isInteractiveTerminal()).toBe(true);
  });
});

// ─── Provider Labels (keyboard-driven select) ───────────────────────────────

describe("PROVIDER_LABELS", () => {
  it("has a label for every supported provider", () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(
        PROVIDER_LABELS[provider],
        `Missing label for provider '${provider}'`,
      ).toBeTruthy();
    }
  });

  it("includes both codex and claude as selectable options", () => {
    expect(PROVIDER_LABELS).toHaveProperty("codex");
    expect(PROVIDER_LABELS).toHaveProperty("claude");
  });

  it("labels are friendly display strings, not raw keys", () => {
    // Labels should be more descriptive than the raw key
    for (const [key, label] of Object.entries(PROVIDER_LABELS)) {
      expect(label.length, `Label for '${key}' should be longer than the key`).toBeGreaterThan(key.length);
      expect(typeof label).toBe("string");
    }
  });

  it("codex label is Codex (OpenAI)", () => {
    expect(PROVIDER_LABELS.codex).toBe("Codex (OpenAI)");
  });

  it("claude label is Claude (Anthropic)", () => {
    expect(PROVIDER_LABELS.claude).toBe("Claude (Anthropic)");
  });
});

// ─── LLM Model Catalog ──────────────────────────────────────────────────────

describe("LLM_MODEL_CATALOG", () => {
  it("has entries for both supported providers", () => {
    expect(LLM_MODEL_CATALOG).toHaveProperty("codex");
    expect(LLM_MODEL_CATALOG).toHaveProperty("claude");
  });

  it("each vendor has at least one model", () => {
    for (const [vendor, models] of Object.entries(LLM_MODEL_CATALOG)) {
      expect(models.length, `${vendor} should have at least one model`).toBeGreaterThanOrEqual(1);
    }
  });

  it("each vendor has exactly one recommended model", () => {
    for (const [vendor, models] of Object.entries(LLM_MODEL_CATALOG)) {
      const recommended = models.filter((m) => m.recommended);
      expect(
        recommended.length,
        `${vendor} should have exactly one recommended model`,
      ).toBe(1);
    }
  });

  it("every model has an id, label, and recommended field", () => {
    for (const [vendor, models] of Object.entries(LLM_MODEL_CATALOG)) {
      for (const model of models) {
        expect(model.id, `${vendor} model missing id`).toBeTruthy();
        expect(model.label, `${vendor} model missing label`).toBeTruthy();
        expect(
          typeof model.recommended,
          `${vendor}/${model.id} missing explicit recommended field`,
        ).toBe("boolean");
      }
    }
  });

  it("model IDs are unique within each vendor", () => {
    for (const [vendor, models] of Object.entries(LLM_MODEL_CATALOG)) {
      const ids = models.map((m) => m.id);
      expect(
        new Set(ids).size,
        `${vendor} has duplicate model IDs`,
      ).toBe(ids.length);
    }
  });

  // Contract tests: recommended defaults match known runtime defaults
  it("recommended Claude model is claude-sonnet-4-6", () => {
    const recommended = LLM_MODEL_CATALOG.claude.find((m) => m.recommended);
    expect(recommended.id).toBe("claude-sonnet-4-6");
  });

  it("recommended Codex model is gpt-5-codex", () => {
    const recommended = LLM_MODEL_CATALOG.codex.find((m) => m.recommended);
    expect(recommended.id).toBe("gpt-5-codex");
  });
});

describe("getModelsForVendor", () => {
  it("returns model list for known vendor", () => {
    const models = getModelsForVendor("claude");
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThanOrEqual(1);
  });

  it("returns undefined for unknown vendor", () => {
    expect(getModelsForVendor("unknown-vendor")).toBeUndefined();
  });

  it("returns same reference as catalog entry", () => {
    expect(getModelsForVendor("codex")).toBe(LLM_MODEL_CATALOG.codex);
  });
});

describe("getRecommendedModel", () => {
  it("returns recommended model for claude", () => {
    const recommended = getRecommendedModel("claude");
    expect(recommended).toBeDefined();
    expect(recommended.recommended).toBe(true);
    expect(recommended.id).toBe("claude-sonnet-4-6");
  });

  it("returns recommended model for codex", () => {
    const recommended = getRecommendedModel("codex");
    expect(recommended).toBeDefined();
    expect(recommended.recommended).toBe(true);
    expect(recommended.id).toBe("gpt-5-codex");
  });

  it("returns undefined for unknown vendor", () => {
    expect(getRecommendedModel("unknown-vendor")).toBeUndefined();
  });
});

// ─── Model prompt integration (via promptLLMSelection) ───────────────────────

describe("promptLLMSelection model prompt integration", () => {
  describe("default model prompt returns model from catalog", () => {
    it("returns model ID for single-model vendor without interactive prompt", async () => {
      // Codex has one model — defaultPromptModel auto-returns it
      const resolution = {
        provider: "codex",
        model: undefined,
        providerSource: "flag",
        modelSource: undefined,
        needsProviderPrompt: false,
        needsModelPrompt: true,
      };
      // Use default model prompt (no override) — single-model vendors auto-select
      const result = await promptLLMSelection(resolution);
      expect(result.model).toBe("gpt-5-codex");
      expect(result.modelSource).toBe("prompt");
    });
  });

  describe("model prompt receives correct provider after provider selection", () => {
    it("passes newly-prompted provider to default model prompt", async () => {
      const resolution = {
        provider: undefined,
        model: undefined,
        providerSource: undefined,
        modelSource: undefined,
        needsProviderPrompt: true,
        needsModelPrompt: true,
      };
      // Inject provider prompt but use default model prompt
      const result = await promptLLMSelection(resolution, {
        promptProvider: async () => "codex",
        // No promptModel override — uses default, which auto-selects for single-model vendor
      });
      expect(result.provider).toBe("codex");
      expect(result.model).toBe("gpt-5-codex");
      expect(result.modelSource).toBe("prompt");
    });
  });

  describe("injected model prompt still works for multi-model vendors", () => {
    it("allows override prompt to select a non-recommended model", async () => {
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
    });
  });

  describe("default model prompt returns undefined for unknown vendor", () => {
    it("returns undefined model for unknown vendor", async () => {
      const resolution = {
        provider: "unknown-vendor",
        model: undefined,
        providerSource: "flag",
        modelSource: undefined,
        needsProviderPrompt: false,
        needsModelPrompt: true,
      };
      // Default model prompt will check catalog, find nothing, return undefined
      const result = await promptLLMSelection(resolution);
      expect(result.model).toBeUndefined();
      expect(result.modelSource).toBeUndefined();
    });
  });
});

// ─── validateInitFlags ──────────────────────────────────────────────────────────

describe("validateInitFlags", () => {
  // ── No errors for valid combinations ──────────────────────────────────────

  describe("accepts valid flag combinations", () => {
    it("returns no errors when no flags are provided", () => {
      const { errors, warnings } = validateInitFlags({});
      expect(errors).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it("returns no errors for --provider alone", () => {
      const { errors } = validateInitFlags({ provider: "claude" });
      expect(errors).toEqual([]);
    });

    it("returns no errors for --provider + --model (matching vendor)", () => {
      const { errors } = validateInitFlags({ provider: "claude", model: "claude-sonnet-4-6" });
      expect(errors).toEqual([]);
    });

    it("returns no errors for --claude-model alone", () => {
      const { errors } = validateInitFlags({ claudeModel: "claude-sonnet-4-6" });
      expect(errors).toEqual([]);
    });

    it("returns no errors for --codex-model alone", () => {
      const { errors } = validateInitFlags({ codexModel: "gpt-5-codex" });
      expect(errors).toEqual([]);
    });

    it("returns no errors for --provider=claude + --claude-model (same vendor)", () => {
      const { errors } = validateInitFlags({ provider: "claude", claudeModel: "claude-sonnet-4-6" });
      expect(errors).toEqual([]);
    });

    it("returns no errors for --provider=codex + --codex-model (same vendor)", () => {
      const { errors } = validateInitFlags({ provider: "codex", codexModel: "gpt-5-codex" });
      expect(errors).toEqual([]);
    });
  });

  // ── Vendor-specific flags work independently of --provider ──────────────

  describe("allows vendor-specific flags independently of --provider", () => {
    it("accepts --provider=codex + --claude-model (cross-vendor)", () => {
      const { errors } = validateInitFlags({ provider: "codex", claudeModel: "claude-sonnet-4-6" });
      expect(errors).toEqual([]);
    });

    it("accepts --provider=claude + --codex-model (cross-vendor)", () => {
      const { errors } = validateInitFlags({ provider: "claude", codexModel: "gpt-5-codex" });
      expect(errors).toEqual([]);
    });

    it("accepts both --claude-model and --codex-model together", () => {
      const { errors } = validateInitFlags({ claudeModel: "claude-sonnet-4-6", codexModel: "gpt-5-codex" });
      expect(errors).toEqual([]);
    });

    it("accepts --provider + --claude-model + --codex-model (all three)", () => {
      const { errors } = validateInitFlags({
        provider: "codex",
        claudeModel: "claude-sonnet-4-6",
        codexModel: "gpt-5-codex",
      });
      expect(errors).toEqual([]);
    });
  });

  // ── Vendor-specific + generic --model is still ambiguous ──────────────────

  describe("rejects vendor-specific flag combined with generic --model", () => {
    it("errors when --claude-model and --model are both set", () => {
      const { errors } = validateInitFlags({ claudeModel: "claude-sonnet-4-6", model: "claude-opus-4-20250514" });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Cannot set both --claude-model and --model");
    });

    it("errors when --codex-model and --model are both set", () => {
      const { errors } = validateInitFlags({ codexModel: "gpt-5-codex", model: "gpt-5-codex" });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Cannot set both --codex-model and --model");
    });
  });

  // ── Unknown model warnings ────────────────────────────────────────────────

  describe("warns on unknown model IDs", () => {
    it("warns when --model is not in vendor catalog", () => {
      const { errors, warnings } = validateInitFlags({ provider: "claude", model: "claude-custom-v99" });
      expect(errors).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Unknown model "claude-custom-v99"');
      expect(warnings[0]).toContain("Proceeding anyway");
    });

    it("warns when --codex-model is not in codex catalog", () => {
      const { errors, warnings } = validateInitFlags({ codexModel: "gpt-custom-v99" });
      expect(errors).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Unknown model "gpt-custom-v99"');
      expect(warnings[0]).toContain("codex");
    });

    it("warns when --claude-model is not in claude catalog", () => {
      const { errors, warnings } = validateInitFlags({ claudeModel: "claude-custom-v99" });
      expect(errors).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Unknown model "claude-custom-v99"');
      expect(warnings[0]).toContain("claude");
    });

    it("does not warn when model is in vendor catalog", () => {
      const { warnings } = validateInitFlags({ provider: "claude", model: "claude-sonnet-4-6" });
      expect(warnings).toEqual([]);
    });

    it("does not warn when codex model is in codex catalog", () => {
      const { warnings } = validateInitFlags({ codexModel: "gpt-5-codex" });
      expect(warnings).toEqual([]);
    });

    it("includes known model IDs in warning message", () => {
      const { warnings } = validateInitFlags({ provider: "claude", model: "unknown-model" });
      expect(warnings[0]).toContain("claude-sonnet-4-6");
    });

    it("does not warn when there are errors (skips catalog check)", () => {
      const { warnings } = validateInitFlags({
        claudeModel: "unknown-model",
        model: "some-model",
      });
      // Has an error (--claude-model + --model ambiguous), so catalog check is skipped
      expect(warnings).toEqual([]);
    });

    it("warns independently for each vendor-specific flag", () => {
      const { errors, warnings } = validateInitFlags({
        claudeModel: "claude-custom-v99",
        codexModel: "gpt-custom-v99",
      });
      expect(errors).toEqual([]);
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain('Unknown model "claude-custom-v99"');
      expect(warnings[0]).toContain("claude");
      expect(warnings[1]).toContain('Unknown model "gpt-custom-v99"');
      expect(warnings[1]).toContain("codex");
    });
  });

  // ── Return shape ──────────────────────────────────────────────────────────

  describe("returns correct shape", () => {
    it("always returns errors and warnings arrays", () => {
      const result = validateInitFlags({});
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(Object.keys(result).sort()).toEqual(["errors", "warnings"]);
    });
  });
});
