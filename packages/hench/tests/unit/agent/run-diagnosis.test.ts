import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { PRDStore } from "../../../src/prd/rex-gateway.js";
import type { RunRecord } from "../../../src/schema/index.js";
import { loadRun, saveRun } from "../../../src/store/runs.js";
import { initConfig } from "../../../src/store/config.js";
import { fillFailureReason, recordRunDiagnosis } from "../../../src/agent/lifecycle/run-diagnosis.js";
import { cmdRuns } from "../../../src/cli/commands/runs.js";
import { CLIError } from "../../../src/cli/errors.js";

/**
 * The file side of the run classifier: what the run-end path stores, the
 * failureReason it fills, and what `hench runs diagnose` prints.
 */

function makeRun(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-001",
    taskId: "task-42",
    taskTitle: "A task",
    startedAt: "2026-10-28T10:00:00.000Z",
    finishedAt: "2026-10-28T10:10:00.000Z",
    status: "timeout",
    turns: 30,
    tokenUsage: { input: 1, output: 1 },
    toolCalls: [],
    model: "sonnet",
    commits: [{ sha: "a".repeat(40), subject: "wip" }],
    ...over,
  };
}

/** A store double holding one item; records every update. */
function fakeStore(item: { id: string; failureReason?: string } | null) {
  const updates: Array<{ id: string; updates: Record<string, unknown> }> = [];
  const store = {
    getItem: vi.fn(async (id: string) => (item && item.id === id ? { ...item, title: "t", status: "pending", level: "task" } : null)),
    updateItem: vi.fn(async (id: string, u: Record<string, unknown>) => { updates.push({ id, updates: u }); }),
  } as unknown as PRDStore;
  return { store, updates };
}

describe("run diagnosis — run end", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-diagnosis-"));
    henchDir = join(projectDir, ".hench");
    await mkdir(join(henchDir, "runs"), { recursive: true });
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("stores the verdict on a run that did not complete, and it survives save and load", async () => {
    const run = makeRun();
    const diagnosis = await recordRunDiagnosis({ projectDir, henchDir,run });
    expect(diagnosis?.class).toBe("budget-timeout");
    expect(run.diagnosis).toEqual(diagnosis);

    await saveRun(henchDir, run);
    expect((await loadRun(henchDir, run.id)).diagnosis).toEqual(diagnosis);
  });

  it("stores nothing on a completed run", async () => {
    const run = makeRun({ status: "completed" });
    expect(await recordRunDiagnosis({ projectDir, henchDir,run })).toBeUndefined();
    expect(run.diagnosis).toBeUndefined();
  });

  it("a record written before the field existed still loads", async () => {
    const run = makeRun();
    await saveRun(henchDir, run);
    const loaded = await loadRun(henchDir, run.id);
    expect(loaded.id).toBe(run.id);
    expect(loaded.diagnosis).toBeUndefined();
  });

  it("counts the task's earlier failed runs as attempts", async () => {
    await saveRun(henchDir, makeRun({ id: "run-000", startedAt: "2026-10-28T09:00:00.000Z" }));
    const run = makeRun();
    const diagnosis = await recordRunDiagnosis({ projectDir, henchDir,run });
    expect(diagnosis?.attempt).toEqual({ n: 2, of: 2 });
  });

  it("reads the review report from disk", async () => {
    const reportPath = join(henchDir, "reviews", "run-001.json");
    await mkdir(join(henchDir, "reviews"), { recursive: true });
    await writeFile(reportPath, JSON.stringify({
      taskId: "task-42", fixesApplied: false, summary: "s",
      findings: [{ title: "Leaks a handle", severity: "high", verdict: "must-fix", scenario: "x", action: "failed" }],
    }));
    const run = makeRun({ status: "failed", review: { failed: "must-fix-unresolved", detail: "open", reportPath } });
    const diagnosis = await recordRunDiagnosis({ projectDir, henchDir,run });
    expect(diagnosis?.class).toBe("review-blocked");
    expect(diagnosis?.evidence).toContain("must-fix: Leaks a handle");
  });

  it("reads file edits from the events file", async () => {
    const eventsPath = join(henchDir, "runs", "run-001.events.jsonl");
    await writeFile(eventsPath, [
      JSON.stringify({ kind: "file_edited", at: "t", summary: "Edited", detail: "src/widget.ts" }),
      "{torn",
    ].join("\n"));
    const run = makeRun({
      status: "failed",
      eventsPath,
      testGate: { ran: true, passed: false, packages: [], failureDigest: "FAIL src/widget.ts > x" },
    });
    expect((await recordRunDiagnosis({ projectDir, henchDir,run }))?.class).toBe("test-gate-new");
  });

  it("writes the summary as failureReason when the task has none", async () => {
    const { store, updates } = fakeStore({ id: "task-42" });
    const run = makeRun();
    const diagnosis = await recordRunDiagnosis({ projectDir, henchDir,run, store });
    expect(updates).toEqual([{ id: "task-42", updates: { failureReason: diagnosis!.summary } }]);
  });

  it("never overwrites an existing failureReason", async () => {
    const { store, updates } = fakeStore({ id: "task-42", failureReason: "Operator: flaky CI" });
    await recordRunDiagnosis({ projectDir, henchDir,run: makeRun(), store });
    expect(updates).toEqual([]);
    expect(await fillFailureReason(store, "task-42", "x")).toBe(false);
  });
});

describe("hench runs diagnose", () => {
  let projectDir: string;
  let henchDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-runs-cli-"));
    await initConfig(projectDir);
    henchDir = join(projectDir, ".hench");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    logSpy.mockRestore();
    await rm(projectDir, { recursive: true, force: true });
  });

  const printed = (): string => logSpy.mock.calls.map((c) => c.join(" ")).join("\n");

  it("--format=json prints runId, taskId, class, summary, evidence, actions and attempt", async () => {
    await saveRun(henchDir, makeRun());
    await cmdRuns(projectDir, ["diagnose", "run-001"], { format: "json" });
    const out = JSON.parse(printed());
    expect(Object.keys(out).sort()).toEqual(["actions", "attempt", "class", "evidence", "runId", "summary", "taskId"]);
    expect(out).toMatchObject({ runId: "run-001", taskId: "task-42", class: "budget-timeout", attempt: { n: 1, of: 2 } });
    expect(out.actions[0]).toMatchObject({ kind: "split-task" });
  });

  it("prints a readable verdict without --format", async () => {
    await saveRun(henchDir, makeRun());
    await cmdRuns(projectDir, ["diagnose", "run-001"], {});
    expect(printed()).toContain("Verdict: budget-timeout — attempt 1 of 2");
  });

  it("an unknown run id is an error with a message", async () => {
    await expect(cmdRuns(projectDir, ["diagnose", "nope"], {})).rejects.toThrow(CLIError);
    await expect(cmdRuns(projectDir, ["diagnose", "nope"], {})).rejects.toThrow("Run not found: nope");
  });

  it("an unknown subcommand is an error", async () => {
    await expect(cmdRuns(projectDir, ["explain", "run-001"], {})).rejects.toThrow("Unknown runs subcommand");
  });
});
