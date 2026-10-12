import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Pair review's fix rounds, the pure halves: what the reviewer is told on a
 * re-check, what the executor is handed to fix, and the helpers that keep the
 * last report whole.
 */

import {
  buildPairReviewBrief,
  buildExecutorFixPrompt,
  countFixedFindings,
  carryForwardFindings,
  formatRunReviewStatus,
} from "../../../src/agent/analysis/adversarial-review.js";
import type { PairReviewPromptContext, ReviewFinding } from "../../../src/agent/analysis/adversarial-review.js";

const finding = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({
  title: "Count is never validated",
  location: "w.ts:1",
  severity: "high",
  verdict: "must-fix",
  scenario: "w is 1 -> a zero-config caller gets one item",
  expected: "a zero-config caller gets no items",
  action: "dropped",
  ...over,
});

const ctx = (over: Partial<PairReviewPromptContext> = {}): PairReviewPromptContext => ({
  taskId: "task-9",
  taskTitle: "Add the widget",
  taskBrief: "Widgets need a name.",
  startingHead: "abc1234",
  diff: "+export const w = 1;",
  changedFiles: ["w.ts"],
  reportPath: "/p/.hench/reviews/run-1.json",
  prdTreeDir: ".rex/prd_tree/",
  autonomous: true,
  testGateFollows: true,
  ...over,
});

describe("buildPairReviewBrief — fix rounds", () => {
  it("has the reviewer report must-fix findings without capturing them while the executor will fix them", () => {
    const brief = buildPairReviewBrief(ctx({ executorFixesMustFix: true }));
    expect(brief).toMatch(/`must-fix` \| Report it[^\n]*Do not capture it: the executor is asked to fix it/);
    expect(brief).not.toMatch(/`must-fix`, `should-fix`/);
  });

  it("has the last review capture a must-fix finding like any other", () => {
    const brief = buildPairReviewBrief(ctx({ executorFixesMustFix: false }));
    expect(brief).toMatch(/`must-fix`, `should-fix`, `out-of-scope` \| Capture as a PRD task/);
    expect(brief).not.toMatch(/the executor is asked to fix it/);
  });

  it("tells a re-review which findings to confirm, by title", () => {
    const brief = buildPairReviewBrief(ctx({ recheck: { round: 1, mustFix: [finding()] } }));
    expect(brief).toContain("## Previous round");
    expect(brief).toContain("Count is never validated");
    expect(brief).toContain("(w.ts:1)");
    expect(brief).toMatch(/same `title`/);
  });

  it("has no previous-round section on the first review", () => {
    expect(buildPairReviewBrief(ctx())).not.toContain("## Previous round");
  });

  it("asks for the expected behaviour in the report schema", () => {
    expect(buildPairReviewBrief(ctx())).toContain('"expected"');
  });
});

describe("buildExecutorFixPrompt", () => {
  const base = { round: 1, rounds: 2, findings: [finding()], taskTitle: "Add the widget" };

  it("lists each finding's file, failure trigger and expected behaviour", () => {
    const prompt = buildExecutorFixPrompt({ ...base, resumed: true });
    expect(prompt).toContain("round 1 of 2");
    expect(prompt).toContain("## 1. Count is never validated");
    expect(prompt).toContain("- File: w.ts:1");
    expect(prompt).toContain("- Failure trigger: w is 1 -> a zero-config caller gets one item");
    expect(prompt).toContain("- Expected behaviour: a zero-config caller gets no items");
    expect(prompt).toMatch(/nothing else/);
  });

  it("falls back when the reviewer gave no expected behaviour or file", () => {
    const prompt = buildExecutorFixPrompt({
      ...base,
      findings: [finding({ expected: undefined, location: undefined })],
      resumed: true,
    });
    expect(prompt).toContain("- File: (not given)");
    expect(prompt).toContain("the trigger above must stop producing the wrong result");
  });

  it("carries the task for a fresh session, and not for a resumed one", () => {
    const fresh = buildExecutorFixPrompt({ ...base, resumed: false, taskBrief: "Widgets need a name." });
    expect(fresh).toContain("Widgets need a name.");
    expect(fresh).toContain("git diff");
    expect(buildExecutorFixPrompt({ ...base, resumed: true, taskBrief: "Widgets need a name." })).not.toContain(
      "Widgets need a name.",
    );
  });
});

describe("countFixedFindings", () => {
  it("counts the previous findings the re-review no longer lists as must-fix, matching titles loosely", () => {
    const previous = [finding({ title: "A" }), finding({ title: "B" })];
    expect(countFixedFindings(previous, [finding({ title: " b " })])).toBe(1);
    expect(countFixedFindings(previous, [])).toBe(2);
    expect(countFixedFindings(previous, previous)).toBe(0);
  });

  it("does not count a finding that came back below must-fix as still open", () => {
    expect(countFixedFindings([finding({ title: "A" })], [finding({ title: "A", verdict: "should-fix" })])).toBe(1);
  });
});

describe("carryForwardFindings", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-carry-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = async (name: string, findings: unknown[]): Promise<string> => {
    const path = join(dir, name);
    await writeFile(path, JSON.stringify({ taskId: "t", fixesApplied: false, summary: "s", findings }), "utf-8");
    return path;
  };

  it("copies findings below must-fix that the current report lacks, keeping unmodelled keys", async () => {
    const previous = await write("a.json", [
      finding({ title: "Fix me" }),
      { ...finding({ title: "Later", verdict: "should-fix" }), proposedSolutions: ["x"] },
      finding({ title: "Already here", verdict: "should-fix" }),
    ]);
    const current = await write("b.json", [finding({ title: "already here", verdict: "should-fix" })]);

    expect(await carryForwardFindings(previous, current)).toBe(true);

    const merged = JSON.parse(await readFile(current, "utf-8")) as { findings: Array<Record<string, unknown>> };
    expect(merged.findings.map((f) => f.title)).toEqual(["already here", "Later"]);
    expect(merged.findings[1]!.proposedSolutions).toEqual(["x"]);
  });

  it("leaves the current report alone and says so when the earlier one is unreadable", async () => {
    const current = await write("b.json", [finding({ title: "Kept" })]);
    const before = await readFile(current, "utf-8");
    expect(await carryForwardFindings(join(dir, "missing.json"), current)).toBe(false);
    expect(await readFile(current, "utf-8")).toBe(before);
  });
});

describe("formatRunReviewStatus — a review that did not pass", () => {
  it("says the review did not pass, not that it never ran", () => {
    const lines = formatRunReviewStatus({
      failed: "must-fix-unresolved",
      detail: "1 must-fix finding(s) still open after 2 fix round(s).",
      reportPath: "/p/.hench/reviews/r-r2.json",
    });
    expect(lines.join("\n")).toContain("DID NOT PASS");
    expect(lines.join("\n")).not.toContain("NEVER RAN");
    expect(lines.join("\n")).toContain("/p/.hench/reviews/r-r2.json");
  });
});
