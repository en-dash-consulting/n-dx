import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CodexManagedUsage } from "../../packages/hench/dist/agent/lifecycle/codex-managed-usage.js";
import { checkTokenBudget } from "../../packages/hench/dist/agent/lifecycle/token-budget.js";
import { chargeReviewToRun } from "../../packages/hench/dist/agent/lifecycle/cli-loop.js";
import { extractHenchTokenEvents, extractHenchTokenUsage, groupByCommand, groupByTimePeriod, aggregateTokenUsage } from "../../packages/rex/dist/core/token-usage.js";

// Synthetic cumulative observations travel through the real producer and consumers.
describe("managed Codex downstream ledger", () => {
  let dir;
  beforeEach(async () => { dir = await mkdtemp(join(process.cwd(), ".test-managed-ledger-")); await mkdir(join(dir, ".hench", "runs"), { recursive: true }); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
  it("keeps aggregate, review and per-turn ledgers equal without repricing history", async () => {
    const work = { input: 172579, output: 25057, cacheReadInput: 5308160, cacheCreationInput: 0 };
    const tracker = new CodexManagedUsage(work, "fixture-session");
    tracker.observe({ type: "thread.started", thread_id: "fixture-session" }, 1);
    const ev = tracker.observe({ type: "turn.completed", usage: { input_tokens: 7647418, cached_input_tokens: 7448192, output_tokens: 30209 } }, 1);
    const run = { id: "fixture", startedAt: "2026-11-17T00:00:00Z", tokenUsage: work,
      turnTokenUsage: [{ ...work, turn: 1, vendor: "codex", model: "fixture", diagnosticStatus: "complete" }] };
    chargeReviewToRun(run, { tokenUsage: ev.tokenUsage, turnTokenUsage: [{ ...ev.tokenUsage, turn: 1, diagnosticStatus: ev.tokenDiagnosticStatus }] }, "fixture");
    await writeFile(join(dir, ".hench", "runs", "fixture.json"), JSON.stringify(run));
    const events = await extractHenchTokenEvents(dir);
    const total = x => x.inputTokens + x.outputTokens + x.cacheCreationTokens + x.cacheReadTokens;
    expect(total(await extractHenchTokenUsage(dir))).toBe(7677627);
    expect(checkTokenBudget(run.tokenUsage, 300000)).toMatchObject({ exceeded: false, totalUsed: 229435, cacheReadNotCounted: 7448192 });
    expect(events.reduce((sum, ev) => sum + total(ev), 0)).toBe(7677627);
    expect(total(groupByCommand(events)[0])).toBe(7677627);
    expect(Object.values(run.reviewSpend).slice(1).reduce((a, b) => a + b, 0)).toBe(2171831);
  });
  it("preserves unavailable and partial provenance through grouping", async () => {
    await writeFile(join(dir, ".hench", "runs", "unknown.json"), JSON.stringify({ id: "unknown", startedAt: "2026-11-17T00:00:00Z",
      tokenUsage: { input: 5, output: 2 }, turnTokenUsage: [
        { input: 5, output: 2, diagnosticStatus: "partial", cacheProvenance: "unavailable" },
        { input: 0, output: 0, diagnosticStatus: "unavailable", cacheProvenance: "unavailable" },
      ] }));
    const events = await extractHenchTokenEvents(dir);
    expect(events.map(e => e.diagnosticStatus)).toEqual(["partial", "unavailable"]);
    expect(events[0].cacheProvenance).toBe("unavailable");
    expect(groupByCommand(events)[0].diagnosticStatus).toBe("unavailable");
    expect((await aggregateTokenUsage([], dir)).diagnosticStatus).toBe("unavailable");
    expect(groupByTimePeriod(events, "day")[0].usage.diagnosticStatus).toBe("unavailable");
  });
});
