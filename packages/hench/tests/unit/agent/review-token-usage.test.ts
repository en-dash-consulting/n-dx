import { describe, it, expect } from "vitest";
import { mergeReviewTokenUsage } from "../../../src/agent/lifecycle/cli-loop.js";
import type { TurnTokenUsage } from "../../../src/schema/v1.js";

/**
 * The review pass's token spend has to land on *both* halves of the run record.
 *
 * rex's `extractHenchTokenEvents` uses `turnTokenUsage` whenever it is
 * non-empty and never falls back to the aggregate, so merging only
 * `run.tokenUsage` left the reviewer invisible to `ndx usage`'s per-command
 * and per-model lines — and priced the whole run at the executor's model.
 */

function executorTurns(): TurnTokenUsage[] {
  return [
    { turn: 1, input: 1000, output: 100, vendor: "claude", model: "claude-sonnet-4-6" },
    { turn: 2, input: 2000, output: 200, vendor: "claude", model: "claude-sonnet-4-6" },
  ];
}

function reviewSpend(over: Partial<{ turnTokenUsage: TurnTokenUsage[] }> = {}) {
  return {
    tokenUsage: { input: 5000, output: 900 },
    turnTokenUsage: [
      { turn: 1, input: 3000, output: 400, vendor: "claude", model: "claude-opus-5" },
      { turn: 2, input: 2000, output: 500, vendor: "claude", model: "claude-opus-5" },
    ] as TurnTokenUsage[],
    ...over,
  };
}

function makeRun() {
  return {
    tokenUsage: { input: 3000, output: 300 },
    turnTokenUsage: executorTurns(),
  };
}

describe("mergeReviewTokenUsage", () => {
  it("charges the reviewer's aggregate to the run", () => {
    const run = makeRun();

    mergeReviewTokenUsage(run, reviewSpend(), "claude-opus-5");

    expect(run.tokenUsage).toEqual({ input: 8000, output: 1200 });
  });

  it("appends the reviewer's per-turn entries so the per-turn sum matches the aggregate", () => {
    const run = makeRun();

    mergeReviewTokenUsage(run, reviewSpend(), "claude-opus-5");

    const perTurnOutput = run.turnTokenUsage.reduce((sum, t) => sum + t.output, 0);
    expect(perTurnOutput).toBe(run.tokenUsage.output);
    expect(run.turnTokenUsage).toHaveLength(4);
  });

  it("tags the reviewer's entries with the review model, not the executor's", () => {
    const run = makeRun();

    mergeReviewTokenUsage(run, reviewSpend(), "claude-opus-5");

    const byModel = new Map<string, number>();
    for (const t of run.turnTokenUsage) {
      byModel.set(t.model ?? "", (byModel.get(t.model ?? "") ?? 0) + t.output);
    }
    expect(byModel.get("claude-sonnet-4-6")).toBe(300);
    expect(byModel.get("claude-opus-5")).toBe(900);
  });

  it("tags entries the adapter left untagged with the review model", () => {
    const run = makeRun();
    const spend = reviewSpend({
      turnTokenUsage: [{ turn: 1, input: 3000, output: 900 }],
    });

    mergeReviewTokenUsage(run, spend, "claude-opus-5");

    expect(run.turnTokenUsage[2].model).toBe("claude-opus-5");
  });

  it("renumbers reviewer turns to continue after the executor's last turn", () => {
    const run = makeRun();

    mergeReviewTokenUsage(run, reviewSpend(), "claude-opus-5");

    expect(run.turnTokenUsage.map((t) => t.turn)).toEqual([1, 2, 3, 4]);
  });

  it("preserves cache fields on the reviewer's entries", () => {
    const run = makeRun();
    const spend = {
      tokenUsage: { input: 5000, output: 900, cacheCreationInput: 700, cacheReadInput: 12000 },
      turnTokenUsage: [
        {
          turn: 1,
          input: 5000,
          output: 900,
          cacheCreationInput: 700,
          cacheReadInput: 12000,
          vendor: "claude",
          model: "claude-opus-5",
        },
      ] as TurnTokenUsage[],
    };

    mergeReviewTokenUsage(run, spend, "claude-opus-5");

    expect(run.tokenUsage.cacheCreationInput).toBe(700);
    expect(run.tokenUsage.cacheReadInput).toBe(12000);
    expect(run.turnTokenUsage[2]).toMatchObject({
      cacheCreationInput: 700,
      cacheReadInput: 12000,
    });
  });

  it("does not mutate the executor's array, which the retry accumulator still aliases", () => {
    const run = makeRun();
    const executorArray = run.turnTokenUsage;

    mergeReviewTokenUsage(run, reviewSpend(), "claude-opus-5");

    expect(executorArray).toHaveLength(2);
    expect(run.turnTokenUsage).not.toBe(executorArray);
  });

  it("leaves the per-turn array alone when the reviewer reported no per-turn usage", () => {
    const run = makeRun();

    mergeReviewTokenUsage(run, { tokenUsage: { input: 5000, output: 900 }, turnTokenUsage: [] }, "claude-opus-5");

    expect(run.tokenUsage).toEqual({ input: 8000, output: 1200 });
    expect(run.turnTokenUsage).toHaveLength(2);
  });

  it("seeds both halves when the executor recorded nothing", () => {
    const run: { tokenUsage?: { input: number; output: number }; turnTokenUsage?: TurnTokenUsage[] } = {};

    mergeReviewTokenUsage(run, reviewSpend(), "claude-opus-5");

    expect(run.tokenUsage).toEqual({ input: 5000, output: 900 });
    expect(run.turnTokenUsage?.map((t) => t.turn)).toEqual([1, 2]);
  });
});
