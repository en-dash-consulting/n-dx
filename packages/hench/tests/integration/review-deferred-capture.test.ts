import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveReviewDispositions } from "../../src/agent/lifecycle/cli-loop.js";
import type { ReviewReport } from "../../src/agent/analysis/adversarial-review.js";
import { parseReviewReport } from "../../src/agent/analysis/adversarial-review.js";

/** Minimal parked-report input for cases that only need *a* report. */
const parkedReportInput = (): ReviewReport => ({
  taskId: "task-42",
  fixesApplied: false,
  summary: "s",
  findings: [
    {
      title: "A",
      severity: "high",
      verdict: "should-fix",
      scenario: "x -> y",
      action: "dropped",
    },
  ],
});

/**
 * The deferral round trip, across the disk boundary the CLI reads back over.
 *
 * The defect these cover: `ndx work --review --auto` ran an adversarial
 * review, the reviewer offered its should-fix findings to a prompt with nobody
 * at it, and recorded them as `dropped`. The run printed them once and moved
 * on. Across three reviewed runs in one session, one, then two, then four
 * findings were lost that way — two of them should-fix — surviving only in
 * terminal scrollback.
 *
 * The unit tests in tests/unit/agent/adversarial-review.test.ts pin what
 * counts as a deferral. What these add is that the conclusion reaches the
 * file `hench review pending` reads, and that an interactive run's report is
 * not rewritten behind the user's back.
 */
describe("autonomous review deferral", () => {
  let projectDir: string;
  let henchDir: string;
  let reportPath: string;

  /** A report exactly as a reviewer writes it before the run parks anything. */
  const reviewerReport = (): ReviewReport => ({
    taskId: "task-42",
    fixesApplied: true,
    summary: "Attacked the claim refresh path.",
    findings: [
      {
        title: "Refresh writes an empty holder pid",
        location: "src/process/claims.ts:88",
        severity: "critical",
        verdict: "must-fix",
        scenario: "Refresh runs mid-claim -> pid is blank -> the claim never expires",
        action: "fixed",
      },
      {
        // The finding the old behaviour lost: offered, unanswered, filed as a
        // decision that nobody made.
        title: "Stale claim survives a crashed worktree",
        location: "src/process/claims.ts:140",
        severity: "high",
        verdict: "should-fix",
        scenario: "Worktree is SIGKILLed -> claim outlives it -> the task is never picked up",
        action: "dropped",
        disposition: "dropped",
        reason: "declined by user",
      },
      {
        title: "Log line repeats the run id",
        severity: "low",
        verdict: "not-worth-fixing",
        scenario: "Two ids print on one line -> noisier log, no wrong behaviour",
        action: "dropped",
      },
    ],
  });

  const writeReport = async (report: ReviewReport): Promise<void> => {
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
  };

  const readBack = async (): Promise<ReviewReport> => {
    const parsed = parseReviewReport(await readFile(reportPath, "utf-8"));
    if (!parsed) throw new Error("report on disk is not parseable");
    return parsed;
  };

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-review-defer-"));
    henchDir = join(projectDir, ".hench");
    await mkdir(join(henchDir, "reviews"), { recursive: true });
    reportPath = join(henchDir, "reviews", "run-001.json");
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("parks the unanswered finding on disk, where the CLI can find it", async () => {
    await writeReport(reviewerReport());

    const { deferred } = await resolveReviewDispositions(reportPath, reviewerReport(), true);

    expect(deferred.map((d) => d.id)).toEqual(["f2"]);

    const onDisk = await readBack();
    expect(onDisk.findings.map((f) => f.disposition)).toEqual(["fixed", "deferred", "dropped"]);
  });

  it("keeps the deferred finding's severity and evidence intact through the write", async () => {
    await writeReport(reviewerReport());

    await resolveReviewDispositions(reportPath, reviewerReport(), true);

    const parked = (await readBack()).findings[1];
    expect(parked).toMatchObject({
      title: "Stale claim survives a crashed worktree",
      location: "src/process/claims.ts:140",
      severity: "high",
      verdict: "should-fix",
      scenario: "Worktree is SIGKILLed -> claim outlives it -> the task is never picked up",
      disposition: "deferred",
    });
  });

  it("overrules the reviewer's claim that a should-fix was declined", async () => {
    // There was no user, so "declined by user" is a fate nobody handed down.
    // Trusting it is exactly how the finding went missing.
    await writeReport(reviewerReport());

    await resolveReviewDispositions(reportPath, reviewerReport(), true);

    expect((await readBack()).findings[1].disposition).toBe("deferred");
  });

  /**
   * The write-back must not become a second way to lose findings.
   *
   * `parseReviewReport` is a lossy projection — ten known fields per finding,
   * and non-object entries filtered out entirely. An earlier cut of this
   * feature re-serialized that projection over the reviewer's file, which
   * erased a `proposedSolutions` array (the skill asks for solutions; this
   * brief has no field for them), a top-level note, and a finding the reviewer
   * had written as a bare string — 2 findings on disk became 1.
   */
  describe("write-back preserves what the parser cannot model", () => {
    /** A report carrying keys and an entry shape the schema never named. */
    const richReport = () => ({
      taskId: "task-42",
      fixesApplied: true,
      summary: "Attacked the claim refresh path.",
      reviewerNotes: "context the reviewer judged worth keeping",
      findings: [
        {
          title: "Stale claim survives a crashed worktree",
          severity: "high",
          verdict: "should-fix",
          scenario: "Worktree is SIGKILLed -> the task is never picked up",
          action: "dropped",
          proposedSolutions: ["option 1: expire on pid loss", "option 2: lease with a TTL"],
        },
        "a finding the reviewer wrote as a bare string",
        {
          title: "Log line repeats the run id",
          severity: "low",
          verdict: "not-worth-fixing",
          scenario: "Two ids on one line -> noisier log, no wrong behaviour",
          action: "dropped",
        },
      ],
    });

    const parkRich = async () => {
      await writeFile(reportPath, JSON.stringify(richReport(), null, 2), "utf-8");
      const parsed = parseReviewReport(await readFile(reportPath, "utf-8"));
      if (!parsed) throw new Error("fixture is not parseable");
      return resolveReviewDispositions(reportPath, parsed, true);
    };

    it("keeps a finding the parser skipped as malformed", async () => {
      await parkRich();

      const onDisk = JSON.parse(await readFile(reportPath, "utf-8"));
      expect(onDisk.findings).toHaveLength(3);
      expect(onDisk.findings[1]).toBe("a finding the reviewer wrote as a bare string");
    });

    it("keeps per-finding and top-level keys the schema never named", async () => {
      await parkRich();

      const onDisk = JSON.parse(await readFile(reportPath, "utf-8"));
      expect(onDisk.reviewerNotes).toBe("context the reviewer judged worth keeping");
      expect(onDisk.findings[0].proposedSolutions).toEqual([
        "option 1: expire on pid loss",
        "option 2: lease with a TTL",
      ]);
    });

    it("lands each disposition on the finding it belongs to across the skipped entry", async () => {
      // The trap: the parsed array is the raw array minus the bare string, so
      // the two stop sharing indices at position 1. A naive index-for-index
      // patch would write the not-worth-fixing entry's `dropped` onto the
      // string's neighbour and leave the real one unmarked.
      await parkRich();

      const onDisk = JSON.parse(await readFile(reportPath, "utf-8"));
      expect(onDisk.findings[0].disposition).toBe("deferred");
      expect(onDisk.findings[2].disposition).toBe("dropped");
    });

    it("leaves the file alone rather than overwrite it with something lossy", async () => {
      // If the merge cannot align, not writing is the correct outcome: a
      // recorded disposition is worth less than the findings it would cost.
      await writeFile(reportPath, JSON.stringify({ taskId: "t", findings: "not-an-array" }), "utf-8");
      const before = await readFile(reportPath, "utf-8");

      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await resolveReviewDispositions(reportPath, parkedReportInput(), true);
      } finally {
        spy.mockRestore();
      }

      expect(await readFile(reportPath, "utf-8")).toBe(before);
    });
  });

  it("leaves an interactive run's report exactly as the reviewer wrote it", async () => {
    const original = reviewerReport();
    await writeReport(original);
    const before = await readFile(reportPath, "utf-8");

    const { report, deferred } = await resolveReviewDispositions(reportPath, original, false);

    expect(deferred).toEqual([]);
    expect(report).toBe(original);
    expect(await readFile(reportPath, "utf-8")).toBe(before);
  });

  it("says the findings are the only copy when the record cannot be written", async () => {
    // The parked report cannot land, so `hench review pending` will come back
    // empty. Announcing that is the difference between a queue that failed and
    // a run that found nothing.
    //
    // Failure is forced with a missing parent directory (ENOENT) rather than a
    // read-only one: chmod does not deny writes on Windows, so a permission
    // fixture would silently succeed there and assert on output that was never
    // printed.
    const unwritable = join(henchDir, "reviews", "gone", "run-001.json");

    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(String(args[0] ?? ""));
    });

    try {
      const { deferred } = await resolveReviewDispositions(unwritable, reviewerReport(), true);

      // The conclusion still stands in memory, so the run record and the
      // end-of-run summary stay honest about what the pass decided.
      expect(deferred).toHaveLength(1);

      const out = logged.join("\n");
      expect(out).toContain("Could not record finding dispositions");
      expect(out).toContain("exist only in the output above");
    } finally {
      spy.mockRestore();
    }
  });
});
