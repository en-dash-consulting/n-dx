import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";
import type { PRDStore } from "../../src/prd/rex-gateway.js";
import type { PRDItem, PRDDocument, RexConfig, LogEntry } from "rex";

/**
 * A test gate that could not be EXECUTED must not fail the run.
 *
 * This is the lifecycle half of the fix in `runTestGate`. The gate returning
 * `ran: false` with an error is only useful if `finalizeRun` then leaves the run
 * alone — the original defect was a chain, and breaking any link short of the
 * end still lost the work:
 *
 *   gate reports passed:false  ->  autonomous mode aborts
 *     ->  run.status = "failed"
 *       ->  updateCompletedTaskStatus is skipped  (PRD never records the task)
 *         ->  performCommitPromptIfNeeded short-circuits  (no commit)
 *           ->  loop re-selects the same task, 3 strikes, auto-cancel
 *
 * Observed across three consecutive `ndx work --loop` iterations on Windows,
 * where no POSIX `sh` was resolvable: each agent had finished and committed its
 * work, and each run was still recorded as failed with `Test gate failed: ` and
 * nothing after the colon.
 */

function buildMinimalRun(taskId = "task-1"): RunRecord {
  return {
    id: randomUUID(),
    taskId,
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    status: "completed",
    turns: 3,
    tokenUsage: { input: 100, output: 50 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
  };
}

function buildMockStore(initialStatus: PRDItem["status"]): {
  store: PRDStore;
  updatedStatus: () => PRDItem["status"] | undefined;
} {
  let currentStatus: PRDItem["status"] = initialStatus;
  const logs: LogEntry[] = [];

  const store: PRDStore = {
    async loadDocument(): Promise<PRDDocument> {
      return { version: 1, title: "Test", items: [] };
    },
    async saveDocument(): Promise<void> {},
    async getItem(id: string): Promise<PRDItem | null> {
      if (id !== "task-1") return null;
      return { id: "task-1", title: "Test task", status: currentStatus, level: "task" } as PRDItem;
    },
    async addItem(): Promise<void> {},
    async updateItem(_id: string, updates: Partial<PRDItem>): Promise<void> {
      if (updates.status) currentStatus = updates.status;
    },
    async removeItem(): Promise<void> {},
    async loadConfig(): Promise<RexConfig> {
      return {} as RexConfig;
    },
    async saveConfig(): Promise<void> {},
    async appendLog(entry: LogEntry): Promise<void> {
      logs.push(entry);
    },
    async readLog(): Promise<LogEntry[]> {
      return logs;
    },
    async loadWorkflow(): Promise<string> {
      return "";
    },
    async saveWorkflow(): Promise<void> {},
    async withTransaction<T>(fn: (doc: PRDDocument) => Promise<T>): Promise<T> {
      return fn(await this.loadDocument());
    },
    capabilities() {
      return { adapter: "mock", supportsTransactions: false, supportsWatch: false };
    },
  };

  return { store, updatedStatus: () => currentStatus };
}

describe("finalizeRun with an inconclusive test gate", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-gate-inconclusive-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    // Gives resolveTestCommand something to find, so the gate is reached rather
    // than short-circuited by a resolution failure.
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { test: "vitest run" } }),
      "utf-8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.doUnmock("../../src/tools/test-runner.js");
    vi.restoreAllMocks();
    vi.resetModules();
    await rm(projectDir, { recursive: true, force: true });
  });

  /** Stub runTestGate with a fixed outcome, leaving the rest of the module real. */
  async function withGateResult(gate: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock("../../src/tools/test-runner.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../src/tools/test-runner.js")>()),
      runTestGate: async () => gate,
    }));
    return (await import("../../src/agent/lifecycle/shared.js")).finalizeRun;
  }

  it("keeps the run completed and writes the PRD when the gate never launched", async () => {
    const finalizeRun = await withGateResult({
      ran: false,
      passed: false,
      packages: [],
      command: "npm run test",
      totalDurationMs: 1,
      error: "Test gate could not be executed — the command was never launched (spawn sh ENOENT)",
    });

    const { store, updatedStatus } = buildMockStore("in_progress");
    const run = buildMinimalRun();

    await finalizeRun({
      run,
      henchDir,
      projectDir,
      store,
      rollbackOnFailure: false,
      autonomous: true,
    });

    // The crux. Before the fix this was "failed", which suppressed everything below.
    expect(run.status).toBe("completed");

    // No error is attached: nothing failed, the gate simply could not report.
    expect(run.error).toBeUndefined();

    // And the PRD write actually happened — this is the consequence operators
    // felt, since the loop re-selected a task whose work was already committed.
    expect(updatedStatus()).toBe("completed");
  });

  it("still fails the run when the gate ran and the tests genuinely failed", async () => {
    const finalizeRun = await withGateResult({
      ran: true,
      passed: false,
      packages: [{ name: "rex", passed: false, failureOutput: "1 failed" }],
      command: "npm run test",
      totalDurationMs: 10,
    });

    const { store, updatedStatus } = buildMockStore("in_progress");
    const run = buildMinimalRun();

    await finalizeRun({
      run,
      henchDir,
      projectDir,
      store,
      rollbackOnFailure: false,
      autonomous: true,
    });

    // Regression guard for the fix above: a real failure must still stop the run,
    // and must NOT record the task as completed.
    expect(run.status).toBe("failed");
    expect(run.error).toContain("rex");
    expect(updatedStatus()).not.toBe("completed");
  });

  it("names a reason instead of a bare trailing colon when no packages are reported", async () => {
    const finalizeRun = await withGateResult({
      ran: true,
      passed: false,
      packages: [],
      command: "npm run test",
      totalDurationMs: 10,
      error: "runner output could not be parsed",
    });

    const run = buildMinimalRun();
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      store: buildMockStore("in_progress").store,
      rollbackOnFailure: false,
      autonomous: true,
    });

    expect(run.status).toBe("failed");
    // `Test gate failed: ` with nothing after it was the actual operator-facing
    // output for three consecutive runs, and said nothing about the cause.
    expect(run.error).not.toMatch(/:\s*$/);
    expect(run.error).toContain("runner output could not be parsed");
  });

  it("does not spin to the retry cap when the gate cannot launch", async () => {
    let calls = 0;
    vi.resetModules();
    vi.doMock("../../src/tools/test-runner.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../src/tools/test-runner.js")>()),
      runTestGate: async () => {
        calls++;
        return { ran: false, passed: false, packages: [], error: "never launched" };
      },
    }));
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const run = buildMinimalRun();
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      store: buildMockStore("in_progress").store,
      rollbackOnFailure: false,
      autonomous: true,
    });

    // The loop used to do nothing on this branch, leaving gateComplete false and
    // re-running an unlaunchable command until the 5-attempt cap, then failing
    // the run for exhausting its retries.
    expect(calls).toBe(1);
    expect(run.status).toBe("completed");
  });
});
