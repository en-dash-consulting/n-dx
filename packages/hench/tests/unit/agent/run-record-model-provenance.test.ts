/**
 * A run record says which model ran, at what tier, and which setting chose it.
 *
 * `weight` used to be written as the tier `agent.execute` routes to, read off
 * config at the moment the record was created. So every record said "standard"
 * — including runs an explicit `--model`, a `hench.models` pin or a task's own
 * saved settings had put on the heavy-tier model — and `ndx usage` priced them
 * at the standard rate. The caller resolves the real tier now (`weightOfModel`
 * in cli/commands/run-settings.ts) and hands it down, alongside `modelSource`,
 * which names the setting the model came from.
 *
 * Both have to survive the round trip to be worth anything: `saveRun` writes
 * the record and `loadRun` parses it through `RunRecordSchema`, which strips
 * what it does not declare — the way eight earlier fields were silently lost.
 *
 * @see packages/hench/tests/unit/schema/run-record-schema-drift.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initRunRecord } from "../../../src/agent/lifecycle/shared.js";
import { saveRun, loadRun } from "../../../src/store/runs.js";

let tmpBase: string;
let henchDir: string;

beforeEach(async () => {
  tmpBase = await mkdtemp(join(tmpdir(), "hench-model-provenance-"));
  henchDir = join(tmpBase, ".hench");
  await mkdir(join(henchDir, "runs"), { recursive: true });
});

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

describe("the model's tier and source on a run record", () => {
  it("records the weight the caller resolved, not the field's default", async () => {
    const { run } = await initRunRecord({
      taskId: "t-1",
      taskTitle: "Heavy task",
      model: "claude-opus-5-5",
      henchDir,
      projectDir: tmpBase,
      invocationContext: "cli",
      weight: "heavy",
      modelSource: "task.run.models",
    });

    expect(run.weight).toBe("heavy");
    expect(run.modelSource).toBe("task.run.models");

    await saveRun(henchDir, run);
    const loaded = await loadRun(henchDir, run.id);
    expect(loaded.weight).toBe("heavy");
    expect(loaded.modelSource).toBe("task.run.models");
  });

  it("still defaults the weight to standard, and leaves the source absent, for a caller that supplies neither", async () => {
    // The floor for a caller that cannot compute a tier — not a routing
    // decision, and not a claim about where the model came from.
    const { run } = await initRunRecord({
      taskId: "t-2",
      taskTitle: "Plain task",
      model: "claude-sonnet-5",
      henchDir,
      projectDir: tmpBase,
      invocationContext: "cli",
    });

    expect(run.weight).toBe("standard");
    expect(run.modelSource).toBeUndefined();
  });

  it("keeps a weight that names no tier, so a custom model is not filed as standard", async () => {
    const { run } = await initRunRecord({
      taskId: "t-3",
      taskTitle: "Custom task",
      model: "claude-3-5-haiku-20241022",
      henchDir,
      projectDir: tmpBase,
      invocationContext: "cli",
      weight: "custom",
      modelSource: "cli-flag",
    });

    await saveRun(henchDir, run);
    expect((await loadRun(henchDir, run.id)).weight).toBe("custom");
  });
});
