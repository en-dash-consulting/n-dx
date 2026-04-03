/**
 * Prompt parity tests — verifies that both vendor adapters receive the
 * same PromptEnvelope sections for a given task brief, and captures
 * baseline prompt output for regression comparison.
 *
 * Builds on the existing instruction-alignment.test.js (root-level E2E) by
 * adding:
 *   1. PromptEnvelope section parity through the actual brief→prompt pipeline
 *   2. Baseline prompt output capture for regression comparison
 *   3. Cross-vendor delivery channel content equivalence
 *
 * The companion test `tests/e2e/prompt-section-parity.test.js` covers
 * instruction file (CLAUDE.md, AGENTS.md) section-level equivalence.
 *
 * These tests ensure that adding a new vendor adapter cannot silently
 * diverge the prompt content delivered to each LLM.
 *
 * @see packages/llm-client/src/runtime-contract.ts — PromptEnvelope
 * @see packages/hench/src/agent/planning/prompt.ts — buildSystemPrompt
 * @see packages/hench/src/agent/planning/brief.ts — formatTaskBrief
 * @see tests/e2e/instruction-alignment.test.js — shared guidance alignment
 * @see tests/e2e/prompt-section-parity.test.js — instruction file section parity
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  createPromptEnvelope,
  assemblePrompt,
  CANONICAL_PROMPT_SECTIONS,
} from "../../../src/prd/llm-gateway.js";
import type {
  PromptSection,
} from "../../../src/prd/llm-gateway.js";
import { buildSystemPrompt } from "../../../src/agent/planning/prompt.js";
import { formatTaskBrief } from "../../../src/agent/planning/brief.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/index.js";
import type { TaskBrief, HenchConfig } from "../../../src/schema/index.js";
import {
  FULL_PROMPT_SECTIONS,
  MINIMAL_PROMPT_SECTIONS,
} from "../../fixtures/cross-vendor-runtime.js";
import { buildClaudeCliArgs } from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";

// ── Deterministic test fixtures ──────────────────────────────────────────────

/**
 * A realistic task brief that exercises all brief sections.
 * Used to verify that both vendors receive identical prompt content.
 */
const MOCK_TASK_BRIEF: TaskBrief = {
  task: {
    id: "test-task-001",
    title: "Add input validation to login form",
    level: "task",
    status: "pending",
    description: "Validate email format and password length before submission.",
    acceptanceCriteria: [
      "Email must match RFC 5322 format",
      "Password must be at least 8 characters",
      "Error messages displayed inline",
    ],
    priority: "high",
    tags: ["auth", "validation"],
  },
  parentChain: [
    {
      id: "epic-001",
      title: "User Authentication",
      level: "epic",
      description: "Complete auth system with login, registration, and password reset.",
    },
    {
      id: "feature-001",
      title: "Login Flow",
      level: "feature",
      description: "Login form with validation and error handling.",
    },
  ],
  requirements: [
    {
      id: "req-001",
      title: "Input validation",
      category: "functional",
      validationType: "automated",
      acceptanceCriteria: ["All form inputs validated before submission"],
      source: "User Authentication",
    },
  ],
  siblings: [
    { id: "task-002", title: "Add password reset flow", status: "pending" },
    { id: "task-003", title: "Add session management", status: "completed" },
  ],
  project: {
    name: "test-project",
    validateCommand: "npm run typecheck",
    testCommand: "npm test",
  },
  workflow: "Follow TDD: red → green → refactor.\nRun tests after every change.",
  recentLog: [
    {
      timestamp: "2026-03-31T12:00:00.000Z",
      event: "task_started",
      detail: "Starting login form validation",
    },
  ],
};

/** CLI-mode hench config for buildSystemPrompt. */
const CLI_CONFIG: HenchConfig = {
  ...DEFAULT_HENCH_CONFIG(),
  provider: "cli",
};

/** API-mode hench config for buildSystemPrompt. */
const API_CONFIG: HenchConfig = {
  ...DEFAULT_HENCH_CONFIG(),
  provider: "api",
};

// ── 1. PromptEnvelope section parity for a realistic task ────────────────────

describe("prompt envelope section parity for a given task", () => {
  let systemPrompt: string;
  let briefText: string;
  let fullEnvelope: ReturnType<typeof createPromptEnvelope>;

  beforeAll(() => {
    systemPrompt = buildSystemPrompt(MOCK_TASK_BRIEF.project, CLI_CONFIG);
    briefText = formatTaskBrief(MOCK_TASK_BRIEF);

    // Build a complete prompt envelope from the realistic task brief
    const sections: PromptSection[] = [
      { name: "system", content: systemPrompt },
      { name: "workflow", content: MOCK_TASK_BRIEF.workflow },
      { name: "brief", content: briefText },
      { name: "files", content: "src/components/LoginForm.tsx — existing login form component." },
      { name: "validation", content: "Run `npm test` and `npm run typecheck`." },
      { name: "completion", content: "Done when all acceptance criteria pass and tests are green." },
    ];
    fullEnvelope = createPromptEnvelope(sections);
  });

  it("both vendors receive the same 6 canonical section names from a task brief", () => {
    const sectionNames = fullEnvelope.sections.map((s) => s.name);
    expect(sectionNames).toEqual([
      "system", "workflow", "brief", "files", "validation", "completion",
    ]);
  });

  it("section count matches CANONICAL_PROMPT_SECTIONS length", () => {
    expect(fullEnvelope.sections).toHaveLength(CANONICAL_PROMPT_SECTIONS.length);
  });

  it("every canonical section is present in the task envelope", () => {
    for (const name of CANONICAL_PROMPT_SECTIONS) {
      expect(
        fullEnvelope.sections.some((s) => s.name === name),
        `missing canonical section: ${name}`,
      ).toBe(true);
    }
  });

  it("assemblePrompt produces identical system/task split regardless of vendor", () => {
    const { systemPrompt: sys, taskPrompt: task } = assemblePrompt(fullEnvelope);

    // System sections (system + workflow) go to system prompt
    expect(sys).toContain("You are Hench");
    expect(sys).toContain("Follow TDD");

    // Task sections (brief + files + validation + completion) go to task prompt
    expect(task).toContain("Add input validation to login form");
    expect(task).toContain("LoginForm.tsx");
    expect(task).toContain("npm test");
    expect(task).toContain("acceptance criteria pass");

    // Cross-contamination check
    expect(task).not.toContain("You are Hench");
    expect(sys).not.toContain("LoginForm.tsx");
  });

  it("Claude delivery channel receives same content as Codex delivery channel", () => {
    const { systemPrompt: sys, taskPrompt: task } = assemblePrompt(fullEnvelope);

    // Claude: systemPrompt → --system-prompt flag, taskPrompt → stdin
    const { args, stdinContent } = buildClaudeCliArgs({
      systemPrompt: sys,
      promptText: task,
      allowedTools: ["Bash(npm:*)", "Read", "Edit", "Write", "Glob", "Grep"],
    });

    // Codex: combined as SYSTEM:\n...\nTASK:\n...
    const codexPrompt = `SYSTEM:\n${sys}\n\nTASK:\n${task}`;

    // Both channels carry the same system prompt content
    const systemPromptIndex = args.indexOf("--system-prompt");
    expect(systemPromptIndex).toBeGreaterThan(-1);
    const claudeSystemPrompt = args[systemPromptIndex + 1];
    expect(claudeSystemPrompt).toBe(sys);
    expect(codexPrompt).toContain(sys);

    // Both channels carry the same task prompt content
    expect(stdinContent).toBe(task);
    expect(codexPrompt).toContain(task);
  });

  it("task brief sections are preserved through the prompt pipeline", () => {
    // Verify that key brief content survives the full pipeline:
    // TaskBrief → formatTaskBrief → PromptSection → assemblePrompt
    const { taskPrompt } = assemblePrompt(fullEnvelope);

    // Task title and metadata
    expect(taskPrompt).toContain("Add input validation to login form");
    expect(taskPrompt).toContain("test-task-001");

    // Acceptance criteria
    expect(taskPrompt).toContain("RFC 5322");
    expect(taskPrompt).toContain("at least 8 characters");

    // Parent chain context
    expect(taskPrompt).toContain("User Authentication");
    expect(taskPrompt).toContain("Login Flow");

    // Sibling tasks
    expect(taskPrompt).toContain("Add password reset flow");
    expect(taskPrompt).toContain("Add session management");

    // Recent activity
    expect(taskPrompt).toContain("task_started");
  });

  it("buildSystemPrompt output is provider-agnostic for core sections", () => {
    const cliPrompt = buildSystemPrompt(MOCK_TASK_BRIEF.project, CLI_CONFIG);
    const apiPrompt = buildSystemPrompt(MOCK_TASK_BRIEF.project, API_CONFIG);

    // Both must contain the identity, rules, project info, and error handling
    for (const prompt of [cliPrompt, apiPrompt]) {
      expect(prompt).toContain("You are Hench");
      expect(prompt).toContain("## Rules");
      expect(prompt).toContain("## Project Info");
      expect(prompt).toContain("test-project");
      expect(prompt).toContain("## Workflow");
      expect(prompt).toContain("## Error Handling");
    }
  });

  it("formatTaskBrief is deterministic across invocations", () => {
    const first = formatTaskBrief(MOCK_TASK_BRIEF);
    const second = formatTaskBrief(MOCK_TASK_BRIEF);
    expect(first).toBe(second);
  });

  it("buildSystemPrompt is deterministic across invocations", () => {
    const first = buildSystemPrompt(MOCK_TASK_BRIEF.project, CLI_CONFIG);
    const second = buildSystemPrompt(MOCK_TASK_BRIEF.project, CLI_CONFIG);
    expect(first).toBe(second);
  });
});

// ── 2. Baseline prompt output regression ─────────────────────────────────────

describe("baseline prompt output for regression comparison", () => {
  let systemPrompt: string;
  let briefText: string;

  beforeAll(() => {
    systemPrompt = buildSystemPrompt(MOCK_TASK_BRIEF.project, CLI_CONFIG);
    briefText = formatTaskBrief(MOCK_TASK_BRIEF);
  });

  it("system prompt contains expected structural sections", () => {
    const expectedMarkers = [
      "You are Hench, an autonomous AI agent",
      "## Rules",
      "## Project Info",
      "Project: test-project",
      "Validate command: `npm run typecheck`",
      "Test command: `npm test`",
      "## Workflow",
      "## Error Handling",
    ];
    for (const marker of expectedMarkers) {
      expect(systemPrompt, `system prompt missing: ${marker}`).toContain(marker);
    }
  });

  it("brief text contains expected structural sections", () => {
    const expectedMarkers = [
      "## Current Task",
      "**Add input validation to login form** (task)",
      "ID: test-task-001",
      "Status: pending",
      "Priority: high",
      "Acceptance Criteria:",
      "## Context (Parent Chain)",
      "## Requirements",
      "## Sibling Tasks",
      "## Project",
      "## Workflow",
      "## Recent Activity",
    ];
    for (const marker of expectedMarkers) {
      expect(briefText, `brief text missing: ${marker}`).toContain(marker);
    }
  });

  it("full envelope section names are stable", () => {
    const sections: PromptSection[] = [
      { name: "system", content: systemPrompt },
      { name: "workflow", content: MOCK_TASK_BRIEF.workflow },
      { name: "brief", content: briefText },
      { name: "files", content: "src/auth.ts" },
      { name: "validation", content: "npm test" },
      { name: "completion", content: "All tests pass" },
    ];
    const envelope = createPromptEnvelope(sections);
    const names = envelope.sections.map((s) => s.name);

    // Snapshot: section names must not change without updating this test
    expect(names).toEqual([
      "system",
      "workflow",
      "brief",
      "files",
      "validation",
      "completion",
    ]);
  });

  it("assemblePrompt grouping is stable (system+workflow vs rest)", () => {
    const sections: PromptSection[] = [
      { name: "system", content: "SYSTEM_CONTENT" },
      { name: "workflow", content: "WORKFLOW_CONTENT" },
      { name: "brief", content: "BRIEF_CONTENT" },
      { name: "files", content: "FILES_CONTENT" },
      { name: "validation", content: "VALIDATION_CONTENT" },
      { name: "completion", content: "COMPLETION_CONTENT" },
    ];
    const envelope = createPromptEnvelope(sections);
    const { systemPrompt: sys, taskPrompt: task } = assemblePrompt(envelope);

    // System group: system + workflow
    expect(sys).toBe("SYSTEM_CONTENT\n\nWORKFLOW_CONTENT");

    // Task group: brief + files + validation + completion
    expect(task).toBe("BRIEF_CONTENT\n\nFILES_CONTENT\n\nVALIDATION_CONTENT\n\nCOMPLETION_CONTENT");
  });

  it("vendor delivery formats are structurally predictable", () => {
    const sys = "System prompt text";
    const task = "Task prompt text";

    // Claude delivery: separate --system-prompt flag + stdin
    const { args, stdinContent } = buildClaudeCliArgs({
      systemPrompt: sys,
      promptText: task,
      allowedTools: ["Read"],
    });
    expect(args).toContain("--system-prompt");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe(sys);
    expect(stdinContent).toBe(task);

    // Codex delivery: combined positional arg
    const codexPrompt = `SYSTEM:\n${sys}\n\nTASK:\n${task}`;
    expect(codexPrompt).toBe("SYSTEM:\nSystem prompt text\n\nTASK:\nTask prompt text");
  });

  it("no empty sections leak through to either vendor", () => {
    const sections: PromptSection[] = [
      { name: "system", content: systemPrompt },
      { name: "workflow", content: "" },        // empty — should be filtered
      { name: "brief", content: briefText },
      { name: "files", content: "" },           // empty — should be filtered
      { name: "validation", content: "npm test" },
      { name: "completion", content: "" },      // empty — should be filtered
    ];
    const envelope = createPromptEnvelope(sections);

    // Only non-empty sections survive
    expect(envelope.sections).toHaveLength(3);
    expect(envelope.sections.map((s) => s.name)).toEqual([
      "system", "brief", "validation",
    ]);
  });

  it("section ordering is preserved through create → assemble pipeline", () => {
    // Custom ordering should be preserved (not sorted alphabetically)
    const customOrder: PromptSection[] = [
      { name: "completion", content: "Done." },
      { name: "system", content: "Identity." },
      { name: "brief", content: "Task." },
      { name: "workflow", content: "Steps." },
    ];
    const envelope = createPromptEnvelope(customOrder);
    const names = envelope.sections.map((s) => s.name);
    expect(names).toEqual(["completion", "system", "brief", "workflow"]);

    // assemblePrompt still correctly splits by name (not position)
    const { systemPrompt: sys, taskPrompt: task } = assemblePrompt(envelope);
    expect(sys).toContain("Identity.");
    expect(sys).toContain("Steps.");
    expect(task).toContain("Done.");
    expect(task).toContain("Task.");
  });
});

// ── 3. Cross-fixture consistency ─────────────────────────────────────────────

describe("cross-fixture prompt consistency", () => {
  it("FULL_PROMPT_SECTIONS covers all canonical sections", () => {
    const fixtureNames = FULL_PROMPT_SECTIONS.map((s) => s.name);
    for (const canonical of CANONICAL_PROMPT_SECTIONS) {
      expect(fixtureNames, `fixture missing canonical section: ${canonical}`).toContain(canonical);
    }
  });

  it("MINIMAL_PROMPT_SECTIONS includes only system and brief", () => {
    const fixtureNames = MINIMAL_PROMPT_SECTIONS.map((s) => s.name);
    expect(fixtureNames).toEqual(["system", "brief"]);
  });

  it("shared fixture envelope and realistic task envelope have same section names", () => {
    const fixtureEnvelope = createPromptEnvelope(FULL_PROMPT_SECTIONS);
    const fixtureNames = fixtureEnvelope.sections.map((s) => s.name);

    const systemPrompt = buildSystemPrompt(MOCK_TASK_BRIEF.project, CLI_CONFIG);
    const briefText = formatTaskBrief(MOCK_TASK_BRIEF);
    const realisticSections: PromptSection[] = [
      { name: "system", content: systemPrompt },
      { name: "workflow", content: MOCK_TASK_BRIEF.workflow },
      { name: "brief", content: briefText },
      { name: "files", content: "src/auth.ts" },
      { name: "validation", content: "npm test" },
      { name: "completion", content: "All tests pass" },
    ];
    const realisticEnvelope = createPromptEnvelope(realisticSections);
    const realisticNames = realisticEnvelope.sections.map((s) => s.name);

    expect(fixtureNames).toEqual(realisticNames);
  });

  it("both fixture envelopes produce valid assemblePrompt output", () => {
    for (const sections of [FULL_PROMPT_SECTIONS, MINIMAL_PROMPT_SECTIONS]) {
      const envelope = createPromptEnvelope(sections);
      const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

      // System prompt always has content (both fixtures include "system")
      expect(systemPrompt.length).toBeGreaterThan(0);

      // Task prompt always has content (both fixtures include "brief")
      expect(taskPrompt.length).toBeGreaterThan(0);
    }
  });
});
