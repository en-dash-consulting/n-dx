/**
 * Regression tests for the lifecycle's test-gate failure reporting.
 *
 * Observed live in run 80c716ff (2026-09-07): the gate hit its 5-minute
 * timeout under CPU contention, and the run ended with `run.error = "Test
 * gate failed: "` and the console line `[Test Gate] ✗ 0/0 package(s) failed`.
 * Nothing named the timeout, the command, or how long it ran — the operator
 * had to reproduce the failure by hand to learn any of that.
 *
 * These tests drive `finalizeRun` with a stubbed `runTestGate` result (the
 * shapes `runTestGate` itself is proven to return in
 * tests/unit/tools/test-runner.test.ts) and assert what reaches the operator:
 * `run.error`, `run.diagnostics`, and the persisted run log.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";
import type { PRDStore } from "../../src/prd/rex-gateway.js";
import type { PRDItem, PRDDocument, RexConfig, LogEntry } from "rex";

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

function buildMockStore(initialStatus: PRDItem["status"]): PRDStore {
  let currentStatus: PRDItem["status"] = initialStatus;
  const logs: LogEntry[] = [];

  return {
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
}

describe("finalizeRun test-gate failure messages and diagnostics", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-gate-message-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

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

  it("names the timeout, the command, and the elapsed seconds in run.error", async () => {
    const finalizeRun = await withGateResult({
      ran: true,
      passed: false,
      packages: [{ name: "workspace", passed: false, failureOutput: "…" }],
      command: "npm run test",
      totalDurationMs: 320_000,
      error: "Test command timed out after 5m 0s (ran for 5m 20s)",
      outputTail: "running packages/rex…\n",
    });

    const run = buildMinimalRun();
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      store: buildMockStore("in_progress"),
      rollbackOnFailure: false,
      autonomous: true,
    });

    expect(run.status).toBe("failed");
    expect(run.error).toContain("timed out");
    expect(run.error).toContain("npm run test");
    expect(run.error).toContain("5m 20s");
  });

  it("reports 'no per-package results were parsed' instead of 0/0 when the gate hands back no packages", async () => {
    const finalizeRun = await withGateResult({
      ran: true,
      passed: false,
      packages: [],
      command: "npm run test",
      totalDurationMs: 10,
    });

    const run = buildMinimalRun();
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      store: buildMockStore("in_progress"),
      rollbackOnFailure: false,
      autonomous: true,
    });

    expect(run.status).toBe("failed");
    expect(run.error).not.toMatch(/0\/0/);
    expect(run.error).toContain("no per-package results were parsed");
  });

  it("stores the gate's output tail on run.diagnostics and in the persisted run log", async () => {
    const finalizeRun = await withGateResult({
      ran: true,
      passed: false,
      packages: [{ name: "workspace", passed: false, failureOutput: "…" }],
      command: "npm run test",
      totalDurationMs: 320_000,
      error: "Test command timed out after 5m 0s (ran for 5m 20s)",
      outputTail: "line 1 of the hung suite\nline 2 of the hung suite",
    });

    const run = buildMinimalRun();
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      store: buildMockStore("in_progress"),
      rollbackOnFailure: false,
      autonomous: true,
    });

    expect(run.diagnostics?.testGateOutputTail).toContain("line 1 of the hung suite");

    const logDir = join(projectDir, ".run-logs");
    const files = await readdir(logDir);
    expect(files.length).toBeGreaterThan(0);
    const logContent = await readFile(join(logDir, files[0]), "utf-8");
    expect(logContent).toContain("line 1 of the hung suite");
    expect(logContent).toContain("line 2 of the hung suite");
  });

  it("does not report any package as failed when the gate passes", async () => {
    const finalizeRun = await withGateResult({
      ran: true,
      passed: true,
      packages: [{ name: "workspace", passed: true }],
      command: "npm run test",
      totalDurationMs: 198_000,
    });

    const run = buildMinimalRun();
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      store: buildMockStore("in_progress"),
      rollbackOnFailure: false,
      autonomous: true,
    });

    expect(run.status).toBe("completed");
    expect(run.error).toBeUndefined();
  });
});
