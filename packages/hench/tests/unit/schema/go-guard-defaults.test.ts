import { describe, it, expect } from "vitest";
import {
  guardDefaultsForLanguage,
  DEFAULT_HENCH_CONFIG,
  HENCH_SCHEMA_VERSION,
} from "../../../src/schema/v1.js";
import type { ProjectLanguage } from "../../../src/schema/v1.js";

// ---------------------------------------------------------------------------
// guardDefaultsForLanguage
// ---------------------------------------------------------------------------

describe("guardDefaultsForLanguage", () => {
  describe("Go defaults", () => {
    it("includes vendor/** in blocked paths", () => {
      const guard = guardDefaultsForLanguage("go");
      expect(guard.blockedPaths).toContain("vendor/**");
    });

    it("does not include node_modules/** in blocked paths", () => {
      const guard = guardDefaultsForLanguage("go");
      expect(guard.blockedPaths).not.toContain("node_modules/**");
    });

    it("blocks .hench/**, .rex/**, and .git/**", () => {
      const guard = guardDefaultsForLanguage("go");
      expect(guard.blockedPaths).toContain(".hench/**");
      expect(guard.blockedPaths).toContain(".rex/**");
      expect(guard.blockedPaths).toContain(".git/**");
    });

    it("includes go in allowed commands", () => {
      const guard = guardDefaultsForLanguage("go");
      expect(guard.allowedCommands).toContain("go");
    });

    it("includes make in allowed commands", () => {
      const guard = guardDefaultsForLanguage("go");
      expect(guard.allowedCommands).toContain("make");
    });

    it("includes git in allowed commands", () => {
      const guard = guardDefaultsForLanguage("go");
      expect(guard.allowedCommands).toContain("git");
    });

    it("includes golangci-lint in allowed commands", () => {
      const guard = guardDefaultsForLanguage("go");
      expect(guard.allowedCommands).toContain("golangci-lint");
    });

    it("does not include JS/TS-specific commands", () => {
      const guard = guardDefaultsForLanguage("go");
      expect(guard.allowedCommands).not.toContain("npm");
      expect(guard.allowedCommands).not.toContain("npx");
      expect(guard.allowedCommands).not.toContain("node");
      expect(guard.allowedCommands).not.toContain("tsc");
      expect(guard.allowedCommands).not.toContain("vitest");
    });

    it("includes standard git subcommands", () => {
      const guard = guardDefaultsForLanguage("go");
      expect(guard.allowedGitSubcommands).toContain("status");
      expect(guard.allowedGitSubcommands).toContain("add");
      expect(guard.allowedGitSubcommands).toContain("commit");
      expect(guard.allowedGitSubcommands).toContain("diff");
      expect(guard.allowedGitSubcommands).toContain("log");
    });

    it("returns a fresh object each call (not the same reference)", () => {
      const a = guardDefaultsForLanguage("go");
      const b = guardDefaultsForLanguage("go");
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe("JS/TS defaults (regression guard)", () => {
    it("includes node_modules/** in blocked paths", () => {
      const guard = guardDefaultsForLanguage();
      expect(guard.blockedPaths).toContain("node_modules/**");
    });

    it("does not include vendor/** in blocked paths", () => {
      const guard = guardDefaultsForLanguage();
      expect(guard.blockedPaths).not.toContain("vendor/**");
    });

    it("blocks .hench/**, .rex/**, and .git/**", () => {
      const guard = guardDefaultsForLanguage();
      expect(guard.blockedPaths).toContain(".hench/**");
      expect(guard.blockedPaths).toContain(".rex/**");
      expect(guard.blockedPaths).toContain(".git/**");
    });

    it("includes JS/TS toolchain commands", () => {
      const guard = guardDefaultsForLanguage();
      expect(guard.allowedCommands).toContain("npm");
      expect(guard.allowedCommands).toContain("npx");
      expect(guard.allowedCommands).toContain("node");
      expect(guard.allowedCommands).toContain("git");
      expect(guard.allowedCommands).toContain("tsc");
      expect(guard.allowedCommands).toContain("vitest");
    });

    it("does not include Go-specific commands", () => {
      const guard = guardDefaultsForLanguage();
      expect(guard.allowedCommands).not.toContain("go");
      expect(guard.allowedCommands).not.toContain("make");
      expect(guard.allowedCommands).not.toContain("golangci-lint");
    });

    it("returns JS/TS defaults for typescript language", () => {
      const guard = guardDefaultsForLanguage("typescript");
      expect(guard.allowedCommands).toContain("npm");
      expect(guard.blockedPaths).toContain("node_modules/**");
    });

    it("returns JS/TS defaults for javascript language", () => {
      const guard = guardDefaultsForLanguage("javascript");
      expect(guard.allowedCommands).toContain("npm");
      expect(guard.blockedPaths).toContain("node_modules/**");
    });

    it("returns a fresh object each call (not the same reference)", () => {
      const a = guardDefaultsForLanguage();
      const b = guardDefaultsForLanguage();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_HENCH_CONFIG with language
// ---------------------------------------------------------------------------

describe("DEFAULT_HENCH_CONFIG", () => {
  describe("Go language", () => {
    it("sets language to go", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      expect(config.language).toBe("go");
    });

    it("uses Go guard defaults", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      expect(config.guard.allowedCommands).toContain("go");
      expect(config.guard.allowedCommands).toContain("golangci-lint");
      expect(config.guard.blockedPaths).toContain("vendor/**");
    });

    it("preserves non-guard defaults", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      expect(config.schema).toBe(HENCH_SCHEMA_VERSION);
      expect(config.provider).toBe("cli");
      expect(config.maxTurns).toBe(50);
    });
  });

  describe("no language (JS/TS default, regression guard)", () => {
    it("does not set language property", () => {
      const config = DEFAULT_HENCH_CONFIG();
      expect(config.language).toBeUndefined();
    });

    it("uses JS/TS guard defaults", () => {
      const config = DEFAULT_HENCH_CONFIG();
      expect(config.guard.allowedCommands).toContain("npm");
      expect(config.guard.allowedCommands).toContain("vitest");
      expect(config.guard.blockedPaths).toContain("node_modules/**");
      expect(config.guard.blockedPaths).not.toContain("vendor/**");
    });

    it("preserves all non-guard defaults", () => {
      const config = DEFAULT_HENCH_CONFIG();
      expect(config.schema).toBe(HENCH_SCHEMA_VERSION);
      expect(config.provider).toBe("cli");
      expect(config.model).toBe("sonnet");
      expect(config.maxTurns).toBe(50);
      expect(config.maxTokens).toBe(8192);
      expect(config.tokenBudget).toBe(0);
      expect(config.retry.maxRetries).toBe(3);
    });
  });
});
