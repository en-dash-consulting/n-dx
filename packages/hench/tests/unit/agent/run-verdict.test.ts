import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { classifyRun, countAttempts } from "../../../src/agent/analysis/run-verdict.js";
import {
  formatReviewRepairsUncommittedRefusal,
  formatUncommittedWorkRefusal,
} from "../../../src/agent/lifecycle/uncommitted-work-gate.js";
import type { ReviewReport } from "../../../src/agent/analysis/adversarial-review.js";
import type { RunEvent } from "../../../src/store/run-events.js";
import { RUN_VERDICT_CLASSES, type RunRecord, type TestGateResult } from "../../../src/schema/index.js";

/**
 * The run classifier: one fixture per class, a record matching no rule, the
 * attempt cap, and purity. Each fixture carries only the signal its class
 * needs, plus one commit so `no-changes` does not shadow it.
 */

const ROOT = "/repo";
const REX_DIR = ".rex";

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    taskId: "task-1",
    taskTitle: "A task",
    startedAt: "2026-10-28T10:00:00.000Z",
    finishedAt: "2026-10-28T10:10:00.000Z",
    status: "failed",
    turns: 4,
    tokenUsage: { input: 10, output: 10 },
    toolCalls: [],
    model: "sonnet",
    worktreeRoot: ROOT,
    commits: [{ sha: "a".repeat(40), subject: "feat: work" }],
    ...over,
  };
}

function failedGate(digest: string): TestGateResult {
  return { ran: true, passed: false, packages: [], failureDigest: digest };
}

const DIGEST = [
  " FAIL  tests/unit/widget.test.ts > renders",
  "AssertionError: expected 1 to be 2",
  " ❯ tests/unit/widget.test.ts:12:5",
].join("\n");

function classify(r: RunRecord, extra: { events?: RunEvent[]; review?: ReviewReport | null; attempt?: number } = {}) {
  return classifyRun({ run: r, events: extra.events, review: extra.review, attempt: extra.attempt ?? 1, rexDir: REX_DIR });
}

describe("classifyRun — one fixture per class", () => {
  it("test-gate-new: the digest names a file the run changed", () => {
    const d = classify(run({
      testGate: failedGate(DIGEST),
      structuredSummary: {
        filesChanged: ["packages/web/tests/unit/widget.test.ts"],
        filesRead: [], commandsExecuted: [], testsRun: [],
        counts: { filesRead: 0, filesChanged: 1, commandsExecuted: 0, testsRun: 0, toolCallsTotal: 0 },
      },
    }));
    expect(d.class).toBe("test-gate-new");
    expect(d.actions.map((a) => a.kind)).toEqual(["follow-up-run", "re-run"]);
  });

  it("test-gate-new: a file the events say was edited counts as changed", () => {
    const events: RunEvent[] = [
      { kind: "file_edited", at: "2026-10-28T10:01:00.000Z", summary: "Edited widget.test.ts", detail: `${ROOT}/tests/unit/widget.test.ts` },
    ];
    expect(classify(run({ testGate: failedGate(DIGEST) }), { events }).class).toBe("test-gate-new");
  });

  it("test-gate-preexisting: the digest names only files the run did not change", () => {
    const d = classify(run({
      testGate: failedGate(DIGEST),
      structuredSummary: {
        filesChanged: ["src/other.ts"],
        filesRead: [], commandsExecuted: [], testsRun: [],
        counts: { filesRead: 0, filesChanged: 1, commandsExecuted: 0, testsRun: 0, toolCallsTotal: 0 },
      },
    }));
    expect(d.class).toBe("test-gate-preexisting");
    expect(d.evidence).toContain("Not verified on main");
    expect(d.actions.map((a) => a.kind)).toEqual(["verify-on-main", "close-verified"]);
  });

  it("completion-held: completionHold outcome is not-applied", () => {
    const d = classify(run({ completionHold: { outcome: "not-applied", requestedAt: "2026-10-28T10:05:00.000Z" } }));
    expect(d.class).toBe("completion-held");
    expect(d.actions.map((a) => a.kind)).toEqual(["fresh", "hand-fix"]);
  });

  it("a completionHold that was applied or bypassed is not a hold; the other rules classify the run", () => {
    for (const outcome of ["applied", "bypassed"] as const) {
      expect(classify(run({ completionHold: { outcome } })).class).toBe("unclassified");
      expect(classify(run({ completionHold: { outcome }, status: "timeout" })).class).toBe("budget-timeout");
    }
  });

  it("test-gate-new: an absolute digest path under worktreeRoot matches the changed file", () => {
    const digest = ` FAIL  ${ROOT}/packages/web/tests/unit/viewer/add-item-form.test.ts > adds`;
    const d = classify(run({
      testGate: failedGate(digest),
      structuredSummary: {
        filesChanged: ["packages/web/tests/unit/viewer/add-item-form.test.ts"],
        filesRead: [], commandsExecuted: [], testsRun: [],
        counts: { filesRead: 0, filesChanged: 1, commandsExecuted: 0, testsRun: 0, toolCallsTotal: 0 },
      },
    }));
    expect(d.class).toBe("test-gate-new");
    expect(d.summary).toContain(": packages/web/tests/unit/viewer/add-item-form.test.ts.");
  });

  it("completion-held: gateOnlyRetry is set", () => {
    const d = classify(run({ gateOnlyRetry: { sourceRunId: "run-0", base: "b".repeat(40), commits: [] } }));
    expect(d.class).toBe("completion-held");
  });

  it("review-blocked: the review record counts an unrepaired must-fix", () => {
    const d = classify(run({
      review: {
        model: "opus", resumedSession: false, findingCount: 1, unresolvedCount: 1,
        unrepairedMustFixCount: 1, failedActionCount: 0, fixesApplied: false, reportPath: "/r.json",
      },
    }));
    expect(d.class).toBe("review-blocked");
    expect(d.actions[0]!.kind).toBe("follow-up-run");
  });

  it("review-blocked: the review report holds the finding, which becomes evidence", () => {
    const review: ReviewReport = {
      taskId: "task-1", fixesApplied: false, summary: "",
      findings: [{ title: "Null crash on empty list", location: "src/a.ts:3", severity: "high", verdict: "must-fix", scenario: "[] → throws", action: "failed" }],
    };
    const d = classify(run({ review: { failed: "must-fix-unresolved", detail: "1 open", reportPath: "/r.json" } }), { review });
    expect(d.class).toBe("review-blocked");
    expect(d.evidence).toContain("must-fix: Null crash on empty list (src/a.ts:3)");
  });

  it("claim-lost: claimLost is set", () => {
    const d = classify(run({ claimLost: { at: "2026-10-28T10:03:00.000Z", taskId: "task-1", holderWorktree: "/other" } }));
    expect(d.class).toBe("claim-lost");
    expect(d.actions.map((a) => a.kind)).toEqual(["release-claim", "re-run"]);
  });

  it("claim-lost: readOnlyRefusal is set", () => {
    expect(classify(run({ readOnlyRefusal: { reason: "no edits" } })).class).toBe("claim-lost");
  });

  it("completion-held: both uncommitted-work refusals the completion gate writes are recognised", () => {
    for (const error of [
      formatUncommittedWorkRefusal(["src/a.ts"]),
      formatReviewRepairsUncommittedRefusal(["src/a.ts"], "commit failed", "task-1"),
    ]) {
      const d = classify(run({ error, uncommittedPaths: ["src/a.ts"] }));
      expect(d.class).toBe("completion-held");
      expect(d.evidence).toContain("Uncommitted: src/a.ts");
      expect(d.actions[0]).toEqual({ kind: "clean-tree", label: "Commit or discard the uncommitted paths, then verify" });
    }
  });

  it("an uncommitted-work refusal still wins over the rules after a lost claim", () => {
    const error = formatUncommittedWorkRefusal(["src/a.ts"]);
    const d = classify(run({ error, uncommittedPaths: ["src/a.ts"], status: "timeout", testGate: failedGate(DIGEST) }));
    expect(d.class).toBe("completion-held");
    expect(d.actions[0]!.kind).toBe("clean-tree");
  });

  it("budget-timeout: status timeout or budget_exceeded", () => {
    expect(classify(run({ status: "timeout" })).class).toBe("budget-timeout");
    const d = classify(run({ status: "budget_exceeded" }));
    expect(d.class).toBe("budget-timeout");
    expect(d.actions.map((a) => a.kind)).toEqual(["split-task", "raise-tier"]);
  });

  it("budget-timeout: the brief was too large for the context window", () => {
    expect(classify(run({ error: "Brief too large for configured context window: ~90,000 estimated tokens" })).class)
      .toBe("budget-timeout");
  });

  it("vendor-transient: status error_transient", () => {
    const d = classify(run({ status: "error_transient" }));
    expect(d.class).toBe("vendor-transient");
    expect(d.actions.map((a) => a.kind)).toEqual(["retry-later"]);
  });

  it("vendor-transient: an auth or rate-limit failure category", () => {
    for (const category of ["auth", "rate_limit"]) {
      const r = run({ events: [{ type: "failure", vendor: "claude", turn: 1, timestamp: "t", failure: { category, message: "x" } }] });
      expect(classify(r).class).toBe("vendor-transient");
    }
  });

  it("no-changes: no commits", () => {
    const d = classify(run({ commits: [] }));
    expect(d.class).toBe("no-changes");
    expect(d.actions.map((a) => a.kind)).toEqual(["tighten-done-when"]);
  });

  it("no-changes: only paths under the rex directory changed", () => {
    const d = classify(run({
      structuredSummary: {
        filesChanged: [`${REX_DIR}/changes/x/state.yaml`],
        filesRead: [], commandsExecuted: [], testsRun: [],
        counts: { filesRead: 0, filesChanged: 1, commandsExecuted: 0, testsRun: 0, toolCallsTotal: 0 },
      },
    }));
    expect(d.class).toBe("no-changes");
  });

  it("no-changes uses the rex directory it is given, not a fixed one", () => {
    const r = run({
      structuredSummary: {
        filesChanged: [".ndx/rex/changes/x/state.yaml"],
        filesRead: [], commandsExecuted: [], testsRun: [],
        counts: { filesRead: 0, filesChanged: 1, commandsExecuted: 0, testsRun: 0, toolCallsTotal: 0 },
      },
    });
    expect(classifyRun({ run: r, attempt: 1, rexDir: ".ndx/rex" }).class).toBe("no-changes");
    expect(classify(r).class).toBe("unclassified");
  });

  it("unclassified: a record matching no rule is not guessed at", () => {
    const d = classify(run({ error: "something odd" }));
    expect(d.class).toBe("unclassified");
    expect(d.evidence).toContain("error: something odd");
  });

  it("a cancelled run with no commits is not read as no-changes, and says it was cancelled", () => {
    const d = classify(run({ status: "cancelled", commits: [] }));
    expect(d.class).toBe("unclassified");
    expect(d.summary).toBe("The run was cancelled before it finished.");
    expect(d.actions.map((a) => a.kind)).not.toContain("tighten-done-when");
  });

  it("a record written before commits were recorded is not read as no-changes", () => {
    expect(classify(run({ commits: undefined })).class).toBe("unclassified");
  });

  it("a failed gate with no file in its digest is not guessed at either", () => {
    expect(classify(run({ testGate: failedGate("Process exited with code 1") })).class).toBe("unclassified");
  });

  it("every class it returns is a declared class", () => {
    expect(RUN_VERDICT_CLASSES).toContain(classify(run()).class);
  });
});

describe("classifyRun — attempts", () => {
  const timeout = run({ status: "timeout" });
  const held = run({ completionHold: { outcome: "not-applied" } });

  it("at attempt 1 the ranked actions may re-run", () => {
    const d = classify(held, { attempt: 1 });
    expect(d.attempt).toEqual({ n: 1, of: 2 });
    expect(d.actions[0]!.kind).toBe("fresh");
  });

  it("at attempt 2 no action re-runs, and the first is a follow-up fix or a split", () => {
    for (const r of [held, timeout, run({ status: "error_transient" }), run({ claimLost: { at: "t", taskId: "task-1", holderWorktree: "/o" } })]) {
      const d = classify(r, { attempt: 2 });
      expect(d.attempt).toEqual({ n: 2, of: 2 });
      expect(d.actions.some((a) => ["re-run", "fresh", "retry-later"].includes(a.kind))).toBe(false);
      expect(["follow-up-run", "split-task"]).toContain(d.actions[0]!.kind);
    }
  });

  it("caps n at 2", () => {
    expect(classify(timeout, { attempt: 5 }).attempt).toEqual({ n: 2, of: 2 });
  });

  it("countAttempts counts finished, non-completed runs of the same task up to this one", () => {
    const current = run({ id: "r3", startedAt: "2026-10-28T12:00:00.000Z" });
    const runs = [
      run({ id: "r1", startedAt: "2026-10-28T08:00:00.000Z", status: "timeout" }),
      run({ id: "r2", startedAt: "2026-10-28T09:00:00.000Z", status: "completed" }),
      run({ id: "r4", startedAt: "2026-10-28T13:00:00.000Z", status: "failed" }),
      run({ id: "r5", startedAt: "2026-10-28T07:00:00.000Z", taskId: "other" }),
      run({ id: "r6", startedAt: "2026-10-28T07:30:00.000Z", status: "failed", finishedAt: undefined }),
      { ...current },
    ];
    expect(countAttempts(current, runs)).toBe(2);
  });
});

describe("classifyRun — purity", () => {
  it("the module imports no node built-in and reads no clock or process state", () => {
    const source = readFileSync(fileURLToPath(new URL("../../../src/agent/analysis/run-verdict.ts", import.meta.url)), "utf-8");
    expect(source).not.toMatch(/from "node:/);
    expect(source).not.toMatch(/\bDate\b|\bprocess\.|Math\.random/);
  });

  it("returns the same verdict for the same input", () => {
    const r = run({ status: "timeout" });
    expect(classify(r)).toEqual(classify(r));
  });
});
