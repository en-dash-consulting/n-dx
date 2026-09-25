import { describe, it, expect, beforeEach } from "vitest";
import {
  startRunLedger,
  setRunMode,
  recordPhaseDuration,
  recordLLMCall,
  recordJudgmentCache,
  snapshotRunLedger,
  formatRunLedger,
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
