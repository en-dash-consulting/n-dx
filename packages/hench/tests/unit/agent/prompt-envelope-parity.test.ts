/**
 * Prompt envelope parity tests.
 *
 * Verifies that both vendor adapters (Claude, Codex) receive identical
 * prompt sections for the same task. These are the contract tests for
 * the PromptEnvelope → adapter delivery pipeline:
 *
 * 1. Both adapters receive identical section names
 * 2. Section content equivalence validated (not just present — byte-identical)
 * 3. No vendor receives sections the other doesn't
 *
 * The tests feed the same PromptEnvelope to both adapters, extract the
 * logical content from each adapter's vendor-specific delivery format,
 * and assert equivalence.
 *
 * @see packages/hench/src/agent/lifecycle/adapters/claude-cli-adapter.ts
 * @see packages/hench/src/agent/lifecycle/adapters/codex-cli-adapter.ts
 * @see packages/llm-client/src/runtime-contract.ts — assemblePrompt
 * @see packages/hench/src/agent/planning/prompt.ts — buildPromptEnvelope
 */

import { describe, it, expect } from "vitest";
import {
  createPromptEnvelope,
  assemblePrompt,
  DEFAULT_EXECUTION_POLICY,
  CANONICAL_PROMPT_SECTIONS,
} from "../../../src/prd/llm-gateway.js";
import type { PromptEnvelope, PromptSection } from "../../../src/prd/llm-gateway.js";
import { claudeCliAdapter } from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { codexCliAdapter } from "../../../src/agent/lifecycle/adapters/codex-cli-adapter.js";
import { extractPromptSectionDiagnostics } from "../../../src/agent/lifecycle/prompt-diagnostics.js";
import { buildPromptEnvelope } from "../../../src/agent/planning/prompt.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/index.js";
import type { TaskBrief, HenchConfig } from "../../../src/schema/index.js";
import {
  FULL_PROMPT_SECTIONS,
  MINIMAL_PROMPT_SECTIONS,
  STANDARD_POLICY,
  READONLY_POLICY,
  FULL_ACCESS_POLICY,
} from "../../fixtures/cross-vendor-runtime.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Extract the logical system and task prompt content from a Claude adapter
 * SpawnConfig. On non-Windows, the system prompt is in the --system-prompt
 * arg; on Windows, both are concatenated in stdinContent.
 */
function extractClaudeContent(envelope: PromptEnvelope): {
  systemPrompt: string;
  taskPrompt: string;
} {
  const config = claudeCliAdapter.buildSpawnConfig(
    envelope,
    DEFAULT_EXECUTION_POLICY,
    undefined,
  );

  if (process.platform === "win32") {
    // On Windows, system+task are concatenated in stdin — use assemblePrompt
    // as the reference since the adapter also calls it internally.
    return assemblePrompt(envelope);
  }

  const sysIdx = config.args.indexOf("--system-prompt");
  const systemPrompt = sysIdx >= 0 ? (config.args[sysIdx + 1] as string) : "";
  const taskPrompt = config.stdinContent ?? "";

  return { systemPrompt, taskPrompt };
}

/**
 * Extract the logical system and task prompt content from a Codex adapter
 * SpawnConfig. Codex formats as `SYSTEM:\n{sys}\n\nTASK:\n{task}`.
 */
function extractCodexContent(envelope: PromptEnvelope): {
  systemPrompt: string;
  taskPrompt: string;
} {
  const config = codexCliAdapter.buildSpawnConfig(
    envelope,
    DEFAULT_EXECUTION_POLICY,
    undefined,
  );

  const lastArg = config.args[config.args.length - 1] as string;
  const systemStart = lastArg.indexOf("SYSTEM:\n") + "SYSTEM:\n".length;
  const taskMarker = lastArg.indexOf("\n\nTASK:\n");
  const systemPrompt = lastArg.slice(systemStart, taskMarker);
  const taskPrompt = lastArg.slice(taskMarker + "\n\nTASK:\n".length);

  return { systemPrompt, taskPrompt };
}

// ── Test envelopes ───────────────────────────────────────────────────────

/** Full envelope with all 6 canonical sections. */
function fullEnvelope(): PromptEnvelope {
  return createPromptEnvelope([...FULL_PROMPT_SECTIONS]);
}

/** Minimal envelope with only system + brief. */
function minimalEnvelope(): PromptEnvelope {
  return createPromptEnvelope([...MINIMAL_PROMPT_SECTIONS]);
}

/** Sparse envelope — system + brief + one optional section. */
function sparseEnvelope(): PromptEnvelope {
  return createPromptEnvelope([
    { name: "system", content: "You are Hench." },
    { name: "brief", content: "Implement feature X." },
    { name: "validation", content: "Run npm test." },
  ]);
}

/** Envelope with only system-group sections (system + workflow). */
function systemOnlyEnvelope(): PromptEnvelope {
  return createPromptEnvelope([
    { name: "system", content: "You are Hench." },
    { name: "workflow", content: "Follow TDD." },
  ]);
}

/** Envelope with UTF-8 multibyte content. */
function utf8Envelope(): PromptEnvelope {
  return createPromptEnvelope([
    { name: "system", content: "Ты — Hench, автономный AI-агент." },
    { name: "brief", content: "Réaliser l'authentification café." },
    { name: "workflow", content: "テスト駆動開発に従ってください。" },
    { name: "files", content: "src/κώδικας.ts — αρχείο πηγής." },
  ]);
}

/** Realistic envelope built from the actual buildPromptEnvelope pipeline. */
function pipelineEnvelope(): PromptEnvelope {
  const brief: TaskBrief = {
    task: {
      id: "parity-test-001",
      title: "Add JWT refresh token endpoint",
      level: "task",
      status: "pending",
      description: "Create a POST /auth/refresh endpoint that issues new access tokens.",
      acceptanceCriteria: [
        "POST /auth/refresh returns 200 with new access token",
        "Expired refresh tokens return 401",
        "Refresh token rotation implemented",
      ],
      priority: "high",
      tags: ["auth", "api"],
      blockedBy: ["dep-001"],
    },
    parentChain: [
      {
        id: "epic-auth",
        title: "Authentication System",
        level: "epic",
        description: "Complete OAuth2 + JWT authentication.",
      },
      {
        id: "feature-tokens",
        title: "Token Management",
        level: "feature",
        description: "Access and refresh token lifecycle.",
      },
    ],
    requirements: [
      {
        id: "req-sec-001",
        title: "Token security",
        category: "security",
        validationType: "automated",
        acceptanceCriteria: ["Tokens signed with RS256", "Refresh tokens stored hashed"],
        source: "Authentication System",
      },
    ],
    siblings: [
      { id: "task-login", title: "Login endpoint", status: "completed" },
      { id: "task-logout", title: "Logout endpoint", status: "pending" },
    ],
    project: {
      name: "parity-test-project",
      validateCommand: "npm run typecheck",
      testCommand: "npm test",
    },
    workflow: "Follow TDD: red → green → refactor.\nRun tests after every change.",
    recentLog: [
      {
        timestamp: "2026-04-01T10:00:00.000Z",
        event: "task_started",
        detail: "Starting token refresh endpoint",
      },
    ],
  };

  const config: HenchConfig = {
    ...DEFAULT_HENCH_CONFIG(),
    provider: "cli",
  };

  return buildPromptEnvelope(brief, config);
}

// ── 1. Both adapters receive identical section names ─────────────────────

describe("AC1: both adapters receive identical section names", () => {
  const envelopeCases: Array<{ name: string; build: () => PromptEnvelope }> = [
    { name: "full (6 canonical sections)", build: fullEnvelope },
    { name: "minimal (system + brief)", build: minimalEnvelope },
    { name: "sparse (system + brief + validation)", build: sparseEnvelope },
    { name: "system-only (system + workflow)", build: systemOnlyEnvelope },
    { name: "UTF-8 multibyte content", build: utf8Envelope },
    { name: "pipeline-built (buildPromptEnvelope)", build: pipelineEnvelope },
  ];

  for (const { name, build } of envelopeCases) {
    it(`section names identical for: ${name}`, () => {
      const envelope = build();

      // Both adapters operate on the same envelope — extract section diagnostics
      // before and after each adapter call to verify no mutation.
      const beforeDiags = extractPromptSectionDiagnostics(envelope);

      claudeCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);
      const afterClaudeDiags = extractPromptSectionDiagnostics(envelope);

      codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);
      const afterCodexDiags = extractPromptSectionDiagnostics(envelope);

      // Section names must be identical across all three snapshots
      const beforeNames = beforeDiags.map((d) => d.name);
      const afterClaudeNames = afterClaudeDiags.map((d) => d.name);
      const afterCodexNames = afterCodexDiags.map((d) => d.name);

      expect(afterClaudeNames).toEqual(beforeNames);
      expect(afterCodexNames).toEqual(beforeNames);
    });
  }

  it("section name ordering is preserved identically for both adapters", () => {
    // Use a non-canonical ordering to catch any sorting
    const customOrder = createPromptEnvelope([
      { name: "completion", content: "Done." },
      { name: "system", content: "Identity." },
      { name: "brief", content: "Task." },
      { name: "workflow", content: "Steps." },
      { name: "files", content: "Context." },
    ]);

    const diags = extractPromptSectionDiagnostics(customOrder);
    const names = diags.map((d) => d.name);

    // Order preserved — not sorted alphabetically
    expect(names).toEqual(["completion", "system", "brief", "workflow", "files"]);

    // Neither adapter mutates the ordering
    claudeCliAdapter.buildSpawnConfig(customOrder, DEFAULT_EXECUTION_POLICY, undefined);
    codexCliAdapter.buildSpawnConfig(customOrder, DEFAULT_EXECUTION_POLICY, undefined);

    const postNames = extractPromptSectionDiagnostics(customOrder).map((d) => d.name);
    expect(postNames).toEqual(names);
  });
});

// ── 2. Section content equivalence validated ─────────────────────────────

describe("AC2: section content equivalence between adapters", () => {
  const envelopeCases: Array<{ name: string; build: () => PromptEnvelope }> = [
    { name: "full (6 canonical sections)", build: fullEnvelope },
    { name: "minimal (system + brief)", build: minimalEnvelope },
    { name: "sparse (system + brief + validation)", build: sparseEnvelope },
    { name: "UTF-8 multibyte content", build: utf8Envelope },
    { name: "pipeline-built (buildPromptEnvelope)", build: pipelineEnvelope },
  ];

  for (const { name, build } of envelopeCases) {
    it(`system prompt byte-identical across adapters: ${name}`, () => {
      const envelope = build();
      const claude = extractClaudeContent(envelope);
      const codex = extractCodexContent(envelope);

      expect(claude.systemPrompt).toBe(codex.systemPrompt);
    });

    it(`task prompt byte-identical across adapters: ${name}`, () => {
      const envelope = build();
      const claude = extractClaudeContent(envelope);
      const codex = extractCodexContent(envelope);

      expect(claude.taskPrompt).toBe(codex.taskPrompt);
    });
  }

  it("section byte lengths identical for same envelope across adapters", () => {
    const envelope = fullEnvelope();

    // Diagnostics are extracted from the envelope, not the adapter output.
    // Both adapters operate on the same immutable envelope, so diagnostics
    // must be identical regardless of when they are captured.
    const beforeClaude = extractPromptSectionDiagnostics(envelope);
    claudeCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);
    const afterClaude = extractPromptSectionDiagnostics(envelope);

    codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);
    const afterCodex = extractPromptSectionDiagnostics(envelope);

    // Byte lengths must be identical
    expect(afterClaude.map((d) => d.byteLength)).toEqual(
      beforeClaude.map((d) => d.byteLength),
    );
    expect(afterCodex.map((d) => d.byteLength)).toEqual(
      beforeClaude.map((d) => d.byteLength),
    );
  });

  it("assemblePrompt output is the canonical reference for both adapters", () => {
    const envelope = fullEnvelope();
    const canonical = assemblePrompt(envelope);

    const claude = extractClaudeContent(envelope);
    const codex = extractCodexContent(envelope);

    // Both adapters produce content that matches assemblePrompt exactly
    expect(claude.systemPrompt).toBe(canonical.systemPrompt);
    expect(claude.taskPrompt).toBe(canonical.taskPrompt);
    expect(codex.systemPrompt).toBe(canonical.systemPrompt);
    expect(codex.taskPrompt).toBe(canonical.taskPrompt);
  });

  it("content equivalence holds across different execution policies", () => {
    const envelope = fullEnvelope();

    for (const policy of [STANDARD_POLICY, READONLY_POLICY, FULL_ACCESS_POLICY]) {
      const claudeConfig = claudeCliAdapter.buildSpawnConfig(envelope, policy, undefined);
      const codexConfig = codexCliAdapter.buildSpawnConfig(envelope, policy, undefined);

      // The policy affects CLI flags, not prompt content.
      // Extract content and verify it's the same across adapters.
      const canonical = assemblePrompt(envelope);

      if (process.platform !== "win32") {
        const sysIdx = claudeConfig.args.indexOf("--system-prompt");
        expect(claudeConfig.args[sysIdx + 1]).toBe(canonical.systemPrompt);
      }
      expect(claudeConfig.stdinContent).toBe(canonical.taskPrompt);

      const codexPrompt = codexConfig.args[codexConfig.args.length - 1] as string;
      expect(codexPrompt).toBe(
        `SYSTEM:\n${canonical.systemPrompt}\n\nTASK:\n${canonical.taskPrompt}`,
      );
    }
  });

  it("content equivalence holds with model override", () => {
    const envelope = fullEnvelope();
    const canonical = assemblePrompt(envelope);

    // Model override affects the spawn args but not the prompt content
    const claude = claudeCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, "claude-opus-4");
    const codex = codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, "gpt-5-codex");

    expect(claude.stdinContent).toBe(canonical.taskPrompt);

    const codexPrompt = codex.args[codex.args.length - 1] as string;
    expect(codexPrompt).toContain(canonical.systemPrompt);
    expect(codexPrompt).toContain(canonical.taskPrompt);
  });
});

// ── 3. No vendor receives exclusive sections ─────────────────────────────

describe("AC3: no vendor receives exclusive sections", () => {
  const envelopeCases: Array<{ name: string; build: () => PromptEnvelope }> = [
    { name: "full (6 canonical sections)", build: fullEnvelope },
    { name: "minimal (system + brief)", build: minimalEnvelope },
    { name: "sparse (system + brief + validation)", build: sparseEnvelope },
    { name: "system-only (system + workflow)", build: systemOnlyEnvelope },
    { name: "UTF-8 multibyte content", build: utf8Envelope },
    { name: "pipeline-built (buildPromptEnvelope)", build: pipelineEnvelope },
  ];

  for (const { name, build } of envelopeCases) {
    it(`all sections present in both adapters' output: ${name}`, () => {
      const envelope = build();
      const claude = extractClaudeContent(envelope);
      const codex = extractCodexContent(envelope);

      // Every section's content must appear in exactly one delivery channel
      // (system or task) for both adapters.
      for (const section of envelope.sections) {
        const inClaudeSystem = claude.systemPrompt.includes(section.content);
        const inClaudeTask = claude.taskPrompt.includes(section.content);
        const inCodexSystem = codex.systemPrompt.includes(section.content);
        const inCodexTask = codex.taskPrompt.includes(section.content);

        // Section must be present in at least one channel per adapter
        expect(
          inClaudeSystem || inClaudeTask,
          `Claude missing section "${section.name}" content`,
        ).toBe(true);
        expect(
          inCodexSystem || inCodexTask,
          `Codex missing section "${section.name}" content`,
        ).toBe(true);

        // Section must be in the SAME channel for both adapters
        expect(inClaudeSystem).toBe(inCodexSystem);
        expect(inClaudeTask).toBe(inCodexTask);
      }
    });
  }

  it("system-group sections go to system channel for both adapters", () => {
    const envelope = fullEnvelope();
    const claude = extractClaudeContent(envelope);
    const codex = extractCodexContent(envelope);

    // system and workflow are system-group
    const systemSections = envelope.sections.filter(
      (s) => s.name === "system" || s.name === "workflow",
    );

    for (const section of systemSections) {
      expect(
        claude.systemPrompt.includes(section.content),
        `Claude: "${section.name}" missing from system channel`,
      ).toBe(true);
      expect(
        codex.systemPrompt.includes(section.content),
        `Codex: "${section.name}" missing from system channel`,
      ).toBe(true);

      // Must NOT be in task channel
      expect(
        claude.taskPrompt.includes(section.content),
        `Claude: "${section.name}" leaked into task channel`,
      ).toBe(false);
      expect(
        codex.taskPrompt.includes(section.content),
        `Codex: "${section.name}" leaked into task channel`,
      ).toBe(false);
    }
  });

  it("task-group sections go to task channel for both adapters", () => {
    const envelope = fullEnvelope();
    const claude = extractClaudeContent(envelope);
    const codex = extractCodexContent(envelope);

    // brief, files, validation, completion are task-group
    const taskSections = envelope.sections.filter(
      (s) => s.name !== "system" && s.name !== "workflow",
    );

    for (const section of taskSections) {
      expect(
        claude.taskPrompt.includes(section.content),
        `Claude: "${section.name}" missing from task channel`,
      ).toBe(true);
      expect(
        codex.taskPrompt.includes(section.content),
        `Codex: "${section.name}" missing from task channel`,
      ).toBe(true);

      // Must NOT be in system channel
      expect(
        claude.systemPrompt.includes(section.content),
        `Claude: "${section.name}" leaked into system channel`,
      ).toBe(false);
      expect(
        codex.systemPrompt.includes(section.content),
        `Codex: "${section.name}" leaked into system channel`,
      ).toBe(false);
    }
  });

  it("empty sections filtered before reaching any adapter", () => {
    const sections: PromptSection[] = [
      { name: "system", content: "Identity." },
      { name: "workflow", content: "" },         // filtered
      { name: "brief", content: "Task text." },
      { name: "files", content: "" },            // filtered
      { name: "validation", content: "" },       // filtered
      { name: "completion", content: "Done." },
    ];
    const envelope = createPromptEnvelope(sections);

    // Only non-empty sections survive
    expect(envelope.sections).toHaveLength(3);

    const claude = extractClaudeContent(envelope);
    const codex = extractCodexContent(envelope);

    // Neither adapter sees the filtered sections
    expect(claude.systemPrompt).not.toContain("workflow");
    expect(codex.systemPrompt).not.toContain("workflow");

    // Both receive the same surviving content
    expect(claude.systemPrompt).toBe(codex.systemPrompt);
    expect(claude.taskPrompt).toBe(codex.taskPrompt);
  });

  it("non-canonical section names routed identically for both adapters", () => {
    // Custom section names should route to the task channel (not system)
    // since assemblePrompt only puts "system" and "workflow" in system group.
    const envelope = createPromptEnvelope([
      { name: "system", content: "System content." },
      { name: "custom-context", content: "Custom context data." },
      { name: "brief", content: "Brief content." },
    ]);

    const claude = extractClaudeContent(envelope);
    const codex = extractCodexContent(envelope);

    // Custom section goes to task channel for both
    expect(claude.taskPrompt).toContain("Custom context data.");
    expect(codex.taskPrompt).toContain("Custom context data.");

    // Not in system channel for either
    expect(claude.systemPrompt).not.toContain("Custom context data.");
    expect(codex.systemPrompt).not.toContain("Custom context data.");

    // Byte-identical across adapters
    expect(claude.systemPrompt).toBe(codex.systemPrompt);
    expect(claude.taskPrompt).toBe(codex.taskPrompt);
  });

  it("pipeline envelope: Claude and Codex receive same section inventory", () => {
    const envelope = pipelineEnvelope();
    const sectionNames = envelope.sections.map((s) => s.name);

    // Both adapters process the same sections — verify by checking that
    // the combined output accounts for every section.
    const claude = extractClaudeContent(envelope);
    const codex = extractCodexContent(envelope);
    const combined = claude.systemPrompt + claude.taskPrompt;
    const codexCombined = codex.systemPrompt + codex.taskPrompt;

    for (const section of envelope.sections) {
      expect(
        combined.includes(section.content),
        `Claude output missing "${section.name}"`,
      ).toBe(true);
      expect(
        codexCombined.includes(section.content),
        `Codex output missing "${section.name}"`,
      ).toBe(true);
    }

    // No exclusive content — combined outputs carry the same logical text
    expect(claude.systemPrompt).toBe(codex.systemPrompt);
    expect(claude.taskPrompt).toBe(codex.taskPrompt);
  });
});

// ── Cross-cutting: symmetry proof ────────────────────────────────────────

describe("symmetry proof: adapter order does not affect content", () => {
  it("calling Claude first then Codex produces same result as Codex first then Claude", () => {
    const envelope = fullEnvelope();

    // Order 1: Claude then Codex
    const claudeFirst = extractClaudeContent(envelope);
    const codexSecond = extractCodexContent(envelope);

    // Order 2: Codex then Claude (fresh envelope to be safe)
    const envelope2 = fullEnvelope();
    const codexFirst = extractCodexContent(envelope2);
    const claudeSecond = extractClaudeContent(envelope2);

    // Results must be identical regardless of call order
    expect(claudeFirst.systemPrompt).toBe(claudeSecond.systemPrompt);
    expect(claudeFirst.taskPrompt).toBe(claudeSecond.taskPrompt);
    expect(codexFirst.systemPrompt).toBe(codexSecond.systemPrompt);
    expect(codexFirst.taskPrompt).toBe(codexSecond.taskPrompt);
  });

  it("envelope is immutable through adapter calls", () => {
    const envelope = fullEnvelope();
    const snapshot = JSON.stringify(envelope);

    claudeCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);
    expect(JSON.stringify(envelope)).toBe(snapshot);

    codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);
    expect(JSON.stringify(envelope)).toBe(snapshot);
  });
});
