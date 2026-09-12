import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveRun, loadRun, listRuns } from "../../../src/store/runs.js";
import type { RunRecord } from "../../../src/schema/v1.js";

/**
 * `run.review` must survive a save/load round-trip.
 *
 * `loadRun` returns the *zod-parsed* record, and zod strips keys the schema
 * does not declare. `review` was undeclared, so every consumer that reads it
 * off disk — `hench show`, and the stuck-task exemption that keeps a
 * missing-review refusal out of a task's retry budget — was reading
 * `undefined` no matter what was written. In-memory tests could not see it,
 * because they never went through a file.
 */
describe("runs store — review round-trip", () => {
  let tmpBase: string;
  let henchDir: string;

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), "hench-review-roundtrip-"));
    henchDir = join(tmpBase, ".hench");
    await mkdir(join(henchDir, "runs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  function makeRun(overrides: Partial<RunRecord> & { id: string }): RunRecord {
    return {
      taskId: "task-1",
      taskTitle: "Test task",
      startedAt: "2025-01-01T00:00:00Z",
      status: "completed",
      turns: 1,
      tokenUsage: { input: 100, output: 50 },
      toolCalls: [],
      model: "sonnet",
      ...overrides,
    };
  }

  it("preserves a gated missing-review refusal", async () => {
    await saveRun(
      henchDir,
      makeRun({
        id: "run-refused",
        status: "failed",
        review: { failed: "spawn-failed", detail: "API Error: 400", gated: true },
      }),
    );

    const loaded = await loadRun(henchDir, "run-refused");

    // The marker stuck-task detection branches on. Stripped, and one bad
    // --review-model marks every task it touched as stuck.
    expect(loaded.review).toEqual({
      failed: "spawn-failed",
      detail: "API Error: 400",
      gated: true,
    });
  });

  it("preserves a successful review, including fields the schema does not name", async () => {
    const review = {
      model: "claude-opus-5",
      resumedSession: true,
      findingCount: 2,
      unresolvedCount: 1,
      unrepairedMustFixCount: 1,
      failedActionCount: 0,
      fixesApplied: true,
      reportPath: "/proj/.hench/reviews/run-1.json",
      repairedFiles: ["src/a.ts"],
      repairCommit: "abc1234",
    };

    await saveRun(henchDir, makeRun({ id: "run-reviewed", review }));

    expect((await loadRun(henchDir, "run-reviewed")).review).toEqual(review);
  });

  it("keeps a run whose review predates the newest fields", async () => {
    // A record written before classifyUnresolved split the unresolved counts.
    // A strict schema would reject it, and listRuns swallows a rejected
    // record — so the whole run would vanish from usage rollups rather than
    // merely losing a field.
    await writeFile(
      join(henchDir, "runs", "run-legacy.json"),
      JSON.stringify({
        ...makeRun({ id: "run-legacy" }),
        review: { model: "m", resumedSession: false, findingCount: 0, unresolvedCount: 0 },
      }),
      "utf-8",
    );

    const runs = await listRuns(henchDir);

    expect(runs.map((r) => r.id)).toContain("run-legacy");
    expect(runs[0].review).toMatchObject({ model: "m", findingCount: 0 });
  });

  it("reads back as absent when --review was never passed", async () => {
    await saveRun(henchDir, makeRun({ id: "run-plain" }));

    expect((await loadRun(henchDir, "run-plain")).review).toBeUndefined();
  });
});
