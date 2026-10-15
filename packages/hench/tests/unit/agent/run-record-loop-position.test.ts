/**
 * A run record says where it sits in the invocation that started it.
 *
 * Hench recorded nothing about this, so the dashboard's Live view could list a
 * `--loop` run but not say it was the third of the chain — the position only
 * existed as a banner printed to the terminal that started it. The loop
 * drivers in `cli/commands/run.ts` now hand the position down and
 * {@link initRunRecord} writes it, at run start rather than at run end, since
 * a running run is the only one anybody wants the position of.
 *
 * It has to survive the round trip to be worth anything: `saveRun` writes the
 * record and `loadRun` parses it through `RunRecordSchema`, which strips what
 * it does not declare.
 *
 * @see packages/hench/tests/unit/schema/run-record-schema-drift.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initRunRecord } from "../../../src/agent/lifecycle/shared.js";
import { saveRun, loadRun } from "../../../src/store/runs.js";
import type { RunLoopPosition } from "../../../src/schema/index.js";

let tmpBase: string;
let henchDir: string;

beforeEach(async () => {
  tmpBase = await mkdtemp(join(tmpdir(), "hench-loop-position-"));
  henchDir = join(tmpBase, ".hench");
  await mkdir(join(henchDir, "runs"), { recursive: true });
});

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

async function initWith(loop?: RunLoopPosition) {
  return (await initRunRecord({
    taskId: "t-1",
    taskTitle: "A task",
    model: "claude-sonnet-5",
    henchDir,
    projectDir: tmpBase,
    invocationContext: "cli",
    ...(loop ? { loop } : {}),
  })).run;
}

describe("a run record's loop position", () => {
  it("records the position and the planned total for --iterations=N", async () => {
    const run = await initWith({ mode: "iterations", iteration: 2, max: 5 });
    expect(run.loop).toEqual({ mode: "iterations", iteration: 2, max: 5 });
  });

  it("records a position with no total for --loop, whose end is not knowable", async () => {
    // --loop runs until the tree is out of actionable tasks. A `max` here
    // would be a guess, and "3 of 3" would read as a loop about to finish.
    const run = await initWith({ mode: "loop", iteration: 3 });
    expect(run.loop).toEqual({ mode: "loop", iteration: 3 });
    expect(run.loop?.max).toBeUndefined();
  });

  it("records the position across the whole invocation for --epic-by-epic", async () => {
    const run = await initWith({ mode: "epic-by-epic", iteration: 7 });
    expect(run.loop).toEqual({ mode: "epic-by-epic", iteration: 7 });
  });

  it("writes no loop block for a run started on its own", async () => {
    // Not "iteration 1 of 1": a lone run is not a one-step loop, and a reader
    // that showed a position for it would be inventing a chain.
    const run = await initWith();
    expect(run.loop).toBeUndefined();
    expect(Object.keys(run)).not.toContain("loop");
  });

  it("survives saveRun → loadRun, which strips what the schema does not declare", async () => {
    const run = await initWith({ mode: "iterations", iteration: 4, max: 9 });
    await saveRun(henchDir, run);
    expect((await loadRun(henchDir, run.id))?.loop).toEqual({ mode: "iterations", iteration: 4, max: 9 });
  });

  it("keeps a mode it does not know, so a newer build's record loads with its position intact", async () => {
    const run = await initWith({ mode: "swarm" as RunLoopPosition["mode"], iteration: 2 });
    await saveRun(henchDir, run);
    expect((await loadRun(henchDir, run.id))?.loop).toEqual({ mode: "swarm", iteration: 2 });
  });

  it("loads a record written before loop positions existed", async () => {
    const run = await initWith();
    await saveRun(henchDir, run);
    const loaded = await loadRun(henchDir, run.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.loop).toBeUndefined();
  });
});
