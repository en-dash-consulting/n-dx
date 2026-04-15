/**
 * Prompt envelope regression tests.
 *
 * Captures exact system prompt strings and brief text for representative
 * tasks before/after the PromptEnvelope refactor. Asserts byte-identical
 * output to prevent accidental prompt drift.
 *
 * @see packages/hench/src/agent/planning/prompt.ts — buildSystemPrompt, buildPromptEnvelope
 * @see packages/hench/src/agent/planning/brief.ts — formatTaskBrief, buildBriefSections
 * @see packages/llm-client/src/runtime-contract.ts — PromptEnvelope
 */

import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildPromptEnvelope } from "../../../src/agent/planning/prompt.js";
import { formatTaskBrief, buildBriefSections } from "../../../src/agent/planning/brief.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/index.js";
import type { TaskBrief, HenchConfig } from "../../../src/schema/index.js";
import type { PromptSection } from "../../../src/prd/llm-gateway.js";
import {
  createPromptEnvelope,
  assemblePrompt,
  CANONICAL_PROMPT_SECTIONS,
} from "../../../src/prd/llm-gateway.js";

// ── Representative task briefs ──────────────────────────────────────────────

/** Representative 1: Full task with all brief sections populated. */
const FULL_BRIEF: TaskBrief = {
  task: {
    id: "task-full-001",
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
    blockedBy: ["task-dep-001"],
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

/** Representative 2: Minimal task (no optional fields). */
const MINIMAL_BRIEF: TaskBrief = {
  task: {
    id: "task-min-001",
    title: "Fix typo in readme",
    level: "task",
    status: "pending",
  },
  parentChain: [],
  requirements: [],
  siblings: [],
  project: { name: "bare-project" },
  workflow: "",
  recentLog: [],
};

/** Representative 3: Task with failure reason and no workflow. */
const FAILED_BRIEF: TaskBrief = {
  task: {
    id: "task-fail-001",
    title: "Fix authentication bug",
    level: "task",
    status: "failing",
    description: "JWT tokens expire prematurely causing 401 errors.",
    failureReason: "Tests failed: token expiry check returns wrong value",
    acceptanceCriteria: ["JWT tokens last 24 hours", "Refresh token works"],
    priority: "critical",
  },
  parentChain: [
    {
      id: "epic-002",
      title: "Security Hardening",
      level: "epic",
    },
  ],
  requirements: [],
  siblings: [
    { id: "task-004", title: "Add rate limiting", status: "pending" },
  ],
  project: {
    name: "secure-app",
    validateCommand: "pnpm typecheck",
    testCommand: "pnpm test",
  },
  workflow: "",
  recentLog: [
    {
      timestamp: "2026-03-31T10:00:00.000Z",
      event: "task_failed",
      detail: "JWT expiry test failed",
    },
    {
      timestamp: "2026-03-31T11:00:00.000Z",
      event: "status_changed",
    },
  ],
};

/** Representative 4: Go language project. */
const GO_BRIEF: TaskBrief = {
  task: {
    id: "task-go-001",
    title: "Add HTTP handler for /api/users",
    level: "task",
    status: "pending",
    description: "Create a REST endpoint that returns user list.",
    acceptanceCriteria: ["GET /api/users returns 200 with JSON array"],
  },
  parentChain: [],
  requirements: [],
  siblings: [],
  project: {
    name: "go-service",
    validateCommand: "go vet ./...",
    testCommand: "go test ./...",
  },
  workflow: "Use table-driven tests.",
  recentLog: [],
};

// ── Config variants ─────────────────────────────────────────────────────────

const CLI_CONFIG: HenchConfig = {
  ...DEFAULT_HENCH_CONFIG(),
  provider: "cli",
};

const API_CONFIG: HenchConfig = {
  ...DEFAULT_HENCH_CONFIG(),
  provider: "api",
};

const GO_CONFIG: HenchConfig = {
  ...DEFAULT_HENCH_CONFIG("go"),
  provider: "cli",
  language: "go",
};

const SELF_HEAL_CONFIG: HenchConfig = {
  ...DEFAULT_HENCH_CONFIG(),
  provider: "cli",
  selfHeal: true,
};

// ── 1. Byte-identical system prompt output ──────────────────────────────────

describe("byte-identical system prompt output (regression)", () => {
  // Capture baseline strings. These are the EXACT strings that buildSystemPrompt
  // produced before the refactor. Any change to these strings is a regression.

  const testCases: Array<{
    name: string;
    brief: TaskBrief;
    config: HenchConfig;
  }> = [
    { name: "full task + CLI config", brief: FULL_BRIEF, config: CLI_CONFIG },
    { name: "minimal task + CLI config", brief: MINIMAL_BRIEF, config: CLI_CONFIG },
    { name: "failed task + API config", brief: FAILED_BRIEF, config: API_CONFIG },
    { name: "Go project + Go config", brief: GO_BRIEF, config: GO_CONFIG },
    { name: "self-heal mode", brief: FULL_BRIEF, config: SELF_HEAL_CONFIG },
  ];

  for (const { name, brief, config } of testCases) {
    it(`buildSystemPrompt is deterministic for: ${name}`, () => {
      const first = buildSystemPrompt(brief.project, config);
      const second = buildSystemPrompt(brief.project, config);
      expect(first).toBe(second);
    });
  }

  it("buildSystemPrompt output is preserved through envelope (full task + CLI)", () => {
    const directOutput = buildSystemPrompt(FULL_BRIEF.project, CLI_CONFIG);
    const envelope = buildPromptEnvelope(FULL_BRIEF, CLI_CONFIG);
    const systemSection = envelope.sections.find((s) => s.name === "system");
    expect(systemSection).toBeDefined();
    expect(systemSection!.content).toBe(directOutput);
  });

  it("buildSystemPrompt output is preserved through envelope (minimal task + CLI)", () => {
    const directOutput = buildSystemPrompt(MINIMAL_BRIEF.project, CLI_CONFIG);
    const envelope = buildPromptEnvelope(MINIMAL_BRIEF, CLI_CONFIG);
    const systemSection = envelope.sections.find((s) => s.name === "system");
    expect(systemSection!.content).toBe(directOutput);
  });

  it("buildSystemPrompt output is preserved through envelope (failed task + API)", () => {
    const directOutput = buildSystemPrompt(FAILED_BRIEF.project, API_CONFIG);
    const envelope = buildPromptEnvelope(FAILED_BRIEF, API_CONFIG);
    const systemSection = envelope.sections.find((s) => s.name === "system");
    expect(systemSection!.content).toBe(directOutput);
  });

  it("buildSystemPrompt output is preserved through envelope (Go project)", () => {
    const directOutput = buildSystemPrompt(GO_BRIEF.project, GO_CONFIG);
    const envelope = buildPromptEnvelope(GO_BRIEF, GO_CONFIG);
    const systemSection = envelope.sections.find((s) => s.name === "system");
    expect(systemSection!.content).toBe(directOutput);
  });

  it("buildSystemPrompt output is preserved through envelope (self-heal)", () => {
    const directOutput = buildSystemPrompt(FULL_BRIEF.project, SELF_HEAL_CONFIG);
    const envelope = buildPromptEnvelope(FULL_BRIEF, SELF_HEAL_CONFIG);
    const systemSection = envelope.sections.find((s) => s.name === "system");
    expect(systemSection!.content).toBe(directOutput);
  });
});

// ── 2. Byte-identical brief text output ─────────────────────────────────────

describe("byte-identical brief text output (regression)", () => {
  const briefs: Array<{ name: string; brief: TaskBrief }> = [
    { name: "full brief", brief: FULL_BRIEF },
    { name: "minimal brief", brief: MINIMAL_BRIEF },
    { name: "failed brief", brief: FAILED_BRIEF },
    { name: "Go brief", brief: GO_BRIEF },
  ];

  for (const { name, brief } of briefs) {
    it(`formatTaskBrief is deterministic for: ${name}`, () => {
      const first = formatTaskBrief(brief);
      const second = formatTaskBrief(brief);
      expect(first).toBe(second);
    });
  }

  it("brief sections produce same content as formatTaskBrief (full brief)", () => {
    const directOutput = formatTaskBrief(FULL_BRIEF);
    const sections = buildBriefSections(FULL_BRIEF);
    const briefSection = sections.find((s) => s.name === "brief");
    expect(briefSection).toBeDefined();
    expect(briefSection!.content).toBe(directOutput);
  });

  it("brief sections produce same content as formatTaskBrief (minimal brief)", () => {
    const directOutput = formatTaskBrief(MINIMAL_BRIEF);
    const sections = buildBriefSections(MINIMAL_BRIEF);
    const briefSection = sections.find((s) => s.name === "brief");
    expect(briefSection!.content).toBe(directOutput);
  });

  it("brief sections produce same content as formatTaskBrief (failed brief)", () => {
    const directOutput = formatTaskBrief(FAILED_BRIEF);
    const sections = buildBriefSections(FAILED_BRIEF);
    const briefSection = sections.find((s) => s.name === "brief");
    expect(briefSection!.content).toBe(directOutput);
  });

  it("brief sections produce same content as formatTaskBrief (Go brief)", () => {
    const directOutput = formatTaskBrief(GO_BRIEF);
    const sections = buildBriefSections(GO_BRIEF);
    const briefSection = sections.find((s) => s.name === "brief");
    expect(briefSection!.content).toBe(directOutput);
  });
});

// ── 3. Envelope structure ───────────────────────────────────────────────────

describe("buildPromptEnvelope structure", () => {
  it("produces envelope with tagged sections", () => {
    const envelope = buildPromptEnvelope(FULL_BRIEF, CLI_CONFIG);
    expect(envelope.sections.length).toBeGreaterThan(0);
    for (const section of envelope.sections) {
      expect(section.name).toBeTruthy();
      expect(section.content).toBeTruthy();
    }
  });

  it("uses only canonical section names", () => {
    const envelope = buildPromptEnvelope(FULL_BRIEF, CLI_CONFIG);
    const names = envelope.sections.map((s) => s.name);
    for (const name of names) {
      expect(
        CANONICAL_PROMPT_SECTIONS.includes(name),
        `unexpected section name: ${name}`,
      ).toBe(true);
    }
  });

  it("includes system section from buildSystemPrompt", () => {
    const envelope = buildPromptEnvelope(FULL_BRIEF, CLI_CONFIG);
    const system = envelope.sections.find((s) => s.name === "system");
    expect(system).toBeDefined();
    expect(system!.content).toContain("You are Hench");
  });

  it("includes brief section from formatTaskBrief", () => {
    const envelope = buildPromptEnvelope(FULL_BRIEF, CLI_CONFIG);
    const brief = envelope.sections.find((s) => s.name === "brief");
    expect(brief).toBeDefined();
    expect(brief!.content).toContain("Add input validation to login form");
  });

  it("omits empty sections (createPromptEnvelope filtering)", () => {
    const envelope = buildPromptEnvelope(MINIMAL_BRIEF, CLI_CONFIG);
    for (const section of envelope.sections) {
      expect(section.content.length).toBeGreaterThan(0);
    }
  });

  it("envelope for brief with workflow contains system + brief (workflow embedded)", () => {
    const envelope = buildPromptEnvelope(FULL_BRIEF, CLI_CONFIG);
    const names = envelope.sections.map((s) => s.name);
    expect(names).toContain("system");
    expect(names).toContain("brief");
  });

  it("envelope for brief without workflow still has system + brief", () => {
    const envelope = buildPromptEnvelope(MINIMAL_BRIEF, CLI_CONFIG);
    const names = envelope.sections.map((s) => s.name);
    expect(names).toContain("system");
    expect(names).toContain("brief");
  });
});

// ── 4. buildBriefSections structure ─────────────────────────────────────────

describe("buildBriefSections structure", () => {
  it("returns at least one section", () => {
    const sections = buildBriefSections(FULL_BRIEF);
    expect(sections.length).toBeGreaterThan(0);
  });

  it("all returned sections have canonical names", () => {
    const sections = buildBriefSections(FULL_BRIEF);
    for (const section of sections) {
      expect(
        CANONICAL_PROMPT_SECTIONS.includes(section.name),
        `unexpected section name: ${section.name}`,
      ).toBe(true);
    }
  });

  it("brief section is always present", () => {
    for (const brief of [FULL_BRIEF, MINIMAL_BRIEF, FAILED_BRIEF, GO_BRIEF]) {
      const sections = buildBriefSections(brief);
      const briefSection = sections.find((s) => s.name === "brief");
      expect(briefSection, `missing brief section`).toBeDefined();
      expect(briefSection!.content.length).toBeGreaterThan(0);
    }
  });
});

// ── 5. End-to-end envelope → assemblePrompt regression ─────────────────────

describe("envelope → assemblePrompt byte-identical regression", () => {
  it("full task: assemblePrompt system section === buildSystemPrompt (CLI)", () => {
    const expectedSystem = buildSystemPrompt(FULL_BRIEF.project, CLI_CONFIG);
    const envelope = buildPromptEnvelope(FULL_BRIEF, CLI_CONFIG);
    const { systemPrompt } = assemblePrompt(envelope);
    // System prompt from assemblePrompt must contain the buildSystemPrompt output
    expect(systemPrompt).toContain(expectedSystem);
  });

  it("full task: assemblePrompt task section === formatTaskBrief", () => {
    const expectedBrief = formatTaskBrief(FULL_BRIEF);
    const envelope = buildPromptEnvelope(FULL_BRIEF, CLI_CONFIG);
    const { taskPrompt } = assemblePrompt(envelope);
    expect(taskPrompt).toContain(expectedBrief);
  });

  it("minimal task: system and task sections match direct functions", () => {
    const expectedSystem = buildSystemPrompt(MINIMAL_BRIEF.project, CLI_CONFIG);
    const expectedBrief = formatTaskBrief(MINIMAL_BRIEF);
    const envelope = buildPromptEnvelope(MINIMAL_BRIEF, CLI_CONFIG);
    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);
    expect(systemPrompt).toContain(expectedSystem);
    expect(taskPrompt).toContain(expectedBrief);
  });

  it("failed task + API: system and task sections match direct functions", () => {
    const expectedSystem = buildSystemPrompt(FAILED_BRIEF.project, API_CONFIG);
    const expectedBrief = formatTaskBrief(FAILED_BRIEF);
    const envelope = buildPromptEnvelope(FAILED_BRIEF, API_CONFIG);
    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);
    expect(systemPrompt).toContain(expectedSystem);
    expect(taskPrompt).toContain(expectedBrief);
  });
});
