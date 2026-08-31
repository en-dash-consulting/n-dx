import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
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
  REVIEW_REPORT_SUBDIR,
} from "../../../src/agent/analysis/adversarial-review.js";
import type {
  ReviewReport,
  ReviewFinding,
  ReviewPromptContext,
} from "../../../src/agent/analysis/adversarial-review.js";

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

  it("defers to the human when the run is interactive", () => {
    const brief = buildReviewBrief({ ...BASE_CTX, autonomous: false });

    expect(brief).toMatch(/Ask before capturing/);
    expect(brief).toMatch(/capture only what the user selects/);
    expect(brief).not.toMatch(/Do not stop to ask/);
  });

  it("names the exact report path and the schema fields the parser reads", () => {
    const brief = buildReviewBrief(BASE_CTX);

    expect(brief).toContain("/proj/.hench/reviews/run-1.json");
    for (const field of ["findings", "fixesApplied", "summary", "severity", "verdict", "action"]) {
      expect(brief).toContain(`"${field}"`);
    }
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
});

describe("readReviewReport", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-review-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
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
});
