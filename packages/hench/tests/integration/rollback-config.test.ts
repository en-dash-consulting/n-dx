import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig, saveConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";

const execAsync = promisify(execCb);

/**
 * Integration tests for the hench.rollbackOnFailure config key and
 * confirmation UX (CI auto-confirm / --yes flag).
 *
 * These tests verify:
 *  1. hench.rollbackOnFailure=false in config prevents rollback without --no-rollback flag
 *  2. hench.rollbackOnFailure=true in config (default) causes rollback
 *  3. --no-rollback (rollbackOnFailure=false arg) overrides config=true
 *  4. In non-TTY environments (CI), rollback proceeds without a confirmation prompt
 *  5. When yes=true, rollback proceeds without a confirmation prompt
 */

async function setupGitRepo(dir: string): Promise<void> {
  await execAsync("git init", { cwd: dir });
  await execAsync("git config user.email test@test.com", { cwd: dir });
  await execAsync("git config user.name Test", { cwd: dir });
}

async function makeInitialCommit(dir: string, file: string, content: string): Promise<void> {
  await writeFile(join(dir, file), content, "utf-8");
  await execAsync("git add .", { cwd: dir });
  await execAsync('git commit -m "initial"', { cwd: dir });
}

function buildMinimalRun(status: RunRecord["status"]): RunRecord {
  return {
    id: randomUUID(),
    taskId: "task-1",
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    status,
    turns: 3,
    tokenUsage: { input: 100, output: 50 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
  };
}

describe("rollbackOnFailure config key", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-rollback-cfg-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await setupGitRepo(projectDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("does not roll back when config.rollbackOnFailure=false (no --no-rollback flag needed)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    // Set rollbackOnFailure=false in the hench config (simulates .n-dx.json override)
    const config = await import("../../src/store/config.js").then((m) => m.loadConfig(henchDir));
    await saveConfig(henchDir, { ...config, rollbackOnFailure: false });

    const originalContent = "console.log('original');\n";
    const modifiedContent = "console.log('modified by agent');\n";
    await makeInitialCommit(projectDir, "src.ts", originalContent);
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    const run = buildMinimalRun("failed");

    // rollbackOnFailure=false — matches config value, no --no-rollback flag required
    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: false });

    const fileContent = await readFile(join(projectDir, "src.ts"), "utf-8");
    expect(fileContent).toBe(modifiedContent);
  });

  it("rolls back when config.rollbackOnFailure is true (explicit)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "export const x = 1;\n";
    await makeInitialCommit(projectDir, "lib.ts", originalContent);
    await writeFile(join(projectDir, "lib.ts"), "export const x = 999;\n", "utf-8");

    const run = buildMinimalRun("failed");

    // Config key = true → rollback occurs
    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: true });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(originalContent);
  });

  it("rolls back when rollbackOnFailure is omitted (default true)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "export const a = 1;\n";
    await makeInitialCommit(projectDir, "lib.ts", originalContent);
    await writeFile(join(projectDir, "lib.ts"), "export const a = 999;\n", "utf-8");

    const run = buildMinimalRun("failed");

    // No rollbackOnFailure → defaults to true
    await finalizeRun({ run, henchDir, projectDir });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(originalContent);
  });
});

describe("CI auto-confirm (non-TTY rollback)", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-ci-rollback-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await setupGitRepo(projectDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("rolls back without prompting in non-TTY environment (CI mode)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    // In test environments process.stdin.isTTY is always false (non-interactive).
    // This simulates CI where rollback should proceed automatically without a prompt.
    expect(process.stdin.isTTY).toBeFalsy();

    const originalContent = "export const ci = true;\n";
    await makeInitialCommit(projectDir, "ci.ts", originalContent);
    await writeFile(join(projectDir, "ci.ts"), "export const ci = false;\n", "utf-8");

    const run = buildMinimalRun("failed");

    // Should complete without hanging on a readline prompt
    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: true });

    const content = await readFile(join(projectDir, "ci.ts"), "utf-8");
    expect(content).toBe(originalContent);
  });

  it("rolls back without prompting when yes=true (--yes flag equivalent)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "export const prompted = false;\n";
    await makeInitialCommit(projectDir, "flag.ts", originalContent);
    await writeFile(join(projectDir, "flag.ts"), "export const prompted = true;\n", "utf-8");

    const run = buildMinimalRun("failed");

    // yes=true → skip confirmation prompt even if stdin were a TTY
    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: true, yes: true });

    const content = await readFile(join(projectDir, "flag.ts"), "utf-8");
    expect(content).toBe(originalContent);
  });

  it("leaves files unchanged and still resets PRD when rollbackOnFailure=false with yes=true", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const originalContent = "export const kept = true;\n";
    await makeInitialCommit(projectDir, "kept.ts", originalContent);
    await writeFile(join(projectDir, "kept.ts"), "export const kept = false;\n", "utf-8");

    // Build a minimal mock PRD store to verify PRD status reset
    let currentStatus: string = "in_progress";
    const store = {
      async loadDocument() { return { version: 1, title: "Test", items: [] }; },
      async saveDocument() {},
      async getItem(id: string) {
        if (id !== "task-1") return null;
        return { id: "task-1", title: "Test task", status: currentStatus, level: "task" };
      },
      async addItem() {},
      async updateItem(_id: string, updates: Record<string, unknown>) {
        if (updates.status) currentStatus = updates.status as string;
      },
      async removeItem() {},
      async loadConfig() { return {}; },
      async saveConfig() {},
      async appendLog() {},
      async readLog() { return []; },
      async loadWorkflow() { return ""; },
      async saveWorkflow() {},
      async withTransaction<T>(fn: (doc: unknown) => Promise<T>) { return fn({ version: 1, title: "Test", items: [] }); },
      capabilities() { return { adapter: "mock", supportsTransactions: false, supportsWatch: false }; },
    };

    const run = buildMinimalRun("failed");

    // --no-rollback (rollbackOnFailure=false) + yes=true
    await finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: false, yes: true, store });

    // File changes NOT reverted (--no-rollback)
    const content = await readFile(join(projectDir, "kept.ts"), "utf-8");
    expect(content).toBe("export const kept = false;\n");

    // PRD status IS reset regardless of rollback setting
    expect(currentStatus).toBe("pending");
  });
});
