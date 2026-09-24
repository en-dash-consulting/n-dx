import { describe, it, expect, afterEach } from "vitest";
import type { RunRecord } from "../../../../src/schema/index.js";

/**
 * The run summary must name one of exactly three outcomes and keep its
 * Status/Summary/Error lines consistent with it:
 *
 *  1. work_failed                    — the task itself failed.
 *  2. work_completed                 — the task succeeded and the PRD
 *                                       record commit landed.
 *  3. work_completed_record_pending  — the task succeeded but the follow-up
 *                                       PRD record (bookkeeping) commit did
 *                                       not land.
 *
 * Before this fix, `run.status` alone drove the summary: a record-commit
 * failure flips `status` to `"failed"`, so the printer showed
 * "Status: failed" beside "Summary: Task complete, working tree clean" and
 * "Changes: none" even when commits had landed. These tests fix each of the
 * three outcomes with a minimal fixture RunRecord and assert the rendered
 * lines agree with each other.
 */

// Reset color env between tests — colorStatus/colorWarn/red read it lazily.
async function resetColor() {
  const { resetColorCache } = await import("@n-dx/llm-client");
  resetColorCache();
}

function clearColorEnv() {
  delete process.env.FORCE_COLOR;
  delete process.env.NO_COLOR;
}

function baseRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    taskId: "task-1",
    taskTitle: "Do the thing",
    startedAt: "2026-09-22T00:00:00.000Z",
    finishedAt: "2026-09-22T00:01:00.000Z",
    status: "completed",
    turns: 1,
    tokenUsage: { input: 100, output: 50 },
    toolCalls: [],
    model: "sonnet",
    ...overrides,
  };
}

describe("classifyRunOutcome", () => {
  afterEach(() => {
    clearColorEnv();
  });

  it("is work_failed for a failed run with no recordCommitPending", async () => {
    const { classifyRunOutcome } = await import("../../../../src/cli/commands/run.js");
    const run = baseRun({ status: "failed", error: "boom" });
    expect(classifyRunOutcome(run)).toBe("work_failed");
  });

  it("is work_completed for a completed run with no recordCommitPending", async () => {
    const { classifyRunOutcome } = await import("../../../../src/cli/commands/run.js");
    const run = baseRun({ status: "completed" });
    expect(classifyRunOutcome(run)).toBe("work_completed");
  });

  it("is work_completed_record_pending when recordCommitPending is set, even though status reads failed", async () => {
    // Legacy record shape: before WM2085 a record-commit failure also flipped
    // status to "failed" and set a bare boolean.
    const { classifyRunOutcome } = await import("../../../../src/cli/commands/run.js");
    const run = baseRun({
      status: "failed",
      recordCommitPending: true,
      error: "Could not commit completion metadata: EACCES",
    });
    expect(classifyRunOutcome(run)).toBe("work_completed_record_pending");
  });

  it("is work_completed_record_pending for a completed run carrying the pending record's paths", async () => {
    // Current shape (WM2085): the run stays completed and the field carries
    // the paths the record commit tried to stage.
    const { classifyRunOutcome } = await import("../../../../src/cli/commands/run.js");
    const run = baseRun({
      status: "completed",
      recordCommitPending: {
        paths: [".rex/prd_tree/task/index.md", ".rex/tree-meta.json"],
        error: "pre-commit hook rejected completion metadata",
      },
    });
    expect(classifyRunOutcome(run)).toBe("work_completed_record_pending");
  });
});

describe("formatRunStatusLine", () => {
  afterEach(async () => {
    clearColorEnv();
    await resetColor();
  });

  it("prints the raw status for a failed run", async () => {
    clearColorEnv();
    await resetColor();
    const { formatRunStatusLine } = await import("../../../../src/cli/commands/run.js");
    const run = baseRun({ status: "failed" });
    expect(formatRunStatusLine(run)).toBe("Status: failed");
  });

  it("prints the raw status for a completed run with its record committed", async () => {
    clearColorEnv();
    await resetColor();
    const { formatRunStatusLine } = await import("../../../../src/cli/commands/run.js");
    const run = baseRun({ status: "completed" });
    expect(formatRunStatusLine(run)).toBe("Status: completed");
  });

  it("reports completed with a record-pending qualifier, not the raw failed status", async () => {
    clearColorEnv();
    await resetColor();
    const { formatRunStatusLine } = await import("../../../../src/cli/commands/run.js");
    const run = baseRun({ status: "failed", recordCommitPending: true });
    const line = formatRunStatusLine(run);
    expect(line).toContain("completed");
    expect(line).toContain("record commit pending");
    expect(line).not.toContain("failed");
  });
});

describe("formatRunCommitsLines", () => {
  it("returns an empty array for undefined commits", async () => {
    const { formatRunCommitsLines } = await import("../../../../src/cli/commands/run.js");
    expect(formatRunCommitsLines(undefined)).toEqual([]);
  });

  it("returns an empty array for an empty commits list", async () => {
    const { formatRunCommitsLines } = await import("../../../../src/cli/commands/run.js");
    expect(formatRunCommitsLines([])).toEqual([]);
  });

  it("names each commit's short SHA and subject, in order", async () => {
    const { formatRunCommitsLines } = await import("../../../../src/cli/commands/run.js");
    const lines = formatRunCommitsLines([
      { sha: "abcdef1234567890", subject: "feat(hench): do the work" },
      { sha: "0123456789abcdef", subject: "chore(prd): commit PRD tree changes (task task-1 completed)" },
    ]);
    expect(lines).toEqual([
      "Commits:",
      "  abcdef12 feat(hench): do the work",
      "  01234567 chore(prd): commit PRD tree changes (task task-1 completed)",
    ]);
  });
});

describe("formatRunSummaryLine", () => {
  it("prints the LLM's summary when present, regardless of outcome", async () => {
    const { formatRunSummaryLine } = await import("../../../../src/cli/commands/run.js");
    const run = baseRun({ status: "failed", summary: "Attempted the change, hit a wall" });
    expect(formatRunSummaryLine(run)).toBe("\nSummary: Attempted the change, hit a wall");
  });

  it("is undefined when there is no summary", async () => {
    const { formatRunSummaryLine } = await import("../../../../src/cli/commands/run.js");
    const run = baseRun({ summary: undefined });
    expect(formatRunSummaryLine(run)).toBeUndefined();
  });
});

describe("formatRunErrorLine — the three-outcome block", () => {
  afterEach(async () => {
    clearColorEnv();
    await resetColor();
  });

  it("work_failed: prints the run's error", async () => {
    clearColorEnv();
    await resetColor();
    const { formatRunErrorLine } = await import("../../../../src/cli/commands/run.js");
    const run = baseRun({ status: "failed", error: "tests did not pass" });
    expect(formatRunErrorLine(run)).toBe("\nError: tests did not pass");
  });

  it("work_failed: undefined when there is no error", async () => {
    clearColorEnv();
    await resetColor();
    const { formatRunErrorLine } = await import("../../../../src/cli/commands/run.js");
    const run = baseRun({ status: "failed", error: undefined });
    expect(formatRunErrorLine(run)).toBeUndefined();
  });

  it("work_completed: no error line at all", async () => {
    clearColorEnv();
    await resetColor();
    const { formatRunErrorLine } = await import("../../../../src/cli/commands/run.js");
    const run = baseRun({ status: "completed" });
    expect(formatRunErrorLine(run)).toBeUndefined();
  });

  it("work_completed_record_pending: a Record: line, not an Error: line", async () => {
    clearColorEnv();
    await resetColor();
    const { formatRunErrorLine } = await import("../../../../src/cli/commands/run.js");
    const run = baseRun({
      status: "failed",
      recordCommitPending: true,
      error: "Could not commit completion metadata: EACCES",
    });
    const line = formatRunErrorLine(run);
    expect(line).toContain("Record:");
    expect(line).not.toContain("Error:");
    expect(line).toContain("task's work is complete");
    expect(line).toContain("Could not commit completion metadata: EACCES");
  });
});

describe("the three outcomes stay consistent end-to-end (status + summary + commits)", () => {
  afterEach(async () => {
    clearColorEnv();
    await resetColor();
  });

  it("work failed: Status says failed, no phantom commits or completion summary implied", async () => {
    clearColorEnv();
    await resetColor();
    const { formatRunStatusLine, formatRunErrorLine, formatRunCommitsLines } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const run = baseRun({ status: "failed", error: "validation failed", commits: [] });
    expect(formatRunStatusLine(run)).toBe("Status: failed");
    expect(formatRunErrorLine(run)).toBe("\nError: validation failed");
    expect(formatRunCommitsLines(run.commits)).toEqual([]);
  });

  it("work succeeded, record committed: Status/Summary agree, commits are named, no error", async () => {
    clearColorEnv();
    await resetColor();
    const { formatRunStatusLine, formatRunSummaryLine, formatRunErrorLine, formatRunCommitsLines } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const run = baseRun({
      status: "completed",
      summary: "Task complete, working tree clean",
      commits: [
        { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", subject: "feat(hench): implement the task" },
        { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", subject: "chore(prd): commit PRD tree changes (task task-1 completed)" },
      ],
    });
    expect(formatRunStatusLine(run)).toBe("Status: completed");
    expect(formatRunSummaryLine(run)).toBe("\nSummary: Task complete, working tree clean");
    expect(formatRunErrorLine(run)).toBeUndefined();
    expect(formatRunCommitsLines(run.commits)).toHaveLength(3); // header + 2 commits
  });

  it("work succeeded, record uncommitted: Status and Summary no longer contradict, commits list what landed", async () => {
    clearColorEnv();
    await resetColor();
    const { formatRunStatusLine, formatRunSummaryLine, formatRunErrorLine, formatRunCommitsLines } = await import(
      "../../../../src/cli/commands/run.js"
    );
    // The exact bug scenario: status is "failed", the summary still reads as
    // success, but only the work commit landed — the record commit did not.
    const run = baseRun({
      status: "failed",
      recordCommitPending: true,
      summary: "Task complete, working tree clean",
      error: "Could not commit completion metadata: EACCES",
      commits: [{ sha: "cccccccccccccccccccccccccccccccccccccccc", subject: "feat(hench): implement the task" }],
    });

    const statusLine = formatRunStatusLine(run);
    const summaryLine = formatRunSummaryLine(run);
    const errorLine = formatRunErrorLine(run);

    // Status and Summary must agree: both describe a completed task.
    expect(statusLine).toContain("completed");
    expect(summaryLine).toContain("Task complete");
    // The old bug: "Status: failed" beside "Summary: Task complete" — gone.
    expect(statusLine).not.toContain("Status: failed");
    // No "Error:" line pretending the task itself failed.
    expect(errorLine).not.toContain("Error:");
    expect(errorLine).toContain("Record:");
    // The one commit that did land is named, not hidden behind "Changes: none".
    expect(formatRunCommitsLines(run.commits)).toEqual([
      "Commits:",
      "  cccccccc feat(hench): implement the task",
    ]);
  });
});

/**
 * Third criterion: "Changes: none" is printed only when no commit and no
 * dirty file resulted from the run.
 *
 * The scenario pinned here is the one that produced the bug report. A run
 * driven through the Claude CLI provider edited seven files and committed
 * nothing; the tool-call heuristic recognized none of those edits, so the
 * summary printed "Changes: none" three lines below a refusal that listed all
 * seven uncommitted paths. `commits` alone does not fix that case — there was
 * no commit to count — so the printer reads `uncommittedPaths` too.
 */
describe("formatChangeClassification — none means none", () => {
  const sevenPaths = [
    "packages/hench/src/agent/lifecycle/shared.ts",
    "packages/hench/src/cli/commands/run.ts",
    "packages/hench/src/schema/index.ts",
    "packages/hench/src/schema/v1.ts",
    "packages/hench/src/schema/validate.ts",
    ".changeset/run-summary-record-vs-work-failure.md",
    "packages/hench/tests/unit/cli/commands/run-outcome-summary.test.ts",
  ];

  it("prints none only when nothing was committed and the tree came out clean", async () => {
    const { formatChangeClassification } = await import("../../../../src/cli/commands/run.js");
    expect(formatChangeClassification([], [], [])).toBe("Changes: none");
    // A record written before either field existed loads with both undefined.
    expect(formatChangeClassification([], undefined, undefined)).toBe("Changes: none");
  });

  it("names the work left uncommitted rather than reporting none", async () => {
    const { formatChangeClassification } = await import("../../../../src/cli/commands/run.js");
    expect(formatChangeClassification([], [], sevenPaths)).toBe("Changes: 7 uncommitted paths");
  });

  it("names commits that the tool-call heuristic did not see", async () => {
    const { formatChangeClassification } = await import("../../../../src/cli/commands/run.js");
    const commits = [
      { sha: "a".repeat(40), subject: "fix(hench): the work" },
      { sha: "b".repeat(40), subject: "chore(prd): the record" },
    ];
    expect(formatChangeClassification([], commits, [])).toBe("Changes: 2 commits");
  });

  it("reports both halves, in the singular, when one of each resulted", async () => {
    const { formatChangeClassification } = await import("../../../../src/cli/commands/run.js");
    const commits = [{ sha: "c".repeat(40), subject: "fix(hench): the work" }];
    expect(formatChangeClassification([], commits, ["packages/hench/src/schema/v1.ts"])).toBe(
      "Changes: 1 commit, 1 uncommitted path",
    );
  });
});
