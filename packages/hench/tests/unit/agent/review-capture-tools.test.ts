/**
 * The reviewer needs its own MCP grants to capture findings.
 *
 * `buildAllowedTools` emits only `Bash(<cmd>:*)` patterns plus the file tools —
 * no MCP tools at all. So a spawned session's MCP permissions come entirely
 * from the *analyzed project's* `.claude/settings.json`, which hench does not
 * control. On run 60c3a951 that meant the reviewer's `mcp__rex__add_item` was
 * denied while the executor's `mcp__rex__update_task_status` succeeded: this
 * repo's settings file happens to enumerate the latter and not the former.
 *
 * Half the review pass's purpose is "capture the rest to the PRD", so a run
 * that cannot write items produces findings that exist only in a report file.
 * Declaring the grants at spawn time makes that work regardless of the
 * analyzed project's settings.
 */

import { describe, it, expect } from "vitest";
import {
  claudeCliAdapter,
  buildAllowedTools,
  REX_CAPTURE_TOOLS,
} from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { DEFAULT_EXECUTION_POLICY, createPromptEnvelope } from "../../../src/prd/llm-gateway.js";
import type { PromptSection, PromptSectionName } from "../../../src/prd/llm-gateway.js";
import {
  captureFailedFindings,
  unresolvedFindings,
} from "../../../src/agent/analysis/adversarial-review.js";
import type {
  ReviewFinding,
  ReviewReport,
} from "../../../src/agent/analysis/adversarial-review.js";

function envelope() {
  return createPromptEnvelope([
    { name: "system" as PromptSectionName, content: "sys" } as PromptSection,
    { name: "brief" as PromptSectionName, content: "brief" } as PromptSection,
  ]);
}

/** Read the allowed-tools payload in a platform-independent way. */
function allowedToolsText(args: string[]): string {
  const idx = args.indexOf("--allowed-tools");
  expect(idx).toBeGreaterThan(-1);
  // Windows joins every tool into one comma-separated token; POSIX passes them
  // as separate argv entries. Joining the tail covers both.
  return args.slice(idx + 1).join(",");
}

describe("REX_CAPTURE_TOOLS", () => {
  it("grants add_item — the write the capture step actually needs", () => {
    expect(REX_CAPTURE_TOOLS).toContain("mcp__rex__add_item");
  });

  it("grants the reads needed to resolve a capture parent", () => {
    expect(REX_CAPTURE_TOOLS).toContain("mcp__rex__get_item");
    expect(REX_CAPTURE_TOOLS).toContain("mcp__rex__get_prd_status");
  });

  it("grants no destructive PRD tool", () => {
    // A reviewer files findings; it does not restructure or delete the PRD.
    for (const forbidden of [
      "mcp__rex__move_item",
      "mcp__rex__merge_items",
      "mcp__rex__reorganize",
      "mcp__rex__update_task_status",
      "mcp__rex__sync_with_remote",
    ]) {
      expect(REX_CAPTURE_TOOLS).not.toContain(forbidden);
    }
  });

  it("names every tool in the mcp__<server>__<tool> form the CLI expects", () => {
    for (const tool of REX_CAPTURE_TOOLS) {
      expect(tool).toMatch(/^mcp__rex__[a-z_]+$/);
    }
  });

  it("contains nothing that would break the Windows comma-joined token", () => {
    for (const tool of REX_CAPTURE_TOOLS) {
      expect(tool).not.toContain(",");
      expect(tool).not.toContain(" ");
    }
  });
});

describe("buildSpawnConfig: extraAllowedTools", () => {
  it("appends extra tools to --allowed-tools", () => {
    const config = claudeCliAdapter.buildSpawnConfig(envelope(), DEFAULT_EXECUTION_POLICY, {
      extraAllowedTools: REX_CAPTURE_TOOLS,
    });
    const tools = allowedToolsText(config.args);
    for (const tool of REX_CAPTURE_TOOLS) expect(tools).toContain(tool);
  });

  it("keeps the policy-derived tools alongside the extras", () => {
    const config = claudeCliAdapter.buildSpawnConfig(envelope(), DEFAULT_EXECUTION_POLICY, {
      extraAllowedTools: REX_CAPTURE_TOOLS,
    });
    const tools = allowedToolsText(config.args);
    for (const base of buildAllowedTools(DEFAULT_EXECUTION_POLICY.allowedCommands)) {
      expect(tools).toContain(base);
    }
  });

  it("grants no MCP tool when extras are omitted (regression guard)", () => {
    const config = claudeCliAdapter.buildSpawnConfig(envelope(), DEFAULT_EXECUTION_POLICY, {});
    expect(allowedToolsText(config.args)).not.toContain("mcp__rex__");
  });

  it("is a no-op for an empty extras list", () => {
    const withEmpty = claudeCliAdapter.buildSpawnConfig(envelope(), DEFAULT_EXECUTION_POLICY, {
      extraAllowedTools: [],
    });
    const without = claudeCliAdapter.buildSpawnConfig(envelope(), DEFAULT_EXECUTION_POLICY, {});
    expect(withEmpty.args).toEqual(without.args);
  });
});

// ── Capture-failure visibility ──────────────────────────────────────────────

function finding(over: Partial<ReviewFinding>): ReviewFinding {
  return {
    title: "t",
    severity: "medium",
    verdict: "should-fix",
    scenario: "s",
    action: "captured",
    ...over,
  };
}

function report(findings: ReviewFinding[]): ReviewReport {
  return { taskId: "t1", findings, fixesApplied: false, summary: "sum" };
}

describe("captureFailedFindings", () => {
  it("selects findings the reviewer could not file", () => {
    const r = report([
      finding({ title: "filed", action: "captured", itemId: "id-1" }),
      finding({ title: "denied", action: "failed" }),
      finding({ title: "dropped", action: "dropped" }),
    ]);
    expect(captureFailedFindings(r).map((f) => f.title)).toEqual(["denied"]);
  });

  it("is empty when every finding was dealt with", () => {
    const r = report([
      finding({ action: "captured", itemId: "id-1" }),
      finding({ action: "fixed", verdict: "must-fix" }),
      finding({ action: "dropped", verdict: "not-worth-fixing" }),
    ]);
    expect(captureFailedFindings(r)).toHaveLength(0);
  });

  it("does not conflate a capture failure with an unrepaired must-fix", () => {
    // The distinction run 60c3a951 lost: it reported four "must-fix" findings
    // when the report held zero, because unresolvedFindings folds both in.
    const r = report([finding({ verdict: "out-of-scope", action: "failed" })]);

    expect(captureFailedFindings(r)).toHaveLength(1);
    expect(unresolvedFindings(r)).toHaveLength(0);
    expect(r.findings.filter((f) => f.verdict === "must-fix")).toHaveLength(0);
  });
});
