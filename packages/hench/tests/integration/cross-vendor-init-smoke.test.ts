/**
 * Cross-vendor init-to-run smoke test.
 *
 * Validates that a fresh project can be initialized and that Codex is a
 * first-class execution surface by verifying:
 *
 *   1. `hench init` creates a valid config for both Claude and Codex
 *   2. Both vendor configs share the same schema, guard, and retry defaults
 *   3. The system prompt produced for each vendor contains the same identity,
 *      rules, and project info sections
 *   4. Codex policy flags compile correctly from the default config
 *   5. Token parsing handles both vendor response formats
 *   6. Error classification produces consistent results for both vendors
 *
 * This is a "cold start" test — it creates a fresh temp directory, runs
 * init, and verifies the contract without mocking. It does NOT spawn a
 * real Claude or Codex process (that would require credentials).
 *
 * @see packages/hench/tests/e2e/cli-init.test.ts — basic init coverage
 * @see docs/analysis/claude-codex-runtime-identity-discovery.md — contract spec
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import { HenchConfigSchema } from "../../src/schema/validate.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/v1.js";
import type { HenchConfig } from "../../src/schema/v1.js";
import { buildSystemPrompt } from "../../src/agent/planning/prompt.js";
import type { TaskBriefProject } from "../../src/schema/v1.js";
import {
  DEFAULT_EXECUTION_POLICY,
  CANONICAL_PROMPT_SECTIONS,
  classifyVendorError,
  createPromptEnvelope,
  assemblePrompt,
} from "../../src/prd/llm-gateway.js";
import {
  compileCodexPolicyFlags,
} from "../../src/prd/llm-gateway.js";
import {
  parseApiTokenUsageWithDiagnostic,
  parseStreamTokenUsageWithDiagnostic,
  mapCodexUsageToTokenUsage,
} from "../../src/prd/llm-gateway.js";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");

// ── Fresh project setup ───────────────────────────────────────────────────

describe("cross-vendor init-to-run smoke", () => {
  let projectDir: string;
  let henchConfig: HenchConfig;

  const project: TaskBriefProject = {
    name: "smoke-test-project",
    validateCommand: "npm run build",
    testCommand: "npm test",
  };

  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "ndx-cross-vendor-smoke-"));
    execSync(`node ${CLI_PATH} init ${projectDir}`, { encoding: "utf-8" });

    const raw = await readFile(join(projectDir, ".hench", "config.json"), "utf-8");
    henchConfig = JSON.parse(raw);
  });

  afterAll(async () => {
    if (projectDir) {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  // ── 1. Config validation ──────────────────────────────────────────────

  describe("fresh project config", () => {
    it("creates a valid hench config", () => {
      const result = HenchConfigSchema.safeParse(henchConfig);
      expect(result.success).toBe(true);
    });

    it("config matches DEFAULT_HENCH_CONFIG defaults", () => {
      expect(henchConfig).toEqual(DEFAULT_HENCH_CONFIG());
    });

    it("config is vendor-neutral (provider: cli works for both Claude and Codex)", () => {
      // The default config uses provider: "cli" which means either
      // `claude` or `codex` binary depending on llm.vendor setting.
      expect(henchConfig.provider).toBe("cli");
    });

    it("guard config applies identically to both vendors", () => {
      expect(henchConfig.guard).toBeDefined();
      expect(henchConfig.guard.blockedPaths).toContain(".hench/**");
      expect(henchConfig.guard.blockedPaths).toContain(".rex/**");
      expect(henchConfig.guard.blockedPaths).toContain(".git/**");
      expect(henchConfig.guard.allowedCommands.length).toBeGreaterThan(0);
      expect(henchConfig.guard.commandTimeout).toBeGreaterThan(0);
    });

    it("retry config applies identically to both vendors", () => {
      expect(henchConfig.retry).toBeDefined();
      expect(henchConfig.retry.maxRetries).toBeGreaterThanOrEqual(0);
      expect(henchConfig.retry.baseDelayMs).toBeGreaterThan(0);
      expect(henchConfig.retry.maxDelayMs).toBeGreaterThan(0);
    });
  });

  // ── 2. System prompt parity ───────────────────────────────────────────

  describe("system prompt parity", () => {
    it("CLI prompt includes vendor-neutral identity", () => {
      const cliConfig = { ...DEFAULT_HENCH_CONFIG(), provider: "cli" as const };
      const prompt = buildSystemPrompt(project, cliConfig);

      expect(prompt).toContain("Hench");
      expect(prompt).toContain("autonomous AI agent");
      expect(prompt).toContain("smoke-test-project");
    });

    it("API prompt includes vendor-neutral identity", () => {
      const apiConfig = { ...DEFAULT_HENCH_CONFIG(), provider: "api" as const };
      const prompt = buildSystemPrompt(project, apiConfig);

      expect(prompt).toContain("Hench");
      expect(prompt).toContain("autonomous AI agent");
      expect(prompt).toContain("smoke-test-project");
    });

    it("both providers include the same Rules section", () => {
      const cliPrompt = buildSystemPrompt(project, {
        ...DEFAULT_HENCH_CONFIG(),
        provider: "cli" as const,
      });
      const apiPrompt = buildSystemPrompt(project, {
        ...DEFAULT_HENCH_CONFIG(),
        provider: "api" as const,
      });

      // Core rules present in both
      expect(cliPrompt).toContain("Read existing code");
      expect(apiPrompt).toContain("Read existing code");
      expect(cliPrompt).toContain("minimal, focused changes");
      expect(apiPrompt).toContain("minimal, focused changes");
      expect(cliPrompt).toContain("Follow existing code patterns");
      expect(apiPrompt).toContain("Follow existing code patterns");
      expect(cliPrompt).toContain("Run tests after making changes");
      expect(apiPrompt).toContain("Run tests after making changes");
      expect(cliPrompt).toContain("Commit your work");
      expect(apiPrompt).toContain("Commit your work");
    });

    it("both providers include project commands", () => {
      const cliPrompt = buildSystemPrompt(project, {
        ...DEFAULT_HENCH_CONFIG(),
        provider: "cli" as const,
      });
      const apiPrompt = buildSystemPrompt(project, {
        ...DEFAULT_HENCH_CONFIG(),
        provider: "api" as const,
      });

      expect(cliPrompt).toContain("npm run build");
      expect(apiPrompt).toContain("npm run build");
      expect(cliPrompt).toContain("npm test");
      expect(apiPrompt).toContain("npm test");
    });

    it("both providers include Error Handling section", () => {
      const cliPrompt = buildSystemPrompt(project, {
        ...DEFAULT_HENCH_CONFIG(),
        provider: "cli" as const,
      });
      const apiPrompt = buildSystemPrompt(project, {
        ...DEFAULT_HENCH_CONFIG(),
        provider: "api" as const,
      });

      expect(cliPrompt).toContain("Error Handling");
      expect(apiPrompt).toContain("Error Handling");
      expect(cliPrompt).toContain("If tests fail");
      expect(apiPrompt).toContain("If tests fail");
    });
  });

  // ── 3. Prompt envelope round-trip ─────────────────────────────────────

  describe("prompt envelope round-trip", () => {
    it("canonical sections survive create → assemble round-trip", () => {
      const sections = CANONICAL_PROMPT_SECTIONS.map((name) => ({
        name,
        content: `Content for ${name}`,
      }));
      const envelope = createPromptEnvelope(sections);
      const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

      // System sections go to systemPrompt
      expect(systemPrompt).toContain("Content for system");
      expect(systemPrompt).toContain("Content for workflow");

      // Task sections go to taskPrompt
      expect(taskPrompt).toContain("Content for brief");
      expect(taskPrompt).toContain("Content for files");
      expect(taskPrompt).toContain("Content for validation");
      expect(taskPrompt).toContain("Content for completion");
    });
  });

  // ── 4. Codex policy compilation from default config ───────────────────

  describe("Codex policy compilation", () => {
    it("default execution policy compiles to valid Codex flags", () => {
      const flags = compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY);

      expect(flags).toContain("--sandbox");
      expect(flags).toContain("workspace-write");
      expect(flags).toContain("--approval-policy");
      expect(flags).toContain("full-auto");
      expect(flags).toHaveLength(4);
    });

    it("compiled flags do not include deprecated --full-auto standalone", () => {
      const flags = compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY);
      // --full-auto should only appear as the VALUE of --approval-policy
      const standaloneFlagIndex = flags.indexOf("--full-auto");
      expect(standaloneFlagIndex).toBe(-1);
    });
  });

  // ── 5. Token parsing cross-vendor ─────────────────────────────────────

  describe("token parsing cross-vendor", () => {
    const usage = { input_tokens: 1000, output_tokens: 250 };

    it("Claude API and Codex produce the same normalized usage", () => {
      const claudeResult = parseApiTokenUsageWithDiagnostic(usage);
      const codexResult = mapCodexUsageToTokenUsage({ usage });

      expect(claudeResult.usage.input).toBe(codexResult.usage.input);
      expect(claudeResult.usage.output).toBe(codexResult.usage.output);
    });

    it("Claude stream and Codex produce the same normalized usage", () => {
      const streamResult = parseStreamTokenUsageWithDiagnostic(usage);
      const codexResult = mapCodexUsageToTokenUsage({ usage });

      expect(streamResult.usage.input).toBe(codexResult.usage.input);
      expect(streamResult.usage.output).toBe(codexResult.usage.output);
    });

    it("missing usage produces unavailable diagnostic for both vendors", () => {
      const claudeResult = parseApiTokenUsageWithDiagnostic({});
      const codexResult = mapCodexUsageToTokenUsage({ status: "ok" });

      expect(claudeResult.diagnosticStatus).toBe("unavailable");
      expect(codexResult.diagnosticStatus).toBe("unavailable");
    });
  });

  // ── 6. Error classification cross-vendor ──────────────────────────────

  describe("error classification cross-vendor", () => {
    const vendorErrorPairs = [
      {
        name: "auth errors",
        claude: "Missing ANTHROPIC_API_KEY",
        codex: "Missing OPENAI_API_KEY",
        expected: "auth",
      },
      {
        name: "rate limit errors",
        claude: "rate limit exceeded",
        codex: "too many requests",
        expected: "rate_limit",
      },
      {
        name: "not found errors",
        claude: "claude: not found",
        codex: "codex: not found",
        expected: "not_found",
      },
      {
        name: "timeout errors",
        claude: "request timed out",
        codex: "codex exec timed out after 30000ms",
        expected: "timeout",
      },
    ] as const;

    for (const { name, claude, codex, expected } of vendorErrorPairs) {
      it(`${name} classify to the same category for both vendors`, () => {
        expect(classifyVendorError(new Error(claude))).toBe(expected);
        expect(classifyVendorError(new Error(codex))).toBe(expected);
      });
    }
  });
});
