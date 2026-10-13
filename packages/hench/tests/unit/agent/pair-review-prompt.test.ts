import { describe, it, expect } from "vitest";

/**
 * The pure half of pair review: what a different vendor's reviewer is told.
 * The reviewer starts with no context, so the brief has to carry the task, the
 * changed files and the diff itself, and must forbid edits.
 */

import {
  buildPairReviewBrief,
  buildPairReviewSystemPrompt,
  buildReviewSystemPrompt,
  buildReviewBrief,
  pairTaskBrief,
  truncatePairDiff,
  PAIR_REVIEW_DIFF_CHAR_LIMIT,
} from "../../../src/agent/analysis/adversarial-review.js";
import type { PairReviewPromptContext } from "../../../src/agent/analysis/adversarial-review.js";

const ctx = (over: Partial<PairReviewPromptContext> = {}): PairReviewPromptContext => ({
  taskId: "task-9",
  taskTitle: "Add the widget",
  taskBrief: "Widgets need a name.\n\nAcceptance criteria:\n- name is required",
  startingHead: "abc1234",
  diff: "diff --git a/w.ts b/w.ts\n+export const w = 1;",
  changedFiles: ["w.ts", "notes.md"],
  reportPath: "/p/.hench/reviews/run-1.json",
  prdTreeDir: ".rex/prd_tree/",
  autonomous: true,
  testGateFollows: true,
  ...over,
});

describe("buildPairReviewSystemPrompt", () => {
  it("keeps the adversarial posture and adds the report-only rule", () => {
    const prompt = buildPairReviewSystemPrompt();
    expect(prompt).toContain(buildReviewSystemPrompt());
    expect(prompt).toMatch(/MUST NOT\s+edit/);
    expect(prompt).toMatch(/Fixing is the executor's job/);
  });
});

describe("buildPairReviewBrief", () => {
  it("carries the task, the changed files and the diff", () => {
    const brief = buildPairReviewBrief(ctx());
    expect(brief).toContain("task-9 — Add the widget");
    expect(brief).toContain("name is required");
    expect(brief).toContain("- w.ts");
    expect(brief).toContain("- notes.md");
    expect(brief).toContain("`git diff abc1234`");
    expect(brief).toContain("+export const w = 1;");
    expect(brief).toContain("/p/.hench/reviews/run-1.json");
  });

  it("forbids edits and fixing, and never offers `fixed` as an action", () => {
    const brief = buildPairReviewBrief(ctx());
    expect(brief).toMatch(/Edit no files/);
    expect(brief).toMatch(/`fixed` is never a valid `action`/);
    expect(brief).toMatch(/fixesApplied` to false/);
    expect(brief).not.toMatch(/Fix it now/);
    expect(brief).not.toMatch(/Fix `must-fix` only/);
  });

  it("captures every verdict above not-worth-fixing when autonomous, must-fix included", () => {
    const brief = buildPairReviewBrief(ctx({ autonomous: true }));
    expect(brief).toContain("| `must-fix`, `should-fix`, `out-of-scope` | Capture as a PRD task with `add_item`");
    expect(brief).toContain(".rex/prd_tree/");
  });

  it("only reports, for the run to queue, when a human is attached", () => {
    const brief = buildPairReviewBrief(ctx({ autonomous: false }));
    expect(brief).toContain("Do not capture it — the run queues it for the operator");
    expect(brief).not.toContain("add_item");
  });

  it("says when the diff was cut and how to read the rest", () => {
    const brief = buildPairReviewBrief(ctx({ diff: "x".repeat(PAIR_REVIEW_DIFF_CHAR_LIMIT + 10) }));
    expect(brief).toContain(`cut at ${PAIR_REVIEW_DIFF_CHAR_LIMIT} characters`);
    expect(brief).toContain("git diff abc1234 -- <path>");
  });

  it("falls back to HEAD and says the scope may be short when the start commit is unknown", () => {
    const brief = buildPairReviewBrief(ctx({ startingHead: undefined }));
    expect(brief).toContain("`git diff HEAD`");
    expect(brief).toMatch(/pre-run commit could not be captured/);
  });

  it("names the v2 Inbox in the autonomous dedupe check only when given one", () => {
    const v2 = buildPairReviewBrief(ctx({ prdTreeDir: ".rex/changes/", inboxDir: ".rex/changes/inbox/" }));
    expect(v2).toContain("under `.rex/changes/` and under `.rex/changes/inbox/`, where unplaced changes wait,");
    expect(buildPairReviewBrief(ctx())).not.toContain("inbox");
  });

  it("shares the report schema with the self brief", () => {
    const pair = buildPairReviewBrief(ctx());
    const self = buildReviewBrief({
      taskId: "task-9",
      taskTitle: "Add the widget",
      reportPath: "/p/.hench/reviews/run-1.json",
      prdTreeDir: ".rex/prd_tree/",
      resumed: false,
      autonomous: true,
      testGateFollows: true,
    });
    const schema = (text: string): string => text.slice(text.indexOf("## Output"), text.indexOf("`findings` must account"));
    expect(schema(pair)).toBe(schema(self));
  });
});

describe("truncatePairDiff", () => {
  it("leaves a diff within the limit alone", () => {
    expect(truncatePairDiff("abc")).toEqual({ text: "abc", truncated: false });
  });

  it("cuts a longer diff to the limit", () => {
    const { text, truncated } = truncatePairDiff("x".repeat(PAIR_REVIEW_DIFF_CHAR_LIMIT + 1));
    expect(truncated).toBe(true);
    expect(text).toHaveLength(PAIR_REVIEW_DIFF_CHAR_LIMIT);
  });
});

describe("pairTaskBrief", () => {
  it("joins the description and the criteria", () => {
    expect(pairTaskBrief({ description: " Do it. ", acceptanceCriteria: ["a", "b"] })).toBe(
      "Do it.\n\nAcceptance criteria:\n- a\n- b",
    );
  });

  it("is empty for a task with neither", () => {
    expect(pairTaskBrief({})).toBe("");
  });
});
