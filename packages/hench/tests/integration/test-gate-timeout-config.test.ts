/**
 * Regression tests for `hench.fullTestTimeoutMs` reaching `runTestGate`.
 *
 * Observed live in run 80c716ff (2026-09-07): the full test gate's only
 * timeout was the hard-coded TEST_GATE_TIMEOUT constant, with no config key
 * or flag to raise it. A suite that runs long under load (e.g. a second
 * `ndx work` competing for cores in another worktree) got killed at the
 * fixed ceiling even though it would have passed given more time.
 *
 * These tests drive `finalizeRun` with a stubbed `runTestGate` spy (the
 * shapes `runTestGate` itself is proven to return in
 * tests/unit/tools/test-runner.test.ts) and assert the `timeout` value that
 * actually reaches it — proving the config key is wired through, not just
 * accepted by the schema.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/index.js";
import type { RunRecord, HenchConfig } from "../../src/schema/index.js";
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

describe("finalizeRun wires hench.fullTestTimeoutMs into runTestGate", () => {
  let projectDir: string;
  let henchDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-gate-timeout-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { test: "vitest run" } }),
      "utf-8",
    );

    // Captured via the console spy rather than output.js's getCapturedLines():
    // withGateSpy() calls vi.resetModules(), so a re-imported shared.js pulls
    // in a fresh output.js module instance whose in-memory buffer is
    // disconnected from anything statically imported at the top of this file.
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.doUnmock("../../src/tools/test-runner.js");
    vi.restoreAllMocks();
    vi.resetModules();
    await rm(projectDir, { recursive: true, force: true });
  });

  /** Mock runTestGate with a spy that records the options it was called with. */
  async function withGateSpy() {
    const spy = vi.fn(async () => ({
      ran: true,
      passed: true,
      packages: [{ name: "workspace", passed: true }],
      command: "pnpm test",
      totalDurationMs: 10,
    }));

    vi.resetModules();
    vi.doMock("../../src/tools/test-runner.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../src/tools/test-runner.js")>()),
      runTestGate: spy,
    }));

    const finalizeRun = (await import("../../src/agent/lifecycle/shared.js")).finalizeRun;
    return { finalizeRun, spy };
  }

  it("passes the configured fullTestTimeoutMs through to runTestGate, and prints it", async () => {
    const { finalizeRun, spy } = await withGateSpy();

    const config: HenchConfig = {
      ...DEFAULT_HENCH_CONFIG(),
      fullTestCommand: "echo ok",
      fullTestTimeoutMs: 42_000,
    };

    const run = buildMinimalRun();
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      config,
      store: buildMockStore("in_progress"),
      rollbackOnFailure: false,
      autonomous: true,
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 42_000 }),
    );

    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("echo ok");
    expect(printed).toContain("timeout 42s");
  });

  it("falls back to the 900_000ms default when fullTestTimeoutMs is not configured", async () => {
    const { finalizeRun, spy } = await withGateSpy();

    const config: HenchConfig = {
      ...DEFAULT_HENCH_CONFIG(),
      fullTestCommand: "echo ok",
    };

    const run = buildMinimalRun();
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      config,
      store: buildMockStore("in_progress"),
      rollbackOnFailure: false,
      autonomous: true,
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 900_000 }),
    );
  });
});
