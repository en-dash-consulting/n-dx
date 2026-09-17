import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveRun, loadRun, listRuns } from "../../../src/store/runs.js";
import type { RunRecord } from "../../../src/schema/v1.js";

/**
 * What survives the trip to disk and back.
 *
 * `loadRun` returns the zod-parsed record, so a field the schema does not
 * declare is written by `saveRun` and gone by the time anything reads it —
 * with no error anywhere. These tests hold the round trip itself, field by
 * field, rather than the schema's shape (which
 * `tests/unit/schema/run-record-schema-drift.test.ts` pins).
 *
 * The other half is the opposite failure: a schema strict enough to reject an
 * older record makes `loadRun` throw, and `listRuns` swallows the throw — so
 * one unrecognised field does not lose a field, it loses the whole run.
 */

describe("run record field persistence", () => {
  let tmpBase: string;
  let henchDir: string;

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), "hench-run-fields-"));
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
      startedAt: "2026-09-16T00:00:00Z",
      status: "completed",
      turns: 1,
      tokenUsage: { input: 100, output: 50 },
      toolCalls: [],
      model: "sonnet",
      ...overrides,
    };
  }

  /** What `finalizeRun` writes for the three gate sections. */
  const TEST_GATE = {
    ran: true,
    passed: false,
    packages: [{ name: "packages/hench", passed: false, failureOutput: "AssertionError: nope" }],
    error: "vitest exited 1",
    durationMs: 4200,
  };
  const DEPENDENCY_AUDIT = {
    ran: true,
    skipped: false,
    vulnerabilities: { critical: 0, high: 1, moderate: 2, low: 3 },
    outdated: { major: ["zod"], minor: [], patch: [] },
    totalDurationMs: 900,
  };
  const CLEANUP = {
    ran: true,
    appliedCount: 2,
    rolledBackCount: 1,
    batches: [{ transformations: ["dedupe"], validated: true, rolledBack: false }],
  };

  it("reads back testGate, dependencyAudit and cleanupTransformations intact", async () => {
    await saveRun(henchDir, makeRun({
      id: "gates",
      testGate: TEST_GATE as RunRecord["testGate"],
      dependencyAudit: DEPENDENCY_AUDIT as RunRecord["dependencyAudit"],
      cleanupTransformations: CLEANUP as RunRecord["cleanupTransformations"],
    }));

    const loaded = await loadRun(henchDir, "gates");
    expect(loaded.testGate).toEqual(TEST_GATE);
    expect(loaded.dependencyAudit).toEqual(DEPENDENCY_AUDIT);
    expect(loaded.cleanupTransformations).toEqual(CLEANUP);
    // Nested detail survives too — a passthrough object keeps its whole tree.
    expect(loaded.testGate?.packages?.[0]?.failureOutput).toBe("AssertionError: nope");
  });

  it("reads back the other fields the schema had not been told about", async () => {
    await saveRun(henchDir, makeRun({
      id: "identity",
      vendor: "codex",
      weight: "heavy",
      parentSessionId: "sess-42",
      contextCondensations: 3,
      invocationContext: "api",
    }));

    const loaded = await loadRun(henchDir, "identity");
    expect(loaded).toMatchObject({
      vendor: "codex",
      weight: "heavy",
      parentSessionId: "sess-42",
      contextCondensations: 3,
      invocationContext: "api",
    });
  });

  it("returns through listRuns what loadRun returns", async () => {
    await saveRun(henchDir, makeRun({ id: "listed", vendor: "claude", testGate: TEST_GATE as RunRecord["testGate"] }));
    const [listed] = await listRuns(henchDir);
    expect(listed.vendor).toBe("claude");
    expect(listed.testGate).toEqual(TEST_GATE);
  });

  it("writes to disk exactly what it reads back, for the whole record", async () => {
    const run = makeRun({
      id: "whole",
      vendor: "claude",
      weight: "standard",
      parentSessionId: "sess-1",
      contextCondensations: 1,
      invocationContext: "cli",
      testGate: TEST_GATE as RunRecord["testGate"],
      dependencyAudit: DEPENDENCY_AUDIT as RunRecord["dependencyAudit"],
      cleanupTransformations: CLEANUP as RunRecord["cleanupTransformations"],
      review: { failed: "reviewer never started", gated: true } as RunRecord["review"],
      actor: "Jane <jane@example.com>",
      host: "workstation",
    });
    await saveRun(henchDir, run);

    const onDisk = JSON.parse(await readFile(join(henchDir, "runs", "whole.json"), "utf-8"));
    const loaded = await loadRun(henchDir, "whole");
    // The point of the fix: no key is lost between the file and the reader.
    expect(Object.keys(loaded).sort()).toEqual(Object.keys(onDisk).sort());
    expect(loaded).toEqual(onDisk);
  });

  it("still loads a record written before the newest fields existed", async () => {
    // Exactly the shape an older hench wrote: none of the eight, no review.
    const legacy = {
      id: "legacy",
      taskId: "task-0",
      taskTitle: "Old run",
      startedAt: "2025-01-01T00:00:00Z",
      status: "completed",
      turns: 2,
      tokenUsage: { input: 10, output: 5 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(henchDir, "runs", "legacy.json"), JSON.stringify(legacy), "utf-8");

    const loaded = await loadRun(henchDir, "legacy");
    expect(loaded.id).toBe("legacy");
    expect(loaded.testGate).toBeUndefined();
    // And it is not silently dropped from the list, which is what a rejected
    // record would be — listRuns swallows the throw.
    expect((await listRuns(henchDir)).map((r) => r.id)).toContain("legacy");
  });

  it("keeps a record carrying a value the schema did not anticipate", async () => {
    // A future invocationContext, or a gate section with new sub-fields: the
    // record must load, not be rejected and lost.
    const forward = {
      ...makeRun({ id: "forward" }),
      invocationContext: "scheduler",
      testGate: { ran: true, passed: true, somethingNew: { nested: [1, 2, 3] } },
    };
    await writeFile(join(henchDir, "runs", "forward.json"), JSON.stringify(forward), "utf-8");

    const loaded = await loadRun(henchDir, "forward");
    expect(loaded.invocationContext).toBe("scheduler");
    expect(loaded.testGate).toEqual({ ran: true, passed: true, somethingNew: { nested: [1, 2, 3] } });
    expect((await listRuns(henchDir)).map((r) => r.id)).toContain("forward");
  });
});
