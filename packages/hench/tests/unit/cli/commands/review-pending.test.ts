import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { RunRecord, RunReviewRecord } from "../../../../src/schema/index.js";
import { saveRun } from "../../../../src/store/runs.js";
import { initConfig } from "../../../../src/store/config.js";
import type { ReviewReport } from "../../../../src/agent/analysis/adversarial-review.js";

/**
 * `hench review pending` is the only surface on which a deferred finding is
 * reachable after the run. These tests pin the two things that makes it worth
 * having: the finding's evidence survives the round trip to disk, and the
 * three "nothing to show" states stay distinguishable — a run that was never
 * reviewed must never read like a review that found nothing.
 */
describe("hench review pending", () => {
  let projectDir: string;
  let henchDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const reportPath = (): string => join(henchDir, "reviews", "run-001.json");

  const makeRun = (review?: RunReviewRecord): RunRecord => ({
    id: "run-001",
    taskId: "task-42",
    taskTitle: "Refresh task claims during a run",
    startedAt: "2026-09-22T00:00:00.000Z",
    finishedAt: "2026-09-22T00:01:00.000Z",
    status: "completed",
    turns: 5,
    tokenUsage: { input: 1000, output: 500 },
    toolCalls: [],
    model: "sonnet",
    ...(review ? { review } : {}),
  });

  const cleanReview = (over: Partial<Extract<RunReviewRecord, { model: string }>> = {}) =>
    ({
      model: "claude-opus-5",
      resumedSession: true,
      findingCount: 2,
      unresolvedCount: 0,
      unrepairedMustFixCount: 0,
      failedActionCount: 0,
      fixesApplied: true,
      reportPath: reportPath(),
      ...over,
    }) satisfies RunReviewRecord;

  /** A report as it exists on disk *after* the run has parked its findings. */
  const parkedReport = (): ReviewReport => ({
    taskId: "task-42",
    fixesApplied: true,
    summary: "Attacked the claim refresh path and the worktree fallback.",
    findings: [
      {
        title: "Refresh writes an empty holder pid",
        location: "src/process/claims.ts:88",
        severity: "critical",
        verdict: "must-fix",
        scenario: "Refresh runs mid-claim -> pid is blank -> the claim never expires",
        action: "fixed",
        disposition: "fixed",
      },
      {
        title: "Stale claim survives a crashed worktree",
        location: "src/process/claims.ts:140",
        severity: "high",
        verdict: "should-fix",
        scenario: "Worktree is SIGKILLed -> claim outlives it -> the task is never picked up",
        action: "dropped",
        disposition: "deferred",
      },
    ],
  });

  const writeReport = async (report: ReviewReport): Promise<void> => {
    await mkdir(join(henchDir, "reviews"), { recursive: true });
    await writeFile(reportPath(), JSON.stringify(report, null, 2), "utf-8");
  };

  const printed = (): string =>
    logSpy.mock.calls.map((call) => String(call[0] ?? "")).join("\n");

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-review-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("lists the deferred finding with an id, its severity and its failure scenario", async () => {
    await saveRun(henchDir, makeRun(cleanReview({ deferredCount: 1 })));
    await writeReport(parkedReport());

    const { cmdReview } = await import("../../../../src/cli/commands/review.js");
    await cmdReview(projectDir, ["pending", "run-001"], {});

    const out = printed();
    expect(out).toContain("1 deferred finding(s)");
    // The id addresses the report, so the deferred finding at index 1 is f2 —
    // not f1, which would renumber it against the report it came from.
    expect(out).toContain("f2");
    expect(out).toContain("high/should-fix");
    expect(out).toContain("Stale claim survives a crashed worktree");
    expect(out).toContain("src/process/claims.ts:140");
    expect(out).toContain("the task is never picked up");
  });

  it("does not list findings that were fixed, captured or reasoned away", async () => {
    await saveRun(henchDir, makeRun(cleanReview({ deferredCount: 1 })));
    await writeReport(parkedReport());

    const { cmdReview } = await import("../../../../src/cli/commands/review.js");
    await cmdReview(projectDir, ["pending", "run-001"], {});

    expect(printed()).not.toContain("Refresh writes an empty holder pid");
  });

  it("emits the ids alongside the full finding in JSON mode", async () => {
    await saveRun(henchDir, makeRun(cleanReview({ deferredCount: 1 })));
    await writeReport(parkedReport());

    const { cmdReview } = await import("../../../../src/cli/commands/review.js");
    await cmdReview(projectDir, ["pending", "run-001"], { format: "json" });

    const payload = JSON.parse(printed());
    expect(payload.runId).toBe("run-001");
    expect(payload.deferred).toHaveLength(1);
    expect(payload.deferred[0]).toMatchObject({
      id: "f2",
      severity: "high",
      verdict: "should-fix",
      title: "Stale claim survives a crashed worktree",
      disposition: "deferred",
    });
  });

  it("says plainly when a reviewed run parked nothing", async () => {
    await saveRun(henchDir, makeRun(cleanReview()));
    const report = parkedReport();
    report.findings[1].disposition = "offered";
    report.findings[1].action = "captured";
    report.findings[1].itemId = "itm-9";
    await writeReport(report);

    const { cmdReview } = await import("../../../../src/cli/commands/review.js");
    await cmdReview(projectDir, ["pending", "run-001"], {});

    expect(printed()).toContain("No deferred findings");
  });

  it("refuses a run that was never reviewed rather than reporting an empty queue", async () => {
    await saveRun(henchDir, makeRun());

    const { cmdReview } = await import("../../../../src/cli/commands/review.js");
    await expect(cmdReview(projectDir, ["pending", "run-001"], {})).rejects.toThrow(
      /was not reviewed/,
    );
  });

  it("refuses a run whose reviewer never produced a report", async () => {
    await saveRun(henchDir, makeRun({ failed: "spawn-failed", detail: "CLI too old" }));

    const { cmdReview } = await import("../../../../src/cli/commands/review.js");
    await expect(cmdReview(projectDir, ["pending", "run-001"], {})).rejects.toThrow(
      /spawn-failed/,
    );
  });

  it("names the report it could not read rather than claiming no findings", async () => {
    await saveRun(henchDir, makeRun(cleanReview({ deferredCount: 1 })));
    // No report file written.

    const { cmdReview } = await import("../../../../src/cli/commands/review.js");
    await expect(cmdReview(projectDir, ["pending", "run-001"], {})).rejects.toThrow(
      /Could not read the review report/,
    );
  });

  it("requires a run id", async () => {
    const { cmdReview } = await import("../../../../src/cli/commands/review.js");
    await expect(cmdReview(projectDir, ["pending"], {})).rejects.toThrow(/Missing run ID/);
  });

  it("rejects an unknown subcommand", async () => {
    const { cmdReview } = await import("../../../../src/cli/commands/review.js");
    await expect(cmdReview(projectDir, ["capture", "run-001"], {})).rejects.toThrow(
      /Unknown review subcommand/,
    );
  });
});
