import { describe, it, expect, beforeEach } from "vitest";
import {
  startRunLedger,
  setRunMode,
  recordPhaseDuration,
  recordLLMCall,
  recordJudgmentCache,
  snapshotRunLedger,
  formatRunLedger,
  priceRunLedger,
} from "../../../src/analyzers/run-ledger.js";

beforeEach(() => {
  startRunLedger("fast");
});

describe("run ledger", () => {
  it("starts empty with the mode it was given", () => {
    const run = snapshotRunLedger();
    expect(run.mode).toBe("fast");
    expect(run.phases).toEqual({});
    expect(run.llm.byTaskClass).toEqual({});
    expect(run.llm.judgmentCache).toBeUndefined();
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("buckets calls by task class and keeps vendor and model per class", () => {
    recordLLMCall({ taskClass: "code.classify", vendor: "typesafe", model: "jev-1.13.0", tokenUsage: { input: 100, output: 5 }, durationMs: 400 });
    recordLLMCall({ taskClass: "code.classify", vendor: "typesafe", model: "jev-1.13.0", tokenUsage: { input: 50, output: 5 }, durationMs: 300 });
    recordLLMCall({ taskClass: "zone.enrich-scan", vendor: "claude", model: "claude-haiku-4-5-20251001", durationMs: 9000 });

    const { byTaskClass } = snapshotRunLedger().llm;
    expect(byTaskClass["code.classify"]).toEqual({
      calls: 2, inputTokens: 150, outputTokens: 10, durationMs: 700, vendor: "typesafe", model: "jev-1.13.0",
    });
    // A CLI vendor that returns no usage still counts the call and its time.
    expect(byTaskClass["zone.enrich-scan"]).toMatchObject({ calls: 1, inputTokens: 0, outputTokens: 0, durationMs: 9000, vendor: "claude" });
  });

  it("keeps a class served by two vendors in one bucket per vendor", () => {
    recordLLMCall({ taskClass: "code.classify", vendor: "typesafe", model: "jev-1.13.0", tokenUsage: { input: 1000, output: 10 }, durationMs: 100 });
    recordLLMCall({ taskClass: "code.classify", vendor: "claude", model: "claude-haiku-4-5", durationMs: 9000 });
    recordLLMCall({ taskClass: "code.classify", vendor: "typesafe", model: "jev-1.13.0", tokenUsage: { input: 500, output: 5 }, durationMs: 50 });
    const { byTaskClass } = snapshotRunLedger().llm;
    expect(byTaskClass["code.classify"]).toMatchObject({ calls: 2, inputTokens: 1500, vendor: "typesafe", model: "jev-1.13.0" });
    expect(byTaskClass["code.classify/claude"]).toMatchObject({ calls: 1, inputTokens: 0, durationMs: 9000, vendor: "claude" });
  });

  it("accumulates phase durations and cache counts, and setRunMode overrides the mode", () => {
    recordPhaseDuration("zones", 1200);
    recordPhaseDuration("zones", 300);
    recordPhaseDuration("inventory", 40);
    recordJudgmentCache(3, 1);
    recordJudgmentCache(2, 0);
    setRunMode("cascade");

    const run = snapshotRunLedger();
    expect(run.mode).toBe("cascade");
    expect(run.phases).toEqual({ zones: 1500, inventory: 40 });
    expect(run.llm.judgmentCache).toEqual({ hits: 5, misses: 1 });
  });

  it("resets on startRunLedger", () => {
    recordLLMCall({ taskClass: "x", vendor: "v", model: "m", durationMs: 1 });
    startRunLedger("narrate");
    expect(snapshotRunLedger()).toMatchObject({ mode: "narrate", llm: { byTaskClass: {} } });
  });

  it("formats one line per class, sorted, plus a cache line when present", () => {
    recordLLMCall({ taskClass: "zone.judge", vendor: "typesafe", model: "jev-1.13.0", tokenUsage: { input: 11188, output: 922 }, durationMs: 2100 });
    recordLLMCall({ taskClass: "code.classify", vendor: "typesafe", model: "jev-1.13.0", tokenUsage: { input: 1000, output: 0 }, durationMs: 500 });
    recordJudgmentCache(1, 2);
    const lines = formatRunLedger(snapshotRunLedger());
    expect(lines).toEqual([
      "  code.classify: 1 call, 1,000 tokens, 0.5s (typesafe jev-1.13.0)",
      "  zone.judge: 1 call, 12,110 tokens, 2.1s (typesafe jev-1.13.0)",
      "  judgment cache: 1 hit, 2 misses",
    ]);
  });
});

describe("priceRunLedger", () => {
  // The manifest's costUsd is read back by `ndx`'s run summary and printed as
  // actual spend, so a figure that is a guess or a gap is worse than none:
  // `formatCost` renders an absent cost as "not recorded", which sends an
  // operator to look, where "$0.00" closes the question.

  it("prices each class at the model that answered it", () => {
    recordLLMCall({ taskClass: "a", vendor: "claude", model: "claude-sonnet-5", tokenUsage: { input: 1_000_000, output: 0 }, durationMs: 1 });
    recordLLMCall({ taskClass: "b", vendor: "claude", model: "claude-opus-5", tokenUsage: { input: 1_000_000, output: 0 }, durationMs: 1 });

    const run = snapshotRunLedger();
    const cost = priceRunLedger(run);

    // Not one run-wide model: a million input tokens at each of two different
    // rates has to be their sum, not either one doubled.
    expect(cost).toBeGreaterThan(0);
    expect(run.llm.costUsd).toBeCloseTo(cost!);
  });

  it("omits the cost when a model is not in the price table", () => {
    // Jev is local. The fallback rates are claude-sonnet-5's — a real catalogue
    // entry — so pricing it anyway produced plausible dollars, not a number
    // anyone would question.
    recordLLMCall({ taskClass: "code.classify", vendor: "typesafe", model: "jev-1.13.0", tokenUsage: { input: 11_188, output: 922 }, durationMs: 2100 });

    const run = snapshotRunLedger();
    expect(priceRunLedger(run)).toBeUndefined();
    expect(run.llm.costUsd).toBeUndefined();
  });

  it("omits the cost when a call reported no usage", () => {
    // recordLLMCall folds a missing tokenUsage in as 0, so a provider that said
    // nothing is indistinguishable from one that spent nothing — and a call
    // that spent nothing does not happen.
    recordLLMCall({ taskClass: "zone.enrich-scan", vendor: "claude", model: "claude-sonnet-5", durationMs: 9000 });

    expect(priceRunLedger(snapshotRunLedger())).toBeUndefined();
  });

  it("omits the cost for the whole run when one class is unknowable", () => {
    // costUsd is a single number with no room to say "partly". A total quietly
    // missing one class reads as measurement just as much as a guessed one.
    recordLLMCall({ taskClass: "priced", vendor: "claude", model: "claude-sonnet-5", tokenUsage: { input: 5000, output: 100 }, durationMs: 1 });
    recordLLMCall({ taskClass: "local", vendor: "typesafe", model: "jev-1.13.0", tokenUsage: { input: 5000, output: 100 }, durationMs: 1 });

    expect(priceRunLedger(snapshotRunLedger())).toBeUndefined();
  });

  it("omits the cost when nothing ran", () => {
    expect(priceRunLedger(snapshotRunLedger())).toBeUndefined();
  });

  it("prices a dated model id, which is what the clients actually report", () => {
    // The regression this pins end to end: sourcevision's scan class runs on
    // haiku and reports the dated id, which used to miss the table entirely.
    recordLLMCall({ taskClass: "zone.enrich-scan", vendor: "claude", model: "claude-haiku-4-5-20251001", tokenUsage: { input: 20_000, output: 500 }, durationMs: 1 });

    expect(priceRunLedger(snapshotRunLedger())).toBeGreaterThan(0);
  });
});
