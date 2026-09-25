import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Tests for the adversarial review pass's pure half — prompt construction and
 * report parsing.
 *
 * The spawn lives in cli-loop.ts and is exercised by integration tests. What
 * matters here is that a garbled or absent report can never be mistaken for a
 * clean review, and that the brief actually carries the constraints the pass
 * depends on (scope bounds, no-commit, where to write the report).
 */

import {
  buildReviewSystemPrompt,
  buildReviewBrief,
  parseReviewReport,
  readReviewReport,
  reviewReportPath,
  formatReviewSummary,
  unresolvedFindings,
  classifyUnresolved,
  formatUnresolvedWarning,
  reviewNeverRan,
  formatMissingReviewRefusal,
  formatRunReviewStatus,
  deriveDisposition,
  parkDeferredFindings,
  deferredFindings,
  formatDeferredFindings,
  REVIEW_REPORT_SUBDIR,
  REVIEW_DISPOSITIONS,
} from "../../../src/agent/analysis/adversarial-review.js";
import type { RunReviewRecord } from "../../../src/schema/index.js";
import type {
  ReviewReport,
  ReviewFinding,
  ReviewPromptContext,
} from "../../../src/agent/analysis/adversarial-review.js";
import { RM_RETRY } from "../../helpers/index.js";

const BASE_CTX: ReviewPromptContext = {
  taskId: "task-abc",
  taskTitle: "Add retry backoff to the fetch client",
  startingHead: "a1b2c3d",
  reportPath: "/proj/.hench/reviews/run-1.json",
  resumed: true,
  autonomous: true,
};

function finding(over: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    title: "Retry loop never terminates on a 429 without Retry-After",
    location: "src/fetch.ts:88",
    severity: "high",
    verdict: "must-fix",
    scenario: "Server returns 429 with no Retry-After -> delay stays 0 -> hot loop",
    action: "fixed",
    ...over,
  };
}

function report(over: Partial<ReviewReport> = {}): ReviewReport {
  return {
    taskId: "task-abc",
    findings: [],
    fixesApplied: false,
    summary: "Attacked input validation and the retry path.",
    ...over,
  };
}

describe("reviewReportPath", () => {
  it("keys the report by run id, not task id, so a re-review keeps both", () => {
    const first = reviewReportPath("/proj/.hench", "run-1");
    const second = reviewReportPath("/proj/.hench", "run-2");

    expect(first).toBe(join("/proj/.hench", REVIEW_REPORT_SUBDIR, "run-1.json"));
    expect(first).not.toBe(second);
  });
});

describe("buildReviewSystemPrompt", () => {
  it("tells a resumed reviewer to attack its own prior reasoning", () => {
    const prompt = buildReviewSystemPrompt();

    expect(prompt).toMatch(/EVIDENCE, not something to defend/);
    expect(prompt).toMatch(/attack it first and hardest/);
  });

  it("requires a constructible failure trigger and a refutation attempt", () => {
    const prompt = buildReviewSystemPrompt();

    expect(prompt).toMatch(/concrete failure trigger/);
    expect(prompt).toMatch(/the finding does not exist/);
    expect(prompt).toMatch(/go looking for the guard/);
  });
});

describe("buildReviewBrief", () => {
  it("bounds the scope to the run's own change when the pre-run HEAD is known", () => {
    const brief = buildReviewBrief(BASE_CTX);

    expect(brief).toContain("git diff a1b2c3d..HEAD");
    expect(brief).toMatch(/Do NOT review the whole branch/);
    expect(brief).toMatch(/`out-of-scope`/);
  });

  it("falls back to working-tree scope and says so when the pre-run HEAD is unknown", () => {
    const brief = buildReviewBrief({ ...BASE_CTX, startingHead: undefined });

    expect(brief).not.toContain("..HEAD");
    expect(brief).toMatch(/scope the review to the/);
    expect(brief).toMatch(/Say in your summary that the/);
  });

  it("re-establishes task context only for a fresh reviewer", () => {
    const fresh = buildReviewBrief({ ...BASE_CTX, resumed: false });
    const resumed = buildReviewBrief(BASE_CTX);

    expect(fresh).toContain("task-abc — Add retry backoff to the fetch client");
    expect(fresh).toMatch(/get_item/);
    expect(resumed).toMatch(/task you were just working on/);
    expect(resumed).not.toMatch(/You do not have that agent's context/);
  });

  it("applies the verdict policy itself when no human is attached", () => {
    const brief = buildReviewBrief(BASE_CTX);

    expect(brief).toMatch(/Do not stop to ask/);
    expect(brief).toMatch(/Capture as a PRD task with `add_item`/);
  });

  it("leaves the capture choice to the operator when the run is attended, without waiting for it", () => {
    // The reviewer is headless even on an attended run, so it can never hear
    // a selection (95b81c0a). It reports; the run queues; the operator picks.
    const brief = buildReviewBrief({ ...BASE_CTX, autonomous: false });

    expect(brief).toMatch(/Do not stop to ask, and do not capture/);
    expect(brief).toMatch(/cannot receive a\s+reply/);
    expect(brief).toMatch(/the run queues it for the operator/);
    expect(brief).not.toMatch(/wait for an explicit selection/);
    expect(brief).not.toMatch(/capture only what the user selects/);
    expect(brief).not.toMatch(/Capture as a PRD task with `add_item`/);
  });

  it("names the exact report path and the schema fields the parser reads", () => {
    const brief = buildReviewBrief(BASE_CTX);

    expect(brief).toContain("/proj/.hench/reviews/run-1.json");
    for (const field of ["findings", "fixesApplied", "summary", "severity", "verdict", "action", "disposition", "reason"]) {
      expect(brief).toContain(`"${field}"`);
    }
  });

  it("documents disposition as its own closed set, mapped from verdict", () => {
    const brief = buildReviewBrief(BASE_CTX);

    expect(brief).toMatch(/fixed \| dropped \| offered \| deferred/);
    expect(brief).toMatch(/every finding needs one/);
    // The autonomous should-fix row records an `offered` disposition even
    // though it captures automatically — `action`/`itemId` carry accept vs
    // decline, not `disposition`.
    expect(brief).toMatch(/`should-fix`.*`captured`.*`offered`/);
  });

  it("forbids the state-mutating operations that would collide with the run", () => {
    const brief = buildReviewBrief(BASE_CTX);

    expect(brief).toMatch(/Do not commit/);
    expect(brief).toMatch(/Do not change the task's status/);
    for (const cmd of ["ndx ci", "ndx plan", "ndx analyze", "ndx refresh"]) {
      expect(brief).toContain(cmd);
    }
  });
});

describe("parseReviewReport", () => {
  it("parses a well-formed report", () => {
    const parsed = parseReviewReport(
      JSON.stringify({
        taskId: "task-abc",
        fixesApplied: true,
        summary: "Attacked the retry path.",
        findings: [
          {
            title: "Hot loop on 429",
            location: "src/fetch.ts:88",
            severity: "high",
            verdict: "must-fix",
            scenario: "429 without Retry-After",
            action: "fixed",
          },
        ],
      }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed!.fixesApplied).toBe(true);
    expect(parsed!.findings).toHaveLength(1);
    expect(parsed!.findings[0].severity).toBe("high");
    expect(parsed!.findings[0].action).toBe("fixed");
  });

  it("accepts an empty findings array — a clean attack is a real result", () => {
    const parsed = parseReviewReport(
      JSON.stringify({ taskId: "t", fixesApplied: false, summary: "Nothing found.", findings: [] }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed!.findings).toEqual([]);
  });

  it.each([
    ["not JSON at all", "I reviewed the change and it looks fine!"],
    ["a JSON array", "[]"],
    ["a JSON scalar", '"done"'],
    ["null", "null"],
    ["an object with no findings array", '{"summary":"looks fine"}'],
    ["an object whose findings is not an array", '{"findings":"none"}'],
  ])("rejects %s rather than reporting a clean review", (_label, raw) => {
    expect(parseReviewReport(raw)).toBeNull();
  });

  it("coerces an unrecognized severity to critical, not to a safe default", () => {
    const parsed = parseReviewReport(
      JSON.stringify({
        findings: [{ title: "x", severity: "cosmetic", verdict: "must-fix", scenario: "s", action: "fixed" }],
      }),
    );

    expect(parsed!.findings[0].severity).toBe("critical");
  });

  it("coerces an unrecognized action to failed so it cannot read as resolved", () => {
    const parsed = parseReviewReport(
      JSON.stringify({
        findings: [{ title: "x", severity: "low", verdict: "should-fix", scenario: "s", action: "handled" }],
      }),
    );

    expect(parsed!.findings[0].action).toBe("failed");
  });

  it("drops non-object entries from findings instead of failing the whole report", () => {
    const parsed = parseReviewReport(
      JSON.stringify({ findings: [null, "oops", { title: "real", severity: "low", verdict: "low" }] }),
    );

    expect(parsed!.findings).toHaveLength(1);
    expect(parsed!.findings[0].title).toBe("real");
  });

  it("treats a missing fixesApplied as false rather than truthy", () => {
    const parsed = parseReviewReport(JSON.stringify({ findings: [], fixesApplied: "yes" }));

    expect(parsed!.fixesApplied).toBe(false);
  });

  describe("disposition", () => {
    it.each(REVIEW_DISPOSITIONS)("parses a %s disposition, with its reason", (disposition) => {
      const parsed = parseReviewReport(
        JSON.stringify({
          findings: [
            {
              title: "x",
              severity: "low",
              verdict: "not-worth-fixing",
              scenario: "s",
              action: "dropped",
              disposition,
              reason: `why it is ${disposition}`,
            },
          ],
        }),
      );

      expect(parsed!.findings[0].disposition).toBe(disposition);
      expect(parsed!.findings[0].reason).toBe(`why it is ${disposition}`);
    });

    it("leaves disposition undefined rather than guessing, on a report predating the field", () => {
      // Old reports never wrote `disposition` or `reason` at all — the absent
      // case, distinct from the present-but-invalid case below.
      const parsed = parseReviewReport(
        JSON.stringify({
          findings: [{ title: "x", severity: "low", verdict: "must-fix", scenario: "s", action: "fixed" }],
        }),
      );

      expect(parsed!.findings[0].disposition).toBeUndefined();
      expect(parsed!.findings[0].reason).toBeUndefined();
    });

    it("leaves disposition undefined on an unrecognized value, rather than coercing to an alarming default", () => {
      // Unlike severity/verdict/action, there is no fallback that is safe to
      // guess here — an old-format record and a garbled new one must both
      // come through as "unknown", not as a fabricated fate.
      const parsed = parseReviewReport(
        JSON.stringify({
          findings: [
            { title: "x", severity: "low", verdict: "must-fix", scenario: "s", action: "fixed", disposition: "ignored" },
          ],
        }),
      );

      expect(parsed!.findings[0].disposition).toBeUndefined();
    });

    it("loads a pre-disposition record fixture unchanged", async () => {
      const raw = await readFile(
        join(import.meta.dirname, "../../fixtures/review-report-pre-disposition.json"),
        "utf-8",
      );

      const parsed = parseReviewReport(raw);

      expect(parsed).not.toBeNull();
      expect(parsed!.findings).toHaveLength(2);
      for (const f of parsed!.findings) {
        expect(f.disposition).toBeUndefined();
        expect(f.reason).toBeUndefined();
      }
      expect(parsed!.findings[0].action).toBe("fixed");
      expect(parsed!.findings[1].action).toBe("dropped");
    });
  });
});

describe("readReviewReport", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-review-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("distinguishes a missing report from a malformed one", async () => {
    const missing = await readReviewReport(join(dir, "absent.json"));
    expect(missing.ok).toBe(false);
    expect(missing.ok === false && missing.reason).toBe("no-report");

    const badPath = join(dir, "bad.json");
    await writeFile(badPath, "the review went well", "utf-8");
    const malformed = await readReviewReport(badPath);
    expect(malformed.ok).toBe(false);
    expect(malformed.ok === false && malformed.reason).toBe("malformed-report");
  });

  it("reads a report written to the canonical path", async () => {
    const henchDir = join(dir, ".hench");
    const path = reviewReportPath(henchDir, "run-9");
    await mkdir(join(henchDir, REVIEW_REPORT_SUBDIR), { recursive: true });
    await writeFile(path, JSON.stringify({ findings: [], summary: "clean" }), "utf-8");

    const outcome = await readReviewReport(path);

    expect(outcome.ok).toBe(true);
    expect(outcome.ok === true && outcome.report.summary).toBe("clean");
  });
});

describe("classifyUnresolved", () => {
  it("separates unrepaired must-fix from other failed actions", () => {
    const { unrepairedMustFix, failedActions, all } = classifyUnresolved(
      report({
        findings: [
          finding({ verdict: "must-fix", action: "captured" }),
          finding({ verdict: "should-fix", action: "failed" }),
        ],
      }),
    );

    expect(unrepairedMustFix).toHaveLength(1);
    expect(unrepairedMustFix[0].verdict).toBe("must-fix");
    expect(failedActions).toHaveLength(1);
    expect(failedActions[0].verdict).toBe("should-fix");
    expect(all).toHaveLength(2);
  });

  it("counts a failed must-fix once, as unrepaired must-fix", () => {
    // Both predicates match it. Reporting it in each bucket would double the
    // headline count and overstate how much is wrong.
    const { unrepairedMustFix, failedActions, all } = classifyUnresolved(
      report({ findings: [finding({ verdict: "must-fix", action: "failed" })] }),
    );

    expect(unrepairedMustFix).toHaveLength(1);
    expect(failedActions).toEqual([]);
    expect(all).toHaveLength(1);
  });

  it("puts the union in `all`, in report order, each finding once", () => {
    const r = report({
      findings: [
        finding({ verdict: "must-fix", action: "failed" }),
        finding({ verdict: "must-fix", action: "captured" }),
        finding({ verdict: "should-fix", action: "failed" }),
        finding({ verdict: "must-fix", action: "fixed" }),
        finding({ verdict: "not-worth-fixing", action: "dropped" }),
      ],
    });

    // Asserted against literal membership rather than against
    // `unresolvedFindings`, which delegates here and so could never disagree.
    expect(classifyUnresolved(r).all.map((f) => `${f.verdict}/${f.action}`)).toEqual([
      "must-fix/failed",
      "must-fix/captured",
      "should-fix/failed",
    ]);
    expect(unresolvedFindings(r)).toEqual(classifyUnresolved(r).all);
  });
});

describe("formatUnresolvedWarning", () => {
  it("says nothing when every finding resolved", () => {
    expect(
      formatUnresolvedWarning(
        report({ findings: [finding({ verdict: "must-fix", action: "fixed" })] }),
      ),
    ).toEqual([]);
  });

  it("does not call a failed non-must-fix capture an unrepaired must-fix", () => {
    // The bug this pins: run 4b4526c5's single unresolved finding was a
    // low/should-fix whose PRD capture failed, and the console still claimed
    // "1 must-fix finding(s) were not repaired".
    const lines = formatUnresolvedWarning(
      report({
        findings: [finding({ severity: "low", verdict: "should-fix", action: "failed" })],
      }),
    );

    expect(lines.join("\n")).not.toContain("must-fix finding(s) were not repaired");
    expect(lines.join("\n")).toContain("could not be processed");
  });

  it("labels an unrepaired must-fix as one", () => {
    const lines = formatUnresolvedWarning(
      report({ findings: [finding({ verdict: "must-fix", action: "captured" })] }),
    );

    expect(lines.join("\n")).toContain("1 must-fix finding(s) were not repaired");
    expect(lines.join("\n")).not.toContain("could not be processed");
  });

  it("reports both groups separately when both are present", () => {
    const lines = formatUnresolvedWarning(
      report({
        findings: [
          finding({ verdict: "must-fix", action: "captured" }),
          finding({ verdict: "must-fix", action: "dropped" }),
          finding({ verdict: "should-fix", action: "failed" }),
        ],
      }),
    );
    const text = lines.join("\n");

    expect(text).toContain("2 must-fix finding(s) were not repaired");
    expect(text).toContain("1 finding(s) below must-fix could not be processed");
    expect(text).toContain("Inspect them before trusting this commit.");
  });
});

describe("unresolvedFindings", () => {
  it("flags a must-fix that was not actually fixed", () => {
    const unresolved = unresolvedFindings(
      report({ findings: [finding({ verdict: "must-fix", action: "captured" })] }),
    );

    expect(unresolved).toHaveLength(1);
  });

  it("flags any finding recorded as failed, whatever its verdict", () => {
    const unresolved = unresolvedFindings(
      report({ findings: [finding({ verdict: "should-fix", action: "failed" })] }),
    );

    expect(unresolved).toHaveLength(1);
  });

  it("leaves fixed, captured, and deliberately dropped findings alone", () => {
    const unresolved = unresolvedFindings(
      report({
        findings: [
          finding({ verdict: "must-fix", action: "fixed" }),
          finding({ verdict: "should-fix", action: "captured" }),
          finding({ verdict: "not-worth-fixing", action: "dropped" }),
          finding({ verdict: "out-of-scope", action: "captured" }),
        ],
      }),
    );

    expect(unresolved).toEqual([]);
  });
});

describe("formatReviewSummary", () => {
  it("states plainly when the attack found nothing, and keeps the summary", () => {
    const lines = formatReviewSummary(report({ summary: "Attacked concurrency and platform paths." }));

    expect(lines[0]).toBe("No findings.");
    expect(lines).toContain("Attacked concurrency and platform paths.");
  });

  it("renders every finding — no truncation, since hiding results is the failure mode", () => {
    const findings = Array.from({ length: 12 }, (_, i) =>
      finding({ title: `Finding ${i}`, action: "captured", verdict: "should-fix" }),
    );

    const rendered = formatReviewSummary(report({ findings })).join("\n");

    for (let i = 0; i < 12; i++) expect(rendered).toContain(`Finding ${i}`);
    expect(rendered).not.toMatch(/\d+ more/);
  });

  it("headlines the per-action tally", () => {
    const lines = formatReviewSummary(
      report({
        findings: [
          finding({ action: "fixed" }),
          finding({ action: "fixed" }),
          finding({ action: "captured", verdict: "should-fix" }),
          finding({ action: "dropped", verdict: "not-worth-fixing" }),
        ],
      }),
    );

    expect(lines[0]).toBe("4 finding(s): 2 fixed, 1 captured, 1 dropped");
  });

  it("surfaces the captured item id so the PRD link is not lost", () => {
    const rendered = formatReviewSummary(
      report({ findings: [finding({ action: "captured", verdict: "should-fix", itemId: "itm-42" })] }),
    ).join("\n");

    expect(rendered).toContain("captured as itm-42");
  });

  it("prints the disposition and reason when the finding carries one", () => {
    const rendered = formatReviewSummary(
      report({
        findings: [
          finding({
            action: "captured",
            verdict: "should-fix",
            disposition: "offered",
            reason: "declined by user",
          }),
        ],
      }),
    ).join("\n");

    expect(rendered).toContain("disposition: offered — declined by user");
  });

  it("omits the disposition line entirely on a pre-disposition finding", () => {
    const rendered = formatReviewSummary(report({ findings: [finding({ action: "fixed" })] })).join(
      "\n",
    );

    expect(rendered).not.toContain("disposition:");
  });
});

/**
 * The parking mechanism autonomous runs use instead of a capture prompt.
 *
 * The defect these cover: a reviewer that offers a should-fix and gets no
 * answer records it as `dropped`, and the finding then exists only in
 * scrollback. The run must not take the reviewer's word for a fate nobody
 * decided, so the disposition is derived from `action` + `verdict` — the two
 * fields the reviewer has always emitted and that `classifyUnresolved`
 * already trusts — rather than read off the reviewer's own bookkeeping.
 */
describe("deriveDisposition", () => {
  it("calls a repaired finding fixed", () => {
    expect(deriveDisposition(finding({ action: "fixed" }))).toBe("fixed");
  });

  it("calls a finding that reached the PRD offered", () => {
    expect(
      deriveDisposition(finding({ action: "captured", verdict: "should-fix", itemId: "itm-7" })),
    ).toBe("offered");
  });

  it("calls a reasoned-away finding dropped", () => {
    expect(deriveDisposition(finding({ action: "dropped", verdict: "not-worth-fixing" }))).toBe(
      "dropped",
    );
  });

  it.each([
    ["a should-fix nobody answered for", { action: "dropped", verdict: "should-fix" }],
    ["an out-of-scope nobody answered for", { action: "dropped", verdict: "out-of-scope" }],
    ["an unrepaired must-fix", { action: "dropped", verdict: "must-fix" }],
    ["a capture with no item to show for it", { action: "captured", verdict: "should-fix" }],
    ["an action that failed", { action: "failed", verdict: "should-fix" }],
  ] as const)("defers %s", (_label, over) => {
    expect(deriveDisposition(finding(over))).toBe("deferred");
  });

  it("ignores a reviewer-written disposition that contradicts what it did", () => {
    // The reviewer's bookkeeping is the thing that failed. A `dropped` claimed
    // on a should-fix that was never answered for is exactly the fabrication
    // this derivation exists to overrule.
    expect(
      deriveDisposition(
        finding({ action: "dropped", verdict: "should-fix", disposition: "dropped" }),
      ),
    ).toBe("deferred");
  });
});

describe("parkDeferredFindings", () => {
  it("leaves every finding with a disposition", () => {
    const parked = parkDeferredFindings(
      report({
        findings: [
          finding({ action: "fixed" }),
          finding({ action: "dropped", verdict: "should-fix" }),
          finding({ action: "dropped", verdict: "not-worth-fixing" }),
        ],
      }),
    );

    expect(parked.findings.map((f) => f.disposition)).toEqual(["fixed", "deferred", "dropped"]);
  });

  it("keeps the severity and text of a deferred finding intact", () => {
    const parked = parkDeferredFindings(
      report({
        findings: [
          finding({
            title: "Claim refresh drops the holder pid",
            location: "src/process/claims.ts:88",
            severity: "high",
            verdict: "should-fix",
            scenario: "Two worktrees refresh at once -> both believe they hold the task",
            action: "dropped",
            reason: "no answer",
          }),
        ],
      }),
    );

    expect(parked.findings[0]).toMatchObject({
      title: "Claim refresh drops the holder pid",
      location: "src/process/claims.ts:88",
      severity: "high",
      verdict: "should-fix",
      scenario: "Two worktrees refresh at once -> both believe they hold the task",
      disposition: "deferred",
      reason: "no answer",
    });
  });

  it("does not mutate the report it was handed", () => {
    const original = report({ findings: [finding({ action: "dropped", verdict: "should-fix" })] });

    parkDeferredFindings(original);

    expect(original.findings[0].disposition).toBeUndefined();
  });
});

describe("deferredFindings", () => {
  it("numbers ids over every finding, not over the deferred subset", () => {
    // The id has to address the report, because that is what the operator and
    // the capture path both read. Numbering the filtered list would make `f1`
    // mean a different finding depending on which filter produced it.
    const parked = parkDeferredFindings(
      report({
        findings: [
          finding({ action: "fixed" }),
          finding({ action: "dropped", verdict: "not-worth-fixing" }),
          finding({ title: "Third", action: "dropped", verdict: "should-fix" }),
        ],
      }),
    );

    const deferred = deferredFindings(parked);

    expect(deferred).toHaveLength(1);
    expect(deferred[0].id).toBe("f3");
    expect(deferred[0].finding.title).toBe("Third");
  });

  it("is empty when nothing was parked", () => {
    expect(deferredFindings(report({ findings: [finding({ action: "fixed" })] }))).toEqual([]);
  });
});

describe("formatDeferredFindings", () => {
  it("prints the id, severity, verdict, location and scenario of each finding", () => {
    const parked = parkDeferredFindings(
      report({
        findings: [
          finding({
            title: "Claim refresh drops the holder pid",
            location: "src/process/claims.ts:88",
            severity: "high",
            verdict: "should-fix",
            scenario: "Two worktrees refresh at once -> both run the task",
            action: "dropped",
          }),
        ],
      }),
    );

    const text = formatDeferredFindings(
      "run-1",
      "/proj/.hench/reviews/run-1.json",
      deferredFindings(parked),
    ).join("\n");

    expect(text).toContain("1 deferred finding(s)");
    expect(text).toContain("run-1");
    expect(text).toContain("/proj/.hench/reviews/run-1.json");
    expect(text).toContain("f1");
    expect(text).toContain("high/should-fix");
    expect(text).toContain("Claim refresh drops the holder pid");
    expect(text).toContain("src/process/claims.ts:88");
    expect(text).toContain("Two worktrees refresh at once -> both run the task");
  });

  it("says so plainly when there is nothing parked", () => {
    const text = formatDeferredFindings("run-1", "/p/r.json", []).join("\n");

    expect(text).toContain("No deferred findings");
    expect(text).not.toContain("deferred finding(s)");
  });
});

/**
 * The classification the missing-review gate rests on.
 *
 * Only two of the four failure reasons mean nobody attacked the change. Widen
 * this set and a lost report starts failing valid tasks; narrow it and a
 * reviewer that returned 400 goes back to reading as a clean pass.
 */
describe("reviewNeverRan", () => {
  const failed = (reason: string): RunReviewRecord => ({ failed: reason, detail: "d" });

  const clean: RunReviewRecord = {
    model: "claude-opus-5",
    resumedSession: true,
    findingCount: 0,
    unresolvedCount: 0,
    unrepairedMustFixCount: 0,
    failedActionCount: 0,
    fixesApplied: false,
    reportPath: "/proj/.hench/reviews/run-1.json",
  };

  it("is true when the reviewer session never started", () => {
    expect(reviewNeverRan(failed("spawn-failed"))).toBe(true);
    expect(reviewNeverRan(failed("unsupported-vendor"))).toBe(true);
  });

  it("is false when a reviewer ran and only its report was lost", () => {
    expect(reviewNeverRan(failed("no-report"))).toBe(false);
    expect(reviewNeverRan(failed("malformed-report"))).toBe(false);
  });

  it("is false for a successful pass and for no pass at all", () => {
    expect(reviewNeverRan(clean)).toBe(false);
    expect(reviewNeverRan(undefined)).toBe(false);
  });

  it("names the missing review, the vendor's detail, and the way out", () => {
    const text = formatMissingReviewRefusal({
      failed: "spawn-failed",
      detail: "API Error: 400 ... version 2.1.251 or newer is required",
    });

    expect(text).toContain("adversarial review never ran");
    expect(text).toContain("spawn-failed");
    expect(text).toContain("2.1.251");
    expect(text).toContain("--review-optional");
  });

  it("renders an end-of-run line that cannot be read as a clean review", () => {
    const missing = formatRunReviewStatus(failed("spawn-failed")).join("\n");
    expect(missing).toContain("NEVER RAN");
    expect(missing).toContain("NOT reviewed");

    const lost = formatRunReviewStatus(failed("no-report")).join("\n");
    expect(lost).toContain("PRODUCED NO REPORT");

    // A clean pass says zero findings — the state the failure lines must never
    // be confusable with.
    expect(formatRunReviewStatus(clean)).toEqual(["Review: 0 finding(s) (claude-opus-5)"]);
    expect(formatRunReviewStatus({ ...clean, findingCount: 3, unresolvedCount: 1 })).toEqual([
      "Review: 3 finding(s), 1 unresolved (claude-opus-5)",
    ]);
  });

  it("prints nothing when --review was not passed", () => {
    expect(formatRunReviewStatus(undefined)).toEqual([]);
  });

  /**
   * The end-of-run line is the only place a deferred finding is announced.
   * Without it the parking mechanism would move findings from "lost in
   * scrollback" to "lost in a file nobody is told about".
   */
  describe("deferred findings", () => {
    const withDeferred: RunReviewRecord = {
      ...clean,
      findingCount: 4,
      unresolvedCount: 1,
      deferredCount: 2,
    };

    it("names the count and the record path", () => {
      const text = formatRunReviewStatus(withDeferred).join("\n");

      expect(text).toContain("2 deferred");
      expect(text).toContain("/proj/.hench/reviews/run-1.json");
    });

    it("gives the command that lists them when the run id is known", () => {
      const text = formatRunReviewStatus(withDeferred, "run-1").join("\n");

      expect(text).toContain("hench review pending run-1");
    });

    it("stays silent about deferral on a record that predates the field", () => {
      // Existing .hench/runs/*.json carry no deferredCount. They must not
      // grow a "0 deferred" line that implies the run considered the question.
      expect(formatRunReviewStatus(clean, "run-1")).toEqual([
        "Review: 0 finding(s) (claude-opus-5)",
      ]);
      expect(formatRunReviewStatus({ ...clean, deferredCount: 0 }, "run-1")).toEqual([
        "Review: 0 finding(s) (claude-opus-5)",
      ]);
    });
  });
});
