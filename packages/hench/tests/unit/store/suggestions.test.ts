import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadSuggestionHistory,
  saveSuggestionHistory,
  recordDecision,
  getDecisionStats,
  type SuggestionHistory,
  type SuggestionRecord,
} from "../../../src/store/suggestions.js";

describe("suggestion persistence", () => {
  let henchDir: string;

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "hench-suggestions-"));
    henchDir = tmpDir;
    await mkdir(henchDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(henchDir, { recursive: true, force: true });
  });

  it("returns empty history when no file exists", () => {
    const history = loadSuggestionHistory(henchDir);
    expect(history.records).toEqual([]);
  });

  it("saves and loads suggestion history", () => {
    const history: SuggestionHistory = {
      records: [{
        suggestionId: "test-1",
        title: "Test suggestion",
        category: "token-efficiency",
        decision: "accepted",
        decidedAt: "2024-01-01T00:00:00Z",
        appliedChanges: { tokenBudget: 50000 },
      }],
    };

    saveSuggestionHistory(henchDir, history);
    const loaded = loadSuggestionHistory(henchDir);

    expect(loaded.records).toHaveLength(1);
    expect(loaded.records[0].suggestionId).toBe("test-1");
    expect(loaded.records[0].decision).toBe("accepted");
    expect(loaded.records[0].appliedChanges).toEqual({ tokenBudget: 50000 });
  });

  it("records a decision and appends to history", () => {
    // First decision
    recordDecision(henchDir, {
      suggestionId: "s1",
      title: "First",
      category: "failure-prevention",
      decision: "accepted",
      decidedAt: "2024-01-01T00:00:00Z",
    });

    // Second decision
    recordDecision(henchDir, {
      suggestionId: "s2",
      title: "Second",
      category: "turn-optimization",
      decision: "rejected",
      decidedAt: "2024-01-01T01:00:00Z",
    });

    const history = loadSuggestionHistory(henchDir);
    expect(history.records).toHaveLength(2);
    expect(history.records[0].decision).toBe("accepted");
    expect(history.records[1].decision).toBe("rejected");
  });

  it("handles malformed JSON gracefully", async () => {
    await writeFile(join(henchDir, "suggestions.json"), "not json", "utf-8");
    const history = loadSuggestionHistory(henchDir);
    expect(history.records).toEqual([]);
  });

  it("handles missing records array", async () => {
    await writeFile(join(henchDir, "suggestions.json"), "{}", "utf-8");
    const history = loadSuggestionHistory(henchDir);
    expect(history.records).toEqual([]);
  });
});

describe("getDecisionStats", () => {
  it("returns zero stats for empty history", () => {
    const stats = getDecisionStats({ records: [] });
    expect(stats.total).toBe(0);
    expect(stats.accepted).toBe(0);
    expect(stats.rejected).toBe(0);
    expect(stats.deferred).toBe(0);
    expect(stats.acceptanceRate).toBe(0);
  });

  it("computes stats from decision history", () => {
    const records: SuggestionRecord[] = [
      { suggestionId: "s1", title: "A", category: "token-efficiency", decision: "accepted", decidedAt: "2024-01-01T00:00:00Z" },
      { suggestionId: "s2", title: "B", category: "token-efficiency", decision: "rejected", decidedAt: "2024-01-01T01:00:00Z" },
      { suggestionId: "s3", title: "C", category: "failure-prevention", decision: "accepted", decidedAt: "2024-01-01T02:00:00Z" },
      { suggestionId: "s4", title: "D", category: "failure-prevention", decision: "deferred", decidedAt: "2024-01-01T03:00:00Z" },
    ];

    const stats = getDecisionStats({ records });
    expect(stats.total).toBe(4);
    expect(stats.accepted).toBe(2);
    expect(stats.rejected).toBe(1);
    expect(stats.deferred).toBe(1);
    expect(stats.acceptanceRate).toBe(0.5);

    expect(stats.byCategory["token-efficiency"]).toEqual({ accepted: 1, rejected: 1, deferred: 0 });
    expect(stats.byCategory["failure-prevention"]).toEqual({ accepted: 1, rejected: 0, deferred: 1 });
  });
});
