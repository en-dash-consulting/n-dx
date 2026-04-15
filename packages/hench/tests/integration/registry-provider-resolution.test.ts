/**
 * Registry-based provider resolution integration test.
 *
 * Validates that the `useRegistryProvider` flag gates agentLoop() between
 * two resolution paths:
 *
 *   1. **Legacy** (`false`, default) — manual vendor check + original error messages
 *   2. **Registry** (`true`) — ProviderRegistry.getActiveProvider() resolution
 *
 * Both paths must produce identical Claude API behavior. The flag only
 * changes how the provider is resolved, not how the loop executes.
 *
 * Neither path makes real API calls — tests verify resolution, validation,
 * and error handling up to (but not including) the first Anthropic SDK call.
 *
 * @see packages/hench/src/agent/lifecycle/loop.ts — implementation
 * @see packages/llm-client/src/provider-registry.ts — ProviderRegistry
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureHenchDir, initConfig } from "../../src/store/config.js";

describe("registry-based provider resolution", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-registry-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);

    // Create minimal .rex/ for store
    const rexDir = join(projectDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({
        schema: "rex/v1",
        project: "test",
        adapter: "file",
      }),
      "utf-8",
    );
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "task-1",
            title: "Test task",
            status: "pending",
            level: "task",
            priority: "high",
          },
        ],
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  // ── Dry run parity ────────────────────────────────────────────────────────

  describe("dry run produces identical results", () => {
    it("legacy path (useRegistryProvider=false) dry run succeeds", async () => {
      const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../src/store/config.js");

      const config = await loadConfig(henchDir);
      config.useRegistryProvider = false;
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      const result = await agentLoop({
        config,
        store,
        projectDir,
        henchDir,
        dryRun: true,
      });

      expect(result.run.status).toBe("completed");
      expect(result.run.turns).toBe(0);
      expect(result.run.summary).toContain("Dry run");
    });

    it("registry path (useRegistryProvider=true) dry run succeeds", async () => {
      const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../src/store/config.js");

      const config = await loadConfig(henchDir);
      config.useRegistryProvider = true;
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      const result = await agentLoop({
        config,
        store,
        projectDir,
        henchDir,
        dryRun: true,
      });

      expect(result.run.status).toBe("completed");
      expect(result.run.turns).toBe(0);
      expect(result.run.summary).toContain("Dry run");
    });

    it("both paths produce structurally identical dry run records", async () => {
      const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../src/store/config.js");

      const rexDir = join(projectDir, ".rex");

      const configLegacy = await loadConfig(henchDir);
      configLegacy.useRegistryProvider = false;
      const storeLegacy = createStore("file", rexDir);
      const legacyResult = await agentLoop({
        config: configLegacy,
        store: storeLegacy,
        projectDir,
        henchDir,
        dryRun: true,
      });

      const configRegistry = await loadConfig(henchDir);
      configRegistry.useRegistryProvider = true;
      const storeRegistry = createStore("file", rexDir);
      const registryResult = await agentLoop({
        config: configRegistry,
        store: storeRegistry,
        projectDir,
        henchDir,
        dryRun: true,
      });

      // Structural parity — both produce the same run shape
      expect(legacyResult.run.status).toBe(registryResult.run.status);
      expect(legacyResult.run.turns).toBe(registryResult.run.turns);
      expect(legacyResult.run.tokenUsage).toEqual(registryResult.run.tokenUsage);
      expect(legacyResult.run.model).toBe(registryResult.run.model);
    });
  });

  // ── API key validation parity ──────────────────────────────────────────────

  describe("API key validation is identical", () => {
    it("legacy path fails with 'API key not found' without credentials", async () => {
      const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../src/store/config.js");

      const config = await loadConfig(henchDir);
      config.useRegistryProvider = false;
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      const origKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      try {
        await expect(
          agentLoop({ config, store, projectDir, henchDir }),
        ).rejects.toThrow("API key not found");
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
      }
    });

    it("registry path fails with 'API key not found' without credentials", async () => {
      const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../src/store/config.js");

      const config = await loadConfig(henchDir);
      config.useRegistryProvider = true;
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      const origKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      try {
        await expect(
          agentLoop({ config, store, projectDir, henchDir }),
        ).rejects.toThrow("API key not found");
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
      }
    });
  });

  // ── Vendor rejection ───────────────────────────────────────────────────────

  describe("non-Claude vendor rejection", () => {
    it("legacy path rejects non-Claude vendor with original error message", async () => {
      const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../src/store/config.js");

      // Write .n-dx.json with codex vendor
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({ llm: { vendor: "codex" } }),
        "utf-8",
      );

      const config = await loadConfig(henchDir);
      config.useRegistryProvider = false;
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      await expect(
        agentLoop({ config, store, projectDir, henchDir }),
      ).rejects.toThrow("Hench API mode requires llm.vendor=claude");
    });

    it("registry path rejects non-Claude vendor with capability error", async () => {
      const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../src/store/config.js");

      // Write .n-dx.json with codex vendor
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({ llm: { vendor: "codex" } }),
        "utf-8",
      );

      const config = await loadConfig(henchDir);
      config.useRegistryProvider = true;
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      await expect(
        agentLoop({ config, store, projectDir, henchDir }),
      ).rejects.toThrow("Hench API loop requires a Claude-compatible provider");
    });
  });

  // ── Config flag defaults ───────────────────────────────────────────────────

  describe("config flag behavior", () => {
    it("useRegistryProvider defaults to undefined (falsy)", async () => {
      const { loadConfig } = await import("../../src/store/config.js");
      const config = await loadConfig(henchDir);

      expect(config.useRegistryProvider).toBeUndefined();
    });

    it("useRegistryProvider validates as optional boolean", async () => {
      const { HenchConfigSchema } = await import("../../src/schema/validate.js");

      const validTrue = HenchConfigSchema.safeParse({
        ...baseConfig(),
        useRegistryProvider: true,
      });
      expect(validTrue.success).toBe(true);

      const validFalse = HenchConfigSchema.safeParse({
        ...baseConfig(),
        useRegistryProvider: false,
      });
      expect(validFalse.success).toBe(true);

      const validOmitted = HenchConfigSchema.safeParse(baseConfig());
      expect(validOmitted.success).toBe(true);

      const invalidString = HenchConfigSchema.safeParse({
        ...baseConfig(),
        useRegistryProvider: "yes",
      });
      expect(invalidString.success).toBe(false);
    });
  });
});

/** Minimal valid HenchConfig for schema validation tests. */
function baseConfig() {
  return {
    schema: "hench/v1",
    provider: "cli",
    model: "sonnet",
    maxTurns: 50,
    maxTokens: 8192,
    tokenBudget: 0,
    rexDir: ".rex",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    guard: {
      blockedPaths: [".hench/**", ".rex/**", ".git/**", "node_modules/**"],
      allowedCommands: ["npm", "npx", "node", "git", "tsc", "vitest"],
      commandTimeout: 30000,
      maxFileSize: 1048576,
    },
    retry: {
      maxRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 30000,
    },
    loopPauseMs: 2000,
    maxFailedAttempts: 3,
  };
}
