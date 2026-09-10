/**
 * Tests for charging the adversarial review pass's token spend to the run.
 *
 * The pass charged only the aggregate (`run.tokenUsage`) and never the
 * per-turn breakdown (`run.turnTokenUsage`). That is not a cosmetic gap:
 * rex's `extractHenchTokenEvents` builds usage events from `turnTokenUsage`
 * whenever it is non-empty and then `continue`s, never falling back to the
 * aggregate. A run whose per-turn array holds only executor turns therefore
 * reports the executor's spend and drops the reviewer's entirely.
 *
 * Measured on live run 5c1e9bee (executor claude-sonnet-4-6, reviewer
 * claude-opus-5): aggregate output 28920, per-turn output 3154 across 20
 * entries all tagged sonnet — an 89% under-report, costed wholly at Sonnet
 * pricing though ~25.8k output tokens were billed to opus-5.
 */

import { describe, it, expect } from "vitest";
import { chargeReviewToRun } from "../../../src/agent/lifecycle/cli-loop.js";
import type { RunRecord, TurnTokenUsage } from "../../../src/schema/index.js";

const EXECUTOR_MODEL = "claude-sonnet-4-6";
const REVIEW_MODEL = "claude-opus-5";

function executorTurn(turn: number, output: number): TurnTokenUsage {
  return {
    turn,
    input: output * 4,
    output,
    vendor: "claude",
    model: EXECUTOR_MODEL,
  };
}

/** A run as it stands after syncRunFromAccumulated, before the review pass. */
function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-5c1e9bee",
    taskId: "task-cea4d4df",
    taskTitle: "Merge the review pass's per-turn token usage into the run record",
    startedAt: "2026-09-03T12:00:00.000Z",
    status: "completed",
    turns: 2,
    tokenUsage: { input: 4000, output: 1000 },
    turnTokenUsage: [executorTurn(1, 400), executorTurn(2, 600)],
    toolCalls: [],
    model: EXECUTOR_MODEL,
    ...over,
  };
}

/** What the reviewer spawn hands back. */
function reviewerResult(over: Partial<ReviewerResult> = {}): ReviewerResult {
  return {
    tokenUsage: { input: 80000, output: 25800 },
    turnTokenUsage: [
      { turn: 1, input: 50000, output: 15800, vendor: "claude", model: REVIEW_MODEL },
      { turn: 2, input: 30000, output: 10000, vendor: "claude", model: REVIEW_MODEL },
    ],
    ...over,
  };
}

interface ReviewerResult {
  tokenUsage: { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number };
  turnTokenUsage: TurnTokenUsage[];
}

function sumOutput(turns: TurnTokenUsage[] | undefined): number {
  return (turns ?? []).reduce((acc, t) => acc + (t.output ?? 0), 0);
}

describe("chargeReviewToRun", () => {
  it("appends the reviewer's per-turn entries to the run", () => {
    const r = run();
    chargeReviewToRun(r, reviewerResult(), REVIEW_MODEL);

    expect(r.turnTokenUsage).toHaveLength(4);
  });

  it("keeps the per-turn sum in step with the aggregate", () => {
    const r = run();
    chargeReviewToRun(r, reviewerResult(), REVIEW_MODEL);

    // The defect this test exists for: these two numbers were 3154 and 28920
    // on the live run, and `ndx usage` printed both in the same report.
    expect(sumOutput(r.turnTokenUsage)).toBe(r.tokenUsage.output);
    expect(sumOutput(r.turnTokenUsage)).toBe(26800);
  });

  it("tags the reviewer's turns with the review model and leaves the executor's alone", () => {
    const r = run();
    chargeReviewToRun(r, reviewerResult(), REVIEW_MODEL);

    const models = r.turnTokenUsage!.map((t) => t.model);
    expect(models).toEqual([EXECUTOR_MODEL, EXECUTOR_MODEL, REVIEW_MODEL, REVIEW_MODEL]);

    // Per-model cost rollups price by this field; the reviewer's output must
    // not land in the executor's bucket.
    const reviewOutput = sumOutput(r.turnTokenUsage!.filter((t) => t.model === REVIEW_MODEL));
    expect(reviewOutput).toBe(25800);
  });

  it("continues the reviewer's turn numbers after the executor's", () => {
    const r = run();
    chargeReviewToRun(r, reviewerResult(), REVIEW_MODEL);

    expect(r.turnTokenUsage!.map((t) => t.turn)).toEqual([1, 2, 3, 4]);
  });

  it("offsets past the highest existing turn, not the entry count", () => {
    // Retries leave gaps: accumulated turn numbers are not always 1..n.
    const r = run({ turnTokenUsage: [executorTurn(1, 100), executorTurn(7, 100)] });
    chargeReviewToRun(r, reviewerResult(), REVIEW_MODEL);

    expect(r.turnTokenUsage!.map((t) => t.turn)).toEqual([1, 7, 8, 9]);
  });

  it("carries the reviewer's cache split onto the appended turns", () => {
    const r = run();
    chargeReviewToRun(
      r,
      reviewerResult({
        turnTokenUsage: [
          {
            turn: 1,
            input: 50000,
            output: 25800,
            cacheCreationInput: 1200,
            cacheReadInput: 34000,
            vendor: "claude",
            model: REVIEW_MODEL,
          },
        ],
      }),
      REVIEW_MODEL,
    );

    const appended = r.turnTokenUsage!.at(-1)!;
    expect(appended.cacheCreationInput).toBe(1200);
    expect(appended.cacheReadInput).toBe(34000);
  });

  it("still charges the aggregate, including the cache split", () => {
    const r = run();
    chargeReviewToRun(
      r,
      reviewerResult({ tokenUsage: { input: 80000, output: 25800, cacheReadInput: 34000 } }),
      REVIEW_MODEL,
    );

    expect(r.tokenUsage.input).toBe(84000);
    expect(r.tokenUsage.output).toBe(26800);
    expect(r.tokenUsage.cacheReadInput).toBe(34000);
  });

  it("charges a run that has no aggregate yet", () => {
    const r = run({ tokenUsage: undefined as unknown as RunRecord["tokenUsage"] });
    chargeReviewToRun(r, reviewerResult(), REVIEW_MODEL);

    expect(r.tokenUsage.input).toBe(80000);
    expect(r.tokenUsage.output).toBe(25800);
  });

  it("seeds turnTokenUsage when the executor recorded none", () => {
    const r = run({ turnTokenUsage: undefined });
    chargeReviewToRun(r, reviewerResult(), REVIEW_MODEL);

    expect(r.turnTokenUsage).toHaveLength(2);
    expect(r.turnTokenUsage!.map((t) => t.turn)).toEqual([1, 2]);
  });

  it("invents no per-turn entries when the reviewer reported none", () => {
    // Aggregate-only reviewer output must not become a synthetic turn: a
    // fabricated entry would be indistinguishable from measured data.
    const r = run();
    chargeReviewToRun(r, reviewerResult({ turnTokenUsage: [] }), REVIEW_MODEL);

    expect(r.turnTokenUsage).toHaveLength(2);
    expect(r.tokenUsage.output).toBe(26800);
  });

  it("leaves the model unset when no review model was resolved", () => {
    // The local vendor sends no model flag, so reviewModel is "". An empty
    // string is not nullish, so it would defeat the `turn.model ?? run.model`
    // fallback in rex's event extraction and surface as a blank model.
    const r = run();
    chargeReviewToRun(
      r,
      reviewerResult({
        turnTokenUsage: [{ turn: 1, input: 100, output: 50, vendor: "local", model: "" }],
      }),
      "",
    );

    expect(r.turnTokenUsage!.at(-1)!.model).toBeUndefined();
  });

  it("does not mutate the reviewer's own turn entries", () => {
    const result = reviewerResult();
    const original = structuredClone(result.turnTokenUsage);
    chargeReviewToRun(run(), result, REVIEW_MODEL);

    expect(result.turnTokenUsage).toEqual(original);
  });
});
