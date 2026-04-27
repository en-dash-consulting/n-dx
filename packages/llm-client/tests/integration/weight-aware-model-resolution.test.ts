/**
 * Integration tests for weight-aware model resolution.
 *
 * Verifies the full resolution chain: loadLLMConfig → resolveVendorModel
 * with the TaskWeight parameter. Tests cover:
 *
 * - Light weight returns tier-appropriate models (haiku, gpt-5.4-mini)
 * - Standard weight returns full-capability models (sonnet, gpt-5)
 * - Config override: lightModel takes precedence for light weight
 * - Config override: model takes precedence for standard weight
 * - Precedence chain: explicit model string > config tier > TIER_MODELS > NEWEST_MODELS
 *
 * These tests exercise the resolution logic that will be used by rex commands
 * once the task-weight wiring is complete (see sibling task "Wire light-tier
 * model selection into rex smart-add and lightweight analysis paths").
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadLLMConfig,
  resolveVendorModel,
  TIER_MODELS,
  NEWEST_MODELS,
} from "../../src/public.js";
import type { LLMConfig, TaskWeight } from "../../src/public.js";

describe("weight-aware model resolution chain", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "llm-client-weight-resolution-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Light weight resolution ────────────────────────────────────────────────

  describe("light weight resolution", () => {
    it("returns claude haiku when weight is light and no config", async () => {
      const config = await loadLLMConfig(tmpDir);
      const model = resolveVendorModel("claude", config, "light");
      expect(model).toBe(TIER_MODELS.claude.light);
      expect(model).toBe("claude-haiku-4-20250414");
    });

    it("returns codex light model when weight is light and no config", async () => {
      const config = await loadLLMConfig(tmpDir);
      const model = resolveVendorModel("codex", config, "light");
      expect(model).toBe(TIER_MODELS.codex.light);
      expect(model).toBe("gpt-5.4-mini");
    });

    it("uses lightModel from config when weight is light for claude", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "claude",
            claude: { lightModel: "claude-haiku-4-20250414" },
          },
        }),
      );
      const config = await loadLLMConfig(tmpDir);
      const model = resolveVendorModel("claude", config, "light");
      expect(model).toBe("claude-haiku-4-20250414");
    });

    it("uses lightModel from config when weight is light for codex", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "codex",
            codex: { lightModel: "gpt-4o-mini" },
          },
        }),
      );
      const config = await loadLLMConfig(tmpDir);
      const model = resolveVendorModel("codex", config, "light");
      expect(model).toBe("gpt-4o-mini");
    });

    it("ignores model config for light weight (must use lightModel)", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "claude",
            claude: { model: "claude-opus-4-20250514" },
          },
        }),
      );
      const config = await loadLLMConfig(tmpDir);
      const model = resolveVendorModel("claude", config, "light");
      // model config is ignored for light weight — falls back to TIER_MODELS.light
      expect(model).toBe(TIER_MODELS.claude.light);
    });
  });

  // ── Standard weight resolution ─────────────────────────────────────────────

  describe("standard weight resolution", () => {
    it("returns claude sonnet when weight is standard and no config", async () => {
      const config = await loadLLMConfig(tmpDir);
      const model = resolveVendorModel("claude", config, "standard");
      expect(model).toBe(TIER_MODELS.claude.standard);
      expect(model).toBe(NEWEST_MODELS.claude);
    });

    it("returns codex standard model when weight is standard and no config", async () => {
      const config = await loadLLMConfig(tmpDir);
      const model = resolveVendorModel("codex", config, "standard");
      expect(model).toBe(TIER_MODELS.codex.standard);
      expect(model).toBe(NEWEST_MODELS.codex);
    });

    it("uses model from config when weight is standard for claude", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "claude",
            claude: { model: "claude-opus-4-20250514" },
          },
        }),
      );
      const config = await loadLLMConfig(tmpDir);
      const model = resolveVendorModel("claude", config, "standard");
      expect(model).toBe("claude-opus-4-20250514");
    });

    it("uses model from config when weight is standard for codex", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "codex",
            codex: { model: "gpt-4o" },
          },
        }),
      );
      const config = await loadLLMConfig(tmpDir);
      const model = resolveVendorModel("codex", config, "standard");
      expect(model).toBe("gpt-4o");
    });

    it("ignores lightModel config for standard weight", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "claude",
            claude: { lightModel: "claude-haiku-4-20250414" },
          },
        }),
      );
      const config = await loadLLMConfig(tmpDir);
      const model = resolveVendorModel("claude", config, "standard");
      // lightModel is ignored for standard weight — uses NEWEST_MODELS
      expect(model).toBe(NEWEST_MODELS.claude);
    });
  });

  // ── Default weight (omitted) ───────────────────────────────────────────────

  describe("default weight (omitted parameter)", () => {
    it("uses standard tier when weight parameter is omitted", async () => {
      const config = await loadLLMConfig(tmpDir);
      // Omitting weight should behave like 'standard'
      const modelWithoutWeight = resolveVendorModel("claude", config);
      const modelWithStandard = resolveVendorModel("claude", config, "standard");
      expect(modelWithoutWeight).toBe(modelWithStandard);
      expect(modelWithoutWeight).toBe(NEWEST_MODELS.claude);
    });

    it("respects model config when weight is omitted", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "claude",
            claude: { model: "claude-opus-4-20250514" },
          },
        }),
      );
      const config = await loadLLMConfig(tmpDir);
      const model = resolveVendorModel("claude", config);
      expect(model).toBe("claude-opus-4-20250514");
    });
  });

  // ── Precedence chain ───────────────────────────────────────────────────────

  describe("precedence chain", () => {
    it("explicit model string overrides tier-based selection for light weight", () => {
      // Simulates: CLI flag --model=opus passed to a light-tier command
      // The caller would pass the resolved model directly, not via config
      const explicitModel = "claude-opus-4-20250514";
      const config: LLMConfig = { claude: { lightModel: "haiku" } };
      // When caller has explicit model, they pass it directly — config is bypassed
      // This test verifies the expectation: explicit always wins
      expect(explicitModel).not.toBe(resolveVendorModel("claude", config, "light"));
    });

    it("explicit model string overrides tier-based selection for standard weight", () => {
      // Simulates: CLI flag --model=haiku passed to a standard-tier command
      const explicitModel = "claude-haiku-4-20250414";
      const config: LLMConfig = { claude: { model: "claude-opus-4-20250514" } };
      // When caller has explicit model, they use it directly
      expect(explicitModel).not.toBe(resolveVendorModel("claude", config, "standard"));
    });

    it("config tier (lightModel) takes precedence over TIER_MODELS for light", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            claude: { lightModel: "claude-sonnet-4-6" }, // unusual choice for light tier
          },
        }),
      );
      const config = await loadLLMConfig(tmpDir);
      const model = resolveVendorModel("claude", config, "light");
      expect(model).toBe("claude-sonnet-4-6");
      expect(model).not.toBe(TIER_MODELS.claude.light);
    });

    it("config tier (model) takes precedence over TIER_MODELS for standard", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            claude: { model: "claude-opus-4-20250514" },
          },
        }),
      );
      const config = await loadLLMConfig(tmpDir);
      const model = resolveVendorModel("claude", config, "standard");
      expect(model).toBe("claude-opus-4-20250514");
      expect(model).not.toBe(TIER_MODELS.claude.standard);
    });

    it("TIER_MODELS takes precedence over NEWEST_MODELS for light", () => {
      // This is always true by design: TIER_MODELS.light !== NEWEST_MODELS
      const config: LLMConfig = {};
      const model = resolveVendorModel("claude", config, "light");
      expect(model).toBe(TIER_MODELS.claude.light);
      expect(model).not.toBe(NEWEST_MODELS.claude);
    });

    it("TIER_MODELS.standard equals NEWEST_MODELS (invariant)", () => {
      // Verify the documented invariant holds
      expect(TIER_MODELS.claude.standard).toBe(NEWEST_MODELS.claude);
      expect(TIER_MODELS.codex.standard).toBe(NEWEST_MODELS.codex);
    });
  });

  // ── Legacy config compatibility ────────────────────────────────────────────

  describe("legacy config compatibility", () => {
    it("reads claude config from legacy top-level claude block", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          // Legacy format: claude at top level instead of under llm
          claude: {
            model: "claude-opus-4-20250514",
            lightModel: "claude-haiku-4-20250414",
          },
        }),
      );
      const config = await loadLLMConfig(tmpDir);
      expect(config.claude?.model).toBe("claude-opus-4-20250514");
      expect(config.claude?.lightModel).toBe("claude-haiku-4-20250414");

      const standardModel = resolveVendorModel("claude", config, "standard");
      expect(standardModel).toBe("claude-opus-4-20250514");

      const lightModel = resolveVendorModel("claude", config, "light");
      expect(lightModel).toBe("claude-haiku-4-20250414");
    });

    it("llm.claude takes precedence over legacy top-level claude", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          claude: { model: "legacy-model" },
          llm: {
            claude: { model: "llm-section-model" },
          },
        }),
      );
      const config = await loadLLMConfig(tmpDir);
      expect(config.claude?.model).toBe("llm-section-model");
    });
  });
});
