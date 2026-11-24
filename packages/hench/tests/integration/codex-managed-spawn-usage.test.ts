import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnWithAdapter, chargeReviewToRun } from "../../src/agent/lifecycle/cli-loop.js";
import { codexCliAdapter } from "../../src/agent/lifecycle/adapters/codex-cli-adapter.js";
import { CodexManagedUsage } from "../../src/agent/lifecycle/codex-managed-usage.js";
import { EventAccumulator } from "../../src/agent/lifecycle/event-accumulator.js";
import type { RunRecord } from "../../src/schema/index.js";

// Disposable protocol fixtures, not recorded production prompts or a live CLI test.
describe.each([false, true])("managed Codex spawn (pipeline=%s)", (pipeline) => {
  let dir: string, home: string, path: string;
  const usage = (n: number) => ({ input_tokens: n * 10, cached_input_tokens: n * 4, output_tokens: n * 2 });
  beforeEach(async () => {
    dir = await mkdtemp(join(process.cwd(), ".test-managed-usage-"));
    home = join(dir, "codex");
    await mkdir(join(home, "sessions"), { recursive: true });
    path = join(home, "sessions", "rollout-fixture-session-a.jsonl");
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
  async function baseline(n: number) {
    await writeFile(path, [JSON.stringify({ type: "session_meta", payload: { id: "session-a" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: usage(n) } } })].join("\n"));
  }
  async function spawn(n: number, resume?: string, fail = false, terminal: boolean | "failed" | "partial" = true, fork = false, recovery?: number, legacyTail = false) {
    const script = join(dir, "cli.mjs");
    await writeFile(script, `
if (process.env.NDX_MANAGED_USAGE !== "1") throw new Error("missing managed owner");
console.log(JSON.stringify({type:"thread.started",thread_id:"${fork ? "child" : "session-a"}"}));
if (${terminal === true}) console.log(JSON.stringify({type:"turn.completed",usage:${JSON.stringify(usage(n))}}));
if (${terminal === true}) console.log(JSON.stringify({type:"turn.completed",usage:${JSON.stringify(usage(n))}}));
if (${terminal === "partial"}) console.log(JSON.stringify({type:"turn.completed",usage:{output_tokens:${n * 2}}}));
if (${terminal === "failed"}) console.log(JSON.stringify({type:"turn.failed",error:{message:"fixture failure"}}));
if (${recovery !== undefined}) {
  const fs = await import("node:fs");
  fs.writeFileSync(${JSON.stringify(path)}, ${JSON.stringify(JSON.stringify({ type: "session_meta", payload: { id: "session-a" } }) + "\n" + JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: usage(recovery ?? 0) } } }))});
  console.log(JSON.stringify({type:"turn.started"}));
  console.log(JSON.stringify({type:"turn.failed",error:{message:"fixture later failure"}}));
}
if (${legacyTail}) console.log("tokens used\\n999999");
process.exitCode = ${fail ? 1 : 0};
`);
    return spawnWithAdapter({ forkParentId: fork ? "session-a" : undefined, adapter: codexCliAdapter, cliBinary: process.execPath,
      cliEnv: { ...process.env, CODEX_HOME: home }, cwd: dir,
      spawnConfig: { binary: process.execPath, args: [script], env: {}, cwd: dir, stdinContent: null, usageResumeSessionId: resume },
      tokenMetadata: { vendor: "codex", model: "fixture-model" },
      useEventPipeline: pipeline, accumulator: pipeline ? new EventAccumulator() : undefined });
  }
  it.each(["HOME", "USERPROFILE"])("uses selected child %s rather than an ambient CODEX_HOME", async (homeKey) => {
    await baseline(10);
    vi.stubEnv("CODEX_HOME", home);
    const childHome = join(dir, "child-home");
    const childRollouts = join(childHome, ".codex", "sessions");
    await mkdir(childRollouts, { recursive: true });
    await writeFile(join(childRollouts, "rollout-fixture-session-a.jsonl"), [
      JSON.stringify({ type: "session_meta", payload: { id: "session-a" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: usage(20) } } }),
    ].join("\n"));
    const tracker = await CodexManagedUsage.start("session-a", { [homeKey]: childHome });
    tracker.observe({ type: "thread.started", thread_id: "session-a" }, 1);
    expect(tracker.observe({ type: "turn.completed", usage: usage(21) }, 1)?.tokenUsage?.input).toBe(6);
    // Recovery must use the same selected home as the starting boundary.
    const failed = await CodexManagedUsage.start("session-a", { [homeKey]: childHome });
    failed.observe({ type: "thread.started", thread_id: "session-a" }, 1);
    await writeFile(join(childRollouts, "rollout-fixture-session-a.jsonl"), [
      JSON.stringify({ type: "session_meta", payload: { id: "session-a" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: usage(22) } } }),
    ].join("\n"));
    expect((await failed.finish({ [homeKey]: childHome }, 1))?.tokenUsage?.input).toBe(12);
  });
  it("keeps work plus resumed review equal to the final counter, including failed spend", async () => {
    const work = await spawn(10);
    await baseline(10);
    const review = await spawn(13, "session-a", true);
    expect(review.error).toBeDefined();
    expect(review.tokenUsage).toEqual({ input: 18, output: 6, cacheReadInput: 12 });
    const run = { tokenUsage: work.tokenUsage, turnTokenUsage: work.turnTokenUsage } as RunRecord;
    chargeReviewToRun(run, review, "fixture-review");
    expect(run.tokenUsage.input + run.tokenUsage.output + run.tokenUsage.cacheReadInput!).toBe(156);
    expect(run.turnTokenUsage!.reduce((sum, t) => sum + t.input + t.output + (t.cacheReadInput ?? 0), 0)).toBe(156);
    expect(run.reviewSpend?.input).toBe(18);
  });
  it("never adds a legacy text summary to measured session spend", async () => {
    const result = await spawn(10, undefined, false, true, false, undefined, true);
    expect(result.tokenUsage).toEqual({ input: 60, output: 20, cacheReadInput: 40 });
    expect(result.turnTokenUsage).toHaveLength(1);
  });
  it("does not use an unbounded legacy summary when resumed counters are missing", async () => {
    const result = await spawn(10, "session-a", false, false, false, undefined, true);
    expect(result.tokenUsage.input).toBe(0);
    expect(result.turnTokenUsage[0].diagnosticStatus).toBe("unavailable");
  });
  it("retains the inherited fork baseline while accepting a distinct child", async () => {
    await baseline(10);
    expect((await spawn(12, "session-a", false, true, true)).tokenUsage.input).toBe(12);
  });
  it("recovers measured failure spend and reports absent terminal measurements", async () => {
    await baseline(10);
    const measured = await spawn(10, undefined, true, "failed");
    expect(measured.tokenUsage.input).toBe(60);
    expect(measured.usageNotes?.join()).toMatch(/recovered/);
    await rm(path);
    const missing = await spawn(10, undefined, true, false);
    expect(missing.turnTokenUsage[0].diagnosticStatus).toBe("unavailable");
    expect(missing.tokenUsage.input).toBe(0);
  });
  it("recovers missing token classes after a partial terminal observation", async () => {
    await baseline(10);
    const result = await spawn(10, undefined, false, "partial");
    expect(result.tokenUsage).toEqual({ input: 60, output: 20, cacheReadInput: 40 });
    expect(result.turnTokenUsage.reduce((sum, t) => sum + t.output, 0)).toBe(20);
    expect(result.usageNotes?.join()).toMatch(/recovered/);
  });
  it("establishes an independent output boundary when the resume baseline is missing", async () => {
    const tracker = await CodexManagedUsage.start("session-a", { CODEX_HOME: home });
    tracker.observe({ type: "thread.started", thread_id: "session-a" }, 1);
    const partial = (output: number) => ({ type: "turn.completed", usage: { output_tokens: output } });
    expect(tracker.observe(partial(10), 1)?.tokenUsage?.output).toBe(0);
    expect(tracker.observe(partial(15), 2)?.tokenUsage?.output).toBe(5);
    expect(tracker.observe({ type: "turn.completed", usage: usage(10) }, 3)?.tokenUsage)
      .toEqual({ input: 0, output: 5, cacheReadInput: 0, cacheCreationInput: 0 });
  });
  it("recovers additional failed spend after an earlier completed observation", async () => {
    await baseline(10);
    const result = await spawn(12, "session-a", true, true, false, 15);
    expect(result.tokenUsage.input).toBe(30);
    expect(result.tokenUsage.output).toBe(10);
    expect(result.tokenUsage.cacheReadInput).toBe(20);
    expect(result.usageNotes?.join()).toMatch(/recovered/);
  });
  it("does not charge pre-existing or unavailable resumed history", async () => {
    await baseline(20);
    expect((await spawn(21, "session-a")).tokenUsage.input).toBe(6);
    await rm(path);
    const unknown = await spawn(100, "session-a");
    expect(unknown.tokenUsage.input).toBe(0);
    expect(unknown.turnTokenUsage[0].diagnosticStatus).toBe("partial");
    expect(unknown.usageNotes?.join()).toMatch(/baseline unavailable/);
  });
});
