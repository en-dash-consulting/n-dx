import { describe, expect, it } from "vitest";
import { extractRexTokenEvents, extractRexTokenUsage, estimateCostFromTotals,
  groupByCommand, groupByTimePeriod, type TokenUsageLogEntry } from "../../../src/core/token-usage.js";

const log = (event: string, detail: object, timestamp = "2026-11-18T12:00:00Z"): TokenUsageLogEntry => ({
  timestamp, event, detail: JSON.stringify(detail),
});

describe("Rex measurement provenance compatibility", () => {
  it("associates diagnostics before filtering by invocation, not by nearby calls using the same model", () => {
    const entries = [
      log("llm_usage_diagnostic", { usageScope: "a", command: "analyze", usageStatus: "unavailable", model: "gpt-5.4" }),
      log("llm_usage_diagnostic", { usageScope: "b", command: "analyze", usageStatus: "measured", model: "gpt-5.4" }),
      log("analyze_token_usage", { usageScope: "b", calls: 1, model: "gpt-5.4" }),
      log("analyze_token_usage", { usageScope: "a", calls: 1, model: "gpt-5.4" }, "2026-11-19T12:00:00Z"),
      // A failed call is independently owned, even if a writer records a scope.
      log("analyze_token_usage", { usageScope: "a", outcome: "failed", usageStatus: "partial", calls: 1, inputTokens: 10 }, "2026-11-20T12:00:00Z"),
    ];
    const periods = groupByTimePeriod(extractRexTokenEvents(entries), "day");
    expect(periods.map(p => [p.usage.totalCalls, p.usage.diagnosticStatus])).toEqual([
      [1, "complete"], [1, "unavailable"], [1, "partial"],
    ]);
    const before = extractRexTokenUsage(entries, { until: "2026-11-19" });
    expect(before).toMatchObject({ calls: 1, diagnosticStatus: "complete" });
    const after = extractRexTokenUsage(entries, { since: "2026-11-19", until: "2026-11-20" });
    expect(after).toMatchObject({ calls: 1, diagnosticStatus: "unavailable" });
  });

  it("keeps historical successful diagnostics without guessing their command or counting their optional counters", () => {
    const entries = [
      log("llm_usage_diagnostic", { usageStatus: "partial", model: "gpt-5.4", calls: 1, inputTokens: 100 }),
      log("analyze_token_usage", { calls: 1, inputTokens: 100, outputTokens: 5, model: "gpt-5.4" }),
    ];
    const events = extractRexTokenEvents(entries);
    expect(events[0]).toMatchObject({ command: "unknown", calls: 0, inputTokens: 0, diagnosticStatus: "partial" });
    const usage = extractRexTokenUsage(entries);
    expect(usage).toMatchObject({ calls: 1, inputTokens: 100, outputTokens: 5, diagnosticStatus: "partial" });
    expect(estimateCostFromTotals(usage, usage.byModel)).toMatchObject({ measurementComplete: false, fullyAttributed: true });
  });

  it("keeps diagnostics scoped by model, command, and time even without a command-owned event", () => {
    const entries = [
      log("llm_usage_diagnostic", { command: "smart-add", usageStatus: "unavailable", model: "gpt-5.4" }),
      log("analyze_token_usage", { calls: 1, command: "analyze", usageStatus: "measured", model: "claude-sonnet-4-6", inputTokens: 100 }, "2026-11-19T12:00:00Z"),
    ];
    const usage = extractRexTokenUsage(entries);
    expect(usage.byModel?.["gpt-5.4"]).toMatchObject({ diagnosticStatus: "unavailable", inputTokens: 0 });
    expect(usage.byModel?.["claude-sonnet-4-6"]).toMatchObject({ diagnosticStatus: "complete", inputTokens: 100 });
    const cost = estimateCostFromTotals(usage, usage.byModel);
    expect(cost.measurementComplete).toBe(false);
    expect(cost.byModel.find(line => line.model === "claude-sonnet-4-6")?.measurementComplete).toBe(true);
    const commands = groupByCommand(extractRexTokenEvents(entries));
    expect(commands.find(cmd => cmd.command === "smart-add")).toMatchObject({ calls: 0, diagnosticStatus: "unavailable" });
    const periods = groupByTimePeriod(extractRexTokenEvents(entries), "day");
    expect(periods.map(p => p.estimatedCost.measurementComplete)).toEqual([false, true]);
    const filtered = extractRexTokenUsage(entries, { since: "2026-11-19" });
    expect(filtered).toMatchObject({ calls: 1, diagnosticStatus: "complete" });
    expect(Object.keys(filtered.byModel!)).toEqual(["claude-sonnet-4-6"]);
  });

  it("keeps price attribution independent of measurement, including a forced rate", () => {
    const usage = extractRexTokenUsage([log("analyze_token_usage", {
      usageStatus: "measured", model: "not-a-priced-model", calls: 1, inputTokens: 100,
    })]);
    expect(estimateCostFromTotals(usage, usage.byModel)).toMatchObject({ measurementComplete: true, fullyAttributed: false });
    const missing = { ...usage, diagnosticStatus: "unavailable" as const };
    const cost = estimateCostFromTotals(missing, usage.byModel, { inputPerMillion: 1, outputPerMillion: 2,
      cacheWritePerMillion: 3, cacheReadPerMillion: 0.1 });
    expect(cost).toMatchObject({ measurementComplete: false, fullyAttributed: false, totalRaw: 0.0001 });
    expect(cost.total).toContain("recorded");
  });

  it("does not invent provenance for legacy or unrecognized metadata", () => {
    const entries = [log("analyze_token_usage", { calls: 1, inputTokens: 0, outputTokens: 0, usageStatus: "future-value" }),
      log("llm_usage_diagnostic", { usageStatus: "future-value" }),
      { timestamp: "2026-11-18", event: "analyze_token_usage", detail: "{" }];
    const usage = extractRexTokenUsage(entries);
    expect(usage.calls).toBe(1);
    expect(usage.diagnosticStatus).toBeUndefined();
    expect(estimateCostFromTotals(usage).total).toBe("$0.00");
    expect(estimateCostFromTotals(usage).measurementComplete).toBeUndefined();
  });
});
