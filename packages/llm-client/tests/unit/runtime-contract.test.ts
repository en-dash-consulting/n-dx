import { describe, it, expect } from "vitest";
import type {
  PromptSection,
  PromptSectionName,
  PromptEnvelope,
  SandboxMode,
  ApprovalPolicy,
  ExecutionPolicy,
  RuntimeEventType,
  RuntimeEvent,
  FailureCategory,
  TokenDiagnosticStatus,
  RuntimeDiagnostics,
} from "../../src/runtime-contract.js";
import {
  DEFAULT_EXECUTION_POLICY,
  CANONICAL_PROMPT_SECTIONS,
  ALL_FAILURE_CATEGORIES,
  createPromptEnvelope,
  assemblePrompt,
  mapErrorReasonToFailureCategory,
  mapRunFailureToCategory,
  classifyVendorError,
  failureCategoryLabel,
} from "../../src/runtime-contract.js";
import { ClaudeClientError } from "../../src/types.js";

// ── PromptSection ────────────────────────────────────────────────────────

describe("PromptSection", () => {
  it("accepts canonical section names", () => {
    const section: PromptSection = { name: "system", content: "You are an agent." };
    expect(section.name).toBe("system");
    expect(section.content).toBe("You are an agent.");
  });

  it("accepts custom section names via string extensibility", () => {
    const section: PromptSection = { name: "vendor-specific", content: "extra context" };
    expect(section.name).toBe("vendor-specific");
  });

  it("allows empty content for conditionally omitted sections", () => {
    const section: PromptSection = { name: "files", content: "" };
    expect(section.content).toBe("");
  });
});

// ── PromptEnvelope ───────────────────────────────────────────────────────

describe("PromptEnvelope", () => {
  it("holds an ordered array of sections", () => {
    const envelope: PromptEnvelope = {
      sections: [
        { name: "system", content: "You are an agent." },
        { name: "brief", content: "Fix the bug." },
      ],
    };
    expect(envelope.sections).toHaveLength(2);
    expect(envelope.sections[0].name).toBe("system");
    expect(envelope.sections[1].name).toBe("brief");
  });

  it("preserves section ordering", () => {
    const envelope: PromptEnvelope = {
      sections: [
        { name: "completion", content: "Done when tests pass." },
        { name: "system", content: "You are an agent." },
      ],
    };
    expect(envelope.sections[0].name).toBe("completion");
    expect(envelope.sections[1].name).toBe("system");
  });
});

// ── createPromptEnvelope ─────────────────────────────────────────────────

describe("createPromptEnvelope", () => {
  it("filters out sections with empty content", () => {
    const envelope = createPromptEnvelope([
      { name: "system", content: "You are an agent." },
      { name: "files", content: "" },
      { name: "brief", content: "Fix the bug." },
    ]);
    expect(envelope.sections).toHaveLength(2);
    expect(envelope.sections[0].name).toBe("system");
    expect(envelope.sections[1].name).toBe("brief");
  });

  it("returns empty sections array when all content is empty", () => {
    const envelope = createPromptEnvelope([
      { name: "system", content: "" },
      { name: "brief", content: "" },
    ]);
    expect(envelope.sections).toHaveLength(0);
  });

  it("preserves all sections when none are empty", () => {
    const envelope = createPromptEnvelope([
      { name: "system", content: "sys" },
      { name: "workflow", content: "wf" },
      { name: "brief", content: "task" },
    ]);
    expect(envelope.sections).toHaveLength(3);
  });
});

// ── assemblePrompt ───────────────────────────────────────────────────────

describe("assemblePrompt", () => {
  it("separates system and task sections", () => {
    const envelope = createPromptEnvelope([
      { name: "system", content: "You are an agent." },
      { name: "workflow", content: "Follow TDD." },
      { name: "brief", content: "Fix the bug." },
      { name: "validation", content: "Run tests." },
    ]);

    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

    expect(systemPrompt).toBe("You are an agent.\n\nFollow TDD.");
    expect(taskPrompt).toBe("Fix the bug.\n\nRun tests.");
  });

  it("handles envelope with only system sections", () => {
    const envelope = createPromptEnvelope([
      { name: "system", content: "You are an agent." },
    ]);

    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

    expect(systemPrompt).toBe("You are an agent.");
    expect(taskPrompt).toBe("");
  });

  it("handles envelope with only task sections", () => {
    const envelope = createPromptEnvelope([
      { name: "brief", content: "Fix the bug." },
    ]);

    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

    expect(systemPrompt).toBe("");
    expect(taskPrompt).toBe("Fix the bug.");
  });

  it("handles empty envelope", () => {
    const envelope = createPromptEnvelope([]);

    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

    expect(systemPrompt).toBe("");
    expect(taskPrompt).toBe("");
  });

  it("places custom sections in the task group", () => {
    const envelope = createPromptEnvelope([
      { name: "system", content: "sys" },
      { name: "vendor-hint", content: "hint" },
    ]);

    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

    expect(systemPrompt).toBe("sys");
    expect(taskPrompt).toBe("hint");
  });
});

// ── SandboxMode ──────────────────────────────────────────────────────────

describe("SandboxMode", () => {
  it("accepts all three levels", () => {
    const modes: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];
    expect(modes).toHaveLength(3);
  });
});

// ── ApprovalPolicy ───────────────────────────────────────────────────────

describe("ApprovalPolicy", () => {
  it("accepts both policies", () => {
    const policies: ApprovalPolicy[] = ["on-request", "never"];
    expect(policies).toHaveLength(2);
  });
});

// ── ExecutionPolicy ──────────────────────────────────────────────────────

describe("ExecutionPolicy", () => {
  it("composes all policy fields", () => {
    const policy: ExecutionPolicy = {
      sandbox: "workspace-write",
      approvals: "never",
      networkAccess: false,
      writableRoots: ["."],
      allowedCommands: ["npm", "git"],
      allowedFileTools: ["Read", "Edit", "Write"],
    };

    expect(policy.sandbox).toBe("workspace-write");
    expect(policy.approvals).toBe("never");
    expect(policy.networkAccess).toBe(false);
    expect(policy.writableRoots).toEqual(["."]);
    expect(policy.allowedCommands).toEqual(["npm", "git"]);
    expect(policy.allowedFileTools).toEqual(["Read", "Edit", "Write"]);
  });
});

// ── DEFAULT_EXECUTION_POLICY ─────────────────────────────────────────────

describe("DEFAULT_EXECUTION_POLICY", () => {
  it("uses workspace-write sandbox for autonomous runs", () => {
    expect(DEFAULT_EXECUTION_POLICY.sandbox).toBe("workspace-write");
  });

  it("uses never approval for unattended execution", () => {
    expect(DEFAULT_EXECUTION_POLICY.approvals).toBe("never");
  });

  it("disables network access by default", () => {
    expect(DEFAULT_EXECUTION_POLICY.networkAccess).toBe(false);
  });

  it("includes standard file tools", () => {
    expect(DEFAULT_EXECUTION_POLICY.allowedFileTools).toContain("Read");
    expect(DEFAULT_EXECUTION_POLICY.allowedFileTools).toContain("Edit");
    expect(DEFAULT_EXECUTION_POLICY.allowedFileTools).toContain("Write");
    expect(DEFAULT_EXECUTION_POLICY.allowedFileTools).toContain("Glob");
    expect(DEFAULT_EXECUTION_POLICY.allowedFileTools).toContain("Grep");
  });

  it("starts with empty allowed commands (populated at runtime from guard config)", () => {
    expect(DEFAULT_EXECUTION_POLICY.allowedCommands).toEqual([]);
  });
});

// ── RuntimeEventType ─────────────────────────────────────────────────────

describe("RuntimeEventType", () => {
  it("includes all event types", () => {
    const types: RuntimeEventType[] = [
      "assistant",
      "tool_use",
      "tool_result",
      "completion",
      "failure",
      "token_usage",
    ];
    expect(types).toHaveLength(6);
  });
});

// ── RuntimeEvent ─────────────────────────────────────────────────────────

describe("RuntimeEvent", () => {
  it("represents an assistant message event", () => {
    const event: RuntimeEvent = {
      type: "assistant",
      vendor: "claude",
      turn: 1,
      timestamp: "2026-03-31T00:00:00.000Z",
      text: "I will fix the bug.",
    };
    expect(event.type).toBe("assistant");
    expect(event.text).toBe("I will fix the bug.");
    expect(event.toolCall).toBeUndefined();
  });

  it("represents a tool_use event", () => {
    const event: RuntimeEvent = {
      type: "tool_use",
      vendor: "claude",
      turn: 2,
      timestamp: "2026-03-31T00:00:01.000Z",
      toolCall: {
        tool: "Edit",
        input: { file_path: "src/main.ts", old_string: "bug", new_string: "fix" },
      },
    };
    expect(event.type).toBe("tool_use");
    expect(event.toolCall?.tool).toBe("Edit");
    expect(event.toolCall?.input.file_path).toBe("src/main.ts");
  });

  it("represents a tool_result event", () => {
    const event: RuntimeEvent = {
      type: "tool_result",
      vendor: "codex",
      turn: 2,
      timestamp: "2026-03-31T00:00:02.000Z",
      toolResult: {
        tool: "Edit",
        output: "File edited successfully.",
        durationMs: 42,
      },
    };
    expect(event.type).toBe("tool_result");
    expect(event.toolResult?.durationMs).toBe(42);
  });

  it("represents a token_usage event", () => {
    const event: RuntimeEvent = {
      type: "token_usage",
      vendor: "claude",
      turn: 3,
      timestamp: "2026-03-31T00:00:03.000Z",
      tokenUsage: { input: 1000, output: 500, cacheReadInput: 200 },
    };
    expect(event.tokenUsage?.input).toBe(1000);
    expect(event.tokenUsage?.cacheReadInput).toBe(200);
  });

  it("represents a failure event with category and vendor detail", () => {
    const event: RuntimeEvent = {
      type: "failure",
      vendor: "codex",
      turn: 1,
      timestamp: "2026-03-31T00:00:04.000Z",
      failure: {
        category: "auth",
        message: "Authentication failed",
        vendorDetail: "Error: invalid api key",
      },
    };
    expect(event.failure?.category).toBe("auth");
    expect(event.failure?.vendorDetail).toBe("Error: invalid api key");
  });

  it("represents a completion event", () => {
    const event: RuntimeEvent = {
      type: "completion",
      vendor: "claude",
      turn: 5,
      timestamp: "2026-03-31T00:00:05.000Z",
      completionSummary: "Fixed the authentication bug.",
    };
    expect(event.completionSummary).toBe("Fixed the authentication bug.");
  });

  it("records vendor provenance on every event", () => {
    const claudeEvent: RuntimeEvent = {
      type: "assistant",
      vendor: "claude",
      turn: 1,
      timestamp: "2026-03-31T00:00:00.000Z",
      text: "hello",
    };
    const codexEvent: RuntimeEvent = {
      type: "assistant",
      vendor: "codex",
      turn: 1,
      timestamp: "2026-03-31T00:00:00.000Z",
      text: "hello",
    };
    expect(claudeEvent.vendor).toBe("claude");
    expect(codexEvent.vendor).toBe("codex");
  });
});

// ── FailureCategory ──────────────────────────────────────────────────────

describe("FailureCategory", () => {
  it("covers all categories from the discovery doc", () => {
    const categories: FailureCategory[] = [
      "auth",
      "not_found",
      "timeout",
      "rate_limit",
      "completion_rejected",
      "budget_exceeded",
      "spin_detected",
      "malformed_output",
      "mcp_unavailable",
      "transient_exhausted",
      "unknown",
    ];
    expect(categories).toHaveLength(11);
  });

  it("ALL_FAILURE_CATEGORIES contains every category", () => {
    expect(ALL_FAILURE_CATEGORIES).toHaveLength(11);
    expect(ALL_FAILURE_CATEGORIES).toContain("auth");
    expect(ALL_FAILURE_CATEGORIES).toContain("not_found");
    expect(ALL_FAILURE_CATEGORIES).toContain("timeout");
    expect(ALL_FAILURE_CATEGORIES).toContain("rate_limit");
    expect(ALL_FAILURE_CATEGORIES).toContain("completion_rejected");
    expect(ALL_FAILURE_CATEGORIES).toContain("budget_exceeded");
    expect(ALL_FAILURE_CATEGORIES).toContain("spin_detected");
    expect(ALL_FAILURE_CATEGORIES).toContain("malformed_output");
    expect(ALL_FAILURE_CATEGORIES).toContain("mcp_unavailable");
    expect(ALL_FAILURE_CATEGORIES).toContain("transient_exhausted");
    expect(ALL_FAILURE_CATEGORIES).toContain("unknown");
  });
});

// ── CANONICAL_PROMPT_SECTIONS ────────────────────────────────────────────

describe("CANONICAL_PROMPT_SECTIONS", () => {
  it("lists all six canonical section names", () => {
    expect(CANONICAL_PROMPT_SECTIONS).toEqual([
      "system",
      "workflow",
      "brief",
      "files",
      "validation",
      "completion",
    ]);
  });
});

// ── mapErrorReasonToFailureCategory ──────────────────────────────────────

describe("mapErrorReasonToFailureCategory", () => {
  it("maps auth → auth", () => {
    expect(mapErrorReasonToFailureCategory("auth")).toBe("auth");
  });

  it("maps not-found → not_found", () => {
    expect(mapErrorReasonToFailureCategory("not-found")).toBe("not_found");
  });

  it("maps timeout → timeout", () => {
    expect(mapErrorReasonToFailureCategory("timeout")).toBe("timeout");
  });

  it("maps rate-limit → rate_limit", () => {
    expect(mapErrorReasonToFailureCategory("rate-limit")).toBe("rate_limit");
  });

  it("maps cli → unknown", () => {
    expect(mapErrorReasonToFailureCategory("cli")).toBe("unknown");
  });

  it("maps unknown → unknown", () => {
    expect(mapErrorReasonToFailureCategory("unknown")).toBe("unknown");
  });

  it("maps unrecognized strings → unknown", () => {
    expect(mapErrorReasonToFailureCategory("something-else")).toBe("unknown");
  });
});

// ── mapRunFailureToCategory ──────────────────────────────────────────────

describe("mapRunFailureToCategory", () => {
  it("maps spin_detected", () => {
    expect(mapRunFailureToCategory("spin_detected")).toBe("spin_detected");
  });

  it("maps completion_rejected", () => {
    expect(mapRunFailureToCategory("completion_rejected")).toBe("completion_rejected");
  });

  it("maps budget_exceeded", () => {
    expect(mapRunFailureToCategory("budget_exceeded")).toBe("budget_exceeded");
  });

  it("maps task_failed → unknown", () => {
    expect(mapRunFailureToCategory("task_failed")).toBe("unknown");
  });

  it("maps task_transient_exhausted → transient_exhausted", () => {
    expect(mapRunFailureToCategory("task_transient_exhausted")).toBe("transient_exhausted");
  });

  it("maps unrecognized strings → unknown", () => {
    expect(mapRunFailureToCategory("some_other_reason")).toBe("unknown");
  });
});

// ── TokenDiagnosticStatus ────────────────────────────────────────────────

describe("TokenDiagnosticStatus", () => {
  it("accepts all three statuses", () => {
    const statuses: TokenDiagnosticStatus[] = ["complete", "partial", "unavailable"];
    expect(statuses).toHaveLength(3);
  });
});

// ── RuntimeDiagnostics ───────────────────────────────────────────────────

describe("RuntimeDiagnostics", () => {
  it("captures all observable runtime identity fields", () => {
    const diag: RuntimeDiagnostics = {
      vendor: "codex",
      model: "gpt-5-codex",
      sandbox: "workspace-write",
      approvals: "never",
      tokenDiagnosticStatus: "partial",
      parseMode: "json",
      notes: ["codex_usage_missing"],
    };

    expect(diag.vendor).toBe("codex");
    expect(diag.model).toBe("gpt-5-codex");
    expect(diag.sandbox).toBe("workspace-write");
    expect(diag.approvals).toBe("never");
    expect(diag.tokenDiagnosticStatus).toBe("partial");
    expect(diag.parseMode).toBe("json");
    expect(diag.notes).toContain("codex_usage_missing");
  });

  it("captures Claude diagnostics", () => {
    const diag: RuntimeDiagnostics = {
      vendor: "claude",
      model: "claude-sonnet-4-6",
      sandbox: "workspace-write",
      approvals: "never",
      tokenDiagnosticStatus: "complete",
      parseMode: "stream-json",
      notes: [],
    };

    expect(diag.vendor).toBe("claude");
    expect(diag.tokenDiagnosticStatus).toBe("complete");
    expect(diag.notes).toHaveLength(0);
  });
});

// ── classifyVendorError ──────────────────────────────────────────────────

describe("classifyVendorError", () => {
  it("classifies ClaudeClientError with auth reason", () => {
    const err = new ClaudeClientError("unauthorized", "auth", false);
    expect(classifyVendorError(err)).toBe("auth");
  });

  it("classifies ClaudeClientError with rate-limit reason", () => {
    const err = new ClaudeClientError("too many requests", "rate-limit", true);
    expect(classifyVendorError(err)).toBe("rate_limit");
  });

  it("classifies ClaudeClientError with timeout reason", () => {
    const err = new ClaudeClientError("timed out", "timeout", true);
    expect(classifyVendorError(err)).toBe("timeout");
  });

  it("classifies ClaudeClientError with not-found reason", () => {
    const err = new ClaudeClientError("model not found", "not-found", false);
    expect(classifyVendorError(err)).toBe("not_found");
  });

  it("classifies ClaudeClientError with unknown reason", () => {
    const err = new ClaudeClientError("something broke", "unknown", false);
    expect(classifyVendorError(err)).toBe("unknown");
  });

  it("classifies plain Error with auth pattern", () => {
    expect(classifyVendorError(new Error("Error: invalid api key"))).toBe("auth");
  });

  it("classifies plain Error with ANTHROPIC_API_KEY pattern", () => {
    expect(classifyVendorError(new Error("Missing ANTHROPIC_API_KEY"))).toBe("auth");
  });

  it("classifies plain Error with OPENAI_API_KEY pattern", () => {
    expect(classifyVendorError(new Error("Missing OPENAI_API_KEY"))).toBe("auth");
  });

  it("classifies plain Error with 401 pattern", () => {
    expect(classifyVendorError(new Error("HTTP 401 Unauthorized"))).toBe("auth");
  });

  it("classifies plain Error with rate limit pattern", () => {
    expect(classifyVendorError(new Error("rate limit exceeded"))).toBe("rate_limit");
  });

  it("classifies plain Error with 429 pattern", () => {
    expect(classifyVendorError(new Error("HTTP 429 Too Many Requests"))).toBe("rate_limit");
  });

  it("classifies plain Error with timeout pattern", () => {
    expect(classifyVendorError(new Error("request timed out"))).toBe("timeout");
  });

  it("classifies plain Error with ETIMEDOUT pattern", () => {
    expect(classifyVendorError(new Error("connect ETIMEDOUT"))).toBe("timeout");
  });

  it("classifies plain Error with not found pattern", () => {
    expect(classifyVendorError(new Error("codex: not found"))).toBe("not_found");
  });

  it("classifies plain Error with ENOENT pattern", () => {
    expect(classifyVendorError(new Error("ENOENT: no such file"))).toBe("not_found");
  });

  it("classifies plain Error with malformed output pattern", () => {
    expect(classifyVendorError(new Error("Unexpected token < in JSON"))).toBe("malformed_output");
  });

  it("classifies plain Error with transient patterns", () => {
    expect(classifyVendorError(new Error("HTTP 502 Bad Gateway"))).toBe("transient_exhausted");
    expect(classifyVendorError(new Error("ECONNRESET"))).toBe("transient_exhausted");
    expect(classifyVendorError(new Error("socket hang up"))).toBe("transient_exhausted");
  });

  it("classifies budget exceeded pattern", () => {
    expect(classifyVendorError(new Error("budget exceeded for this run"))).toBe("budget_exceeded");
  });

  it("falls back to unknown for unrecognized errors", () => {
    expect(classifyVendorError(new Error("something completely unexpected"))).toBe("unknown");
  });

  it("handles string input", () => {
    expect(classifyVendorError("ENOENT: missing file")).toBe("not_found");
  });
});

// ── failureCategoryLabel ─────────────────────────────────────────────────

describe("failureCategoryLabel", () => {
  it("returns a human-readable label for every category", () => {
    for (const category of ALL_FAILURE_CATEGORIES) {
      const label = failureCategoryLabel(category);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("returns specific labels for known categories", () => {
    expect(failureCategoryLabel("auth")).toBe("authentication failure");
    expect(failureCategoryLabel("rate_limit")).toBe("rate limit exceeded");
    expect(failureCategoryLabel("timeout")).toBe("operation timed out");
    expect(failureCategoryLabel("not_found")).toBe("resource not found");
    expect(failureCategoryLabel("unknown")).toBe("unexpected error");
  });
});
