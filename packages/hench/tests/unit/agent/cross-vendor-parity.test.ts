/**
 * Cross-vendor baseline runtime parity tests.
 *
 * Proves that Claude and Codex runs share the same:
 *   1. Prompt sections (same logical content in the envelope)
 *   2. Execution policy → vendor-specific flag compilation
 *   3. Permission envelope (sandbox + approval + tools)
 *   4. Normalized event schema (vendor-neutral RuntimeEvent)
 *   5. Failure classification (same error → same FailureCategory)
 *   6. Token diagnostic status (complete / partial / unavailable)
 *   7. Completion gates (vendor-neutral evaluation)
 *   8. RuntimeDiagnostics observability surface
 *
 * These tests use shared fixtures from cross-vendor-runtime.ts so that
 * any new vendor would run against the same baseline.
 *
 * @see packages/llm-client/src/runtime-contract.ts — runtime contract
 * @see packages/llm-client/src/codex-cli-provider.ts — Codex policy compilation
 * @see docs/analysis/claude-codex-runtime-identity-discovery.md — design rationale
 */

import { describe, it, expect } from "vitest";
import {
  createPromptEnvelope,
  assemblePrompt,
  classifyVendorError,
  failureCategoryLabel,
  mapRunFailureToCategory,
  DEFAULT_EXECUTION_POLICY,
  CANONICAL_PROMPT_SECTIONS,
  ALL_FAILURE_CATEGORIES,
} from "../../../src/prd/llm-gateway.js";
import type {
  PromptSection,
  PromptSectionName,
  RuntimeEvent,
  RuntimeEventType,
  FailureCategory,
  ExecutionPolicy,
  RuntimeDiagnostics,
  TokenDiagnosticStatus,
} from "../../../src/prd/llm-gateway.js";
import {
  compileCodexPolicyFlags,
  mapSandboxToCodexFlag,
  mapApprovalToCodexFlag,
} from "../../../src/prd/llm-gateway.js";
import {
  parseApiTokenUsageWithDiagnostic,
  mapCodexUsageToTokenUsage,
} from "../../../src/prd/llm-gateway.js";
import {
  FULL_PROMPT_SECTIONS,
  MINIMAL_PROMPT_SECTIONS,
  STANDARD_POLICY,
  READONLY_POLICY,
  FULL_ACCESS_POLICY,
  ASSISTANT_EVENT,
  TOOL_USE_EVENT,
  TOOL_RESULT_EVENT,
  TOKEN_USAGE_EVENT,
  FAILURE_EVENT,
  COMPLETION_EVENT,
  FULL_RUN_SEQUENCE,
  CROSS_VENDOR_ERROR_FIXTURES,
  TOKEN_DIAGNOSTIC_FIXTURES,
  DIAGNOSTICS_FIXTURES,
} from "../../fixtures/cross-vendor-runtime.js";

// ── 1. Prompt section parity ──────────────────────────────────────────────

describe("cross-vendor prompt section parity", () => {
  it("both vendors receive the same 6 canonical section names", () => {
    expect(CANONICAL_PROMPT_SECTIONS).toEqual([
      "system",
      "workflow",
      "brief",
      "files",
      "validation",
      "completion",
    ]);
    expect(CANONICAL_PROMPT_SECTIONS).toHaveLength(6);
  });

  it("full prompt envelope preserves all sections for both vendors", () => {
    const envelope = createPromptEnvelope(FULL_PROMPT_SECTIONS);
    expect(envelope.sections).toHaveLength(6);
    for (const canonical of CANONICAL_PROMPT_SECTIONS) {
      expect(
        envelope.sections.some((s) => s.name === canonical),
        `missing section: ${canonical}`,
      ).toBe(true);
    }
  });

  it("assemblePrompt splits system/task identically regardless of vendor delivery", () => {
    const envelope = createPromptEnvelope(FULL_PROMPT_SECTIONS);
    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

    // System sections: "system" + "workflow"
    expect(systemPrompt).toContain("You are Hench");
    expect(systemPrompt).toContain("Follow TDD");

    // Task sections: everything else
    expect(taskPrompt).toContain("Implement user authentication");
    expect(taskPrompt).toContain("src/auth.ts");
    expect(taskPrompt).toContain("npm test");
    expect(taskPrompt).toContain("Done when all tests pass");

    // System sections must NOT appear in task prompt
    expect(taskPrompt).not.toContain("You are Hench");
    expect(taskPrompt).not.toContain("Follow TDD");
  });

  it("minimal prompt envelope works for both vendors", () => {
    const envelope = createPromptEnvelope(MINIMAL_PROMPT_SECTIONS);
    expect(envelope.sections).toHaveLength(2);

    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);
    expect(systemPrompt).toBe("You are Hench.");
    expect(taskPrompt).toBe("Fix the bug.");
  });

  it("empty sections are filtered before delivery to either vendor", () => {
    const withEmpty: PromptSection[] = [
      ...FULL_PROMPT_SECTIONS,
      { name: "files", content: "" }, // duplicate empty — should be filtered
    ];
    const envelope = createPromptEnvelope(withEmpty);
    // Only the non-empty "files" section from FULL_PROMPT_SECTIONS survives
    expect(envelope.sections.filter((s) => s.name === "files")).toHaveLength(1);
  });
});

// ── 2. Execution policy parity ────────────────────────────────────────────

describe("cross-vendor execution policy parity", () => {
  it("DEFAULT_EXECUTION_POLICY is the single source of truth for both vendors", () => {
    expect(DEFAULT_EXECUTION_POLICY).toEqual(STANDARD_POLICY);
  });

  it("standard policy compiles to correct Codex flags", () => {
    const flags = compileCodexPolicyFlags(STANDARD_POLICY);
    expect(flags).toEqual([
      "--sandbox", "workspace-write",
      "--approval-policy", "full-auto",
    ]);
  });

  it("read-only policy compiles to correct Codex flags", () => {
    const flags = compileCodexPolicyFlags(READONLY_POLICY);
    expect(flags).toEqual([
      "--sandbox", "read-only",
      "--approval-policy", "auto-edit",
    ]);
  });

  it("full-access policy compiles to correct Codex flags", () => {
    const flags = compileCodexPolicyFlags(FULL_ACCESS_POLICY);
    expect(flags).toEqual([
      "--sandbox", "full-access",
      "--approval-policy", "full-auto",
    ]);
  });

  it("every SandboxMode maps to a Codex flag", () => {
    const modes = ["read-only", "workspace-write", "danger-full-access"] as const;
    const expected = ["read-only", "workspace-write", "full-access"];
    modes.forEach((mode, i) => {
      expect(mapSandboxToCodexFlag(mode)).toBe(expected[i]);
    });
  });

  it("every ApprovalPolicy maps to a Codex flag", () => {
    expect(mapApprovalToCodexFlag("on-request")).toBe("auto-edit");
    expect(mapApprovalToCodexFlag("never")).toBe("full-auto");
  });

  it("policy fields are identical between vendors (only delivery differs)", () => {
    // The ExecutionPolicy object is vendor-neutral — both vendors read the
    // same fields. This test ensures the fixture policies cover all fields.
    for (const policy of [STANDARD_POLICY, READONLY_POLICY, FULL_ACCESS_POLICY]) {
      expect(policy).toHaveProperty("sandbox");
      expect(policy).toHaveProperty("approvals");
      expect(policy).toHaveProperty("networkAccess");
      expect(policy).toHaveProperty("writableRoots");
      expect(policy).toHaveProperty("allowedCommands");
      expect(policy).toHaveProperty("allowedFileTools");
    }
  });
});

// ── 3. Permission envelope parity ─────────────────────────────────────────

describe("cross-vendor permission envelope parity", () => {
  it("both vendors share the same file tool set", () => {
    // The allowedFileTools list is vendor-neutral — both Claude and Codex
    // receive the same set of permitted file operations.
    expect(DEFAULT_EXECUTION_POLICY.allowedFileTools).toEqual(
      ["Read", "Edit", "Write", "Glob", "Grep"],
    );
  });

  it("sandbox modes are exhaustive (both vendors must handle all 3)", () => {
    const modes = ["read-only", "workspace-write", "danger-full-access"] as const;
    for (const mode of modes) {
      // Claude handles via permission rules; Codex handles via --sandbox flag
      expect(typeof mapSandboxToCodexFlag(mode)).toBe("string");
    }
  });

  it("approval policies are exhaustive (both vendors must handle both)", () => {
    const policies = ["on-request", "never"] as const;
    for (const policy of policies) {
      expect(typeof mapApprovalToCodexFlag(policy)).toBe("string");
    }
  });

  it("network access and writable roots are part of the shared contract", () => {
    // These fields exist in ExecutionPolicy and are read by both vendor
    // wrappers, even though Codex currently handles them via --sandbox scope.
    expect(typeof STANDARD_POLICY.networkAccess).toBe("boolean");
    expect(Array.isArray(STANDARD_POLICY.writableRoots)).toBe(true);
  });
});

// ── 4. Runtime event schema parity ────────────────────────────────────────

describe("cross-vendor runtime event schema parity", () => {
  const eventPairs = [
    { name: "assistant", pair: ASSISTANT_EVENT },
    { name: "tool_use", pair: TOOL_USE_EVENT },
    { name: "tool_result", pair: TOOL_RESULT_EVENT },
    { name: "token_usage", pair: TOKEN_USAGE_EVENT },
    { name: "failure", pair: FAILURE_EVENT },
    { name: "completion", pair: COMPLETION_EVENT },
  ] as const;

  for (const { name, pair } of eventPairs) {
    it(`${name} events are structurally identical except vendor field`, () => {
      const { claude, codex } = pair;

      // Vendor differs
      expect(claude.vendor).toBe("claude");
      expect(codex.vendor).toBe("codex");

      // Everything else is identical
      expect(claude.type).toBe(codex.type);
      expect(claude.turn).toBe(codex.turn);
      expect(claude.timestamp).toBe(codex.timestamp);
      expect(claude.text).toEqual(codex.text);
      expect(claude.toolCall).toEqual(codex.toolCall);
      expect(claude.toolResult).toEqual(codex.toolResult);
      expect(claude.tokenUsage).toEqual(codex.tokenUsage);
      expect(claude.failure).toEqual(codex.failure);
      expect(claude.completionSummary).toEqual(codex.completionSummary);
    });
  }

  it("all 6 event types are represented in the fixture pairs", () => {
    const allTypes: RuntimeEventType[] = [
      "assistant", "tool_use", "tool_result",
      "completion", "failure", "token_usage",
    ];
    const fixtureTypes = eventPairs.map((p) => p.pair.claude.type);
    for (const t of allTypes) {
      expect(fixtureTypes).toContain(t);
    }
  });

  it("full run sequence has identical structure for both vendors", () => {
    expect(FULL_RUN_SEQUENCE.claude).toHaveLength(5);
    expect(FULL_RUN_SEQUENCE.codex).toHaveLength(5);

    for (let i = 0; i < FULL_RUN_SEQUENCE.claude.length; i++) {
      const c = FULL_RUN_SEQUENCE.claude[i];
      const x = FULL_RUN_SEQUENCE.codex[i];
      expect(c.type).toBe(x.type);
      expect(c.turn).toBe(x.turn);
      expect(c.timestamp).toBe(x.timestamp);
    }
  });

  it("turns are monotonically increasing within a sequence", () => {
    for (const vendor of ["claude", "codex"] as const) {
      const events = FULL_RUN_SEQUENCE[vendor];
      for (let i = 1; i < events.length; i++) {
        expect(events[i].turn).toBeGreaterThanOrEqual(events[i - 1].turn);
      }
    }
  });

  it("timestamps are valid ISO 8601 strings", () => {
    for (const vendor of ["claude", "codex"] as const) {
      for (const event of FULL_RUN_SEQUENCE[vendor]) {
        expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
      }
    }
  });
});

// ── 5. Failure classification parity ──────────────────────────────────────

describe("cross-vendor failure classification parity", () => {
  for (const fixture of CROSS_VENDOR_ERROR_FIXTURES) {
    it(`classifies "${fixture.description}" → ${fixture.expected}`, () => {
      const category = classifyVendorError(new Error(fixture.message));
      expect(category).toBe(fixture.expected);
    });
  }

  it("all 11 failure categories have human-readable labels", () => {
    for (const category of ALL_FAILURE_CATEGORIES) {
      const label = failureCategoryLabel(category);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("ALL_FAILURE_CATEGORIES covers every FailureCategory", () => {
    expect(ALL_FAILURE_CATEGORIES).toHaveLength(11);
  });

  it("hench run failure reasons map to normalized categories", () => {
    // These are the failure reason strings used by hench's handleRunFailure.
    // Both vendors produce the same reasons.
    expect(mapRunFailureToCategory("spin_detected")).toBe("spin_detected");
    expect(mapRunFailureToCategory("completion_rejected")).toBe("completion_rejected");
    expect(mapRunFailureToCategory("budget_exceeded")).toBe("budget_exceeded");
    expect(mapRunFailureToCategory("task_transient_exhausted")).toBe("transient_exhausted");
    expect(mapRunFailureToCategory("task_failed")).toBe("unknown");
    expect(mapRunFailureToCategory("unrecognized_reason")).toBe("unknown");
  });

  it("cross-vendor error fixtures cover all vendor-specific error patterns", () => {
    // Verify we test errors from both vendors
    const descriptions = CROSS_VENDOR_ERROR_FIXTURES.map((f) => f.description);
    expect(descriptions.some((d) => d.includes("Claude"))).toBe(true);
    expect(descriptions.some((d) => d.includes("Codex"))).toBe(true);
    expect(descriptions.some((d) => d.includes("generic"))).toBe(true);
  });
});

// ── 6. Token diagnostic parity ────────────────────────────────────────────

describe("cross-vendor token diagnostic parity", () => {
  for (const fixture of TOKEN_DIAGNOSTIC_FIXTURES) {
    describe(fixture.description, () => {
      it("Claude API parser produces expected usage", () => {
        const result = parseApiTokenUsageWithDiagnostic(fixture.claudeApiPayload);
        expect(result.usage.input).toBe(fixture.expectedUsage.input);
        expect(result.usage.output).toBe(fixture.expectedUsage.output);
        expect(result.diagnosticStatus).toBe(fixture.expectedClaudeDiagnostic);
      });

      it("Codex parser produces expected usage", () => {
        const result = mapCodexUsageToTokenUsage(fixture.codexPayload);
        expect(result.usage.input).toBe(fixture.expectedUsage.input);
        expect(result.usage.output).toBe(fixture.expectedUsage.output);
        expect(result.diagnosticStatus).toBe(fixture.expectedCodexDiagnostic);
      });

      it("both vendors produce identical TokenUsage shape", () => {
        const claudeResult = parseApiTokenUsageWithDiagnostic(fixture.claudeApiPayload);
        const codexResult = mapCodexUsageToTokenUsage(fixture.codexPayload);

        expect(claudeResult.usage.input).toBe(codexResult.usage.input);
        expect(claudeResult.usage.output).toBe(codexResult.usage.output);
      });
    });
  }

  it("diagnostic status values are exhaustive", () => {
    const statuses: TokenDiagnosticStatus[] = ["complete", "partial", "unavailable"];
    expect(statuses).toHaveLength(3);
  });
});

// ── 7. Completion gate parity ─────────────────────────────────────────────

describe("cross-vendor completion gate parity", () => {
  it("completion event structure is vendor-neutral", () => {
    // Both vendors emit RuntimeEvent with type: "completion" and a
    // completionSummary string. The completion gate evaluates this
    // identically regardless of vendor.
    expect(COMPLETION_EVENT.claude.type).toBe("completion");
    expect(COMPLETION_EVENT.codex.type).toBe("completion");
    expect(COMPLETION_EVENT.claude.completionSummary).toBe(
      COMPLETION_EVENT.codex.completionSummary,
    );
  });

  it("completion event includes the run summary that gates evaluate", () => {
    expect(COMPLETION_EVENT.claude.completionSummary).toBeTruthy();
    expect(typeof COMPLETION_EVENT.claude.completionSummary).toBe("string");
  });

  it("failure events carry category for both vendors", () => {
    // When a run fails, both vendors emit a failure event with a
    // FailureCategory. The completion gate uses this to determine
    // whether to retry or mark the task as failed.
    expect(FAILURE_EVENT.claude.failure?.category).toBe("auth");
    expect(FAILURE_EVENT.codex.failure?.category).toBe("auth");
    expect(FAILURE_EVENT.claude.failure?.category).toBe(
      FAILURE_EVENT.codex.failure?.category,
    );
  });

  it("run failure reasons are the same set for both vendors", () => {
    // hench uses these reason strings regardless of vendor
    const reasons = [
      "spin_detected",
      "completion_rejected",
      "budget_exceeded",
      "task_failed",
      "task_transient_exhausted",
    ];
    for (const reason of reasons) {
      const category = mapRunFailureToCategory(reason);
      expect(ALL_FAILURE_CATEGORIES).toContain(category);
    }
  });
});

// ── 8. RuntimeDiagnostics parity ──────────────────────────────────────────

describe("cross-vendor RuntimeDiagnostics parity", () => {
  it("both vendor diagnostics share the same structural fields", () => {
    const { claude, codex } = DIAGNOSTICS_FIXTURES;
    const fields = [
      "vendor", "model", "sandbox", "approvals",
      "tokenDiagnosticStatus", "parseMode", "notes",
    ] as const;
    for (const field of fields) {
      expect(claude).toHaveProperty(field);
      expect(codex).toHaveProperty(field);
    }
  });

  it("vendor field correctly identifies the execution surface", () => {
    expect(DIAGNOSTICS_FIXTURES.claude.vendor).toBe("claude");
    expect(DIAGNOSTICS_FIXTURES.codex.vendor).toBe("codex");
  });

  it("sandbox and approval fields are identical when using the same policy", () => {
    const { claude, codex } = DIAGNOSTICS_FIXTURES;
    expect(claude.sandbox).toBe(codex.sandbox);
    expect(claude.approvals).toBe(codex.approvals);
  });

  it("tokenDiagnosticStatus uses the same enum values for both vendors", () => {
    const validStatuses: TokenDiagnosticStatus[] = ["complete", "partial", "unavailable"];
    expect(validStatuses).toContain(DIAGNOSTICS_FIXTURES.claude.tokenDiagnosticStatus);
    expect(validStatuses).toContain(DIAGNOSTICS_FIXTURES.codex.tokenDiagnosticStatus);
  });

  it("parseMode reflects vendor-specific delivery but is always a string", () => {
    // Claude uses "stream-json", Codex uses "json" — both are strings
    expect(typeof DIAGNOSTICS_FIXTURES.claude.parseMode).toBe("string");
    expect(typeof DIAGNOSTICS_FIXTURES.codex.parseMode).toBe("string");
    expect(DIAGNOSTICS_FIXTURES.claude.parseMode).not.toBe(
      DIAGNOSTICS_FIXTURES.codex.parseMode,
    );
  });

  it("notes array is always present (may be empty)", () => {
    expect(Array.isArray(DIAGNOSTICS_FIXTURES.claude.notes)).toBe(true);
    expect(Array.isArray(DIAGNOSTICS_FIXTURES.codex.notes)).toBe(true);
  });
});
