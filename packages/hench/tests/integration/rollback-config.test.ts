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
 * Integration tests for the hench.rollbackOnFailure config key under the
 * prompt-only rollback contract.
 *
 * A revert never occurs without an express interactive confirmation. These
 * tests run under a non-TTY stdin, so the working tree is always preserved
 * on failure — regardless of the config key or --yes. What the config key
 * still governs (whether the interactive prompt is offered at all) is only
 * observable on a TTY and is covered in rollback-prompt.test.ts.
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

describe("rollbackOnFailure config key (prompt-only)", () => {
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
    expect(process.stdin.isTTY).toBeFalsy();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("preserves changes when config.rollbackOnFailure=false", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    // Set rollbackOnFailure=false in the hench config (simulates .n-dx.json override)
    const config = await import("../../src/store/config.js").then((m) => m.loadConfig(henchDir));
    await saveConfig(henchDir, { ...config, rollbackOnFailure: false });

    const modifiedContent = "console.log('modified by agent');\n";
    await makeInitialCommit(projectDir, "src.ts", "console.log('original');\n");
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    await finalizeRun({ run: buildMinimalRun("failed"), henchDir, projectDir, rollbackOnFailure: false });

    const fileContent = await readFile(join(projectDir, "src.ts"), "utf-8");
    expect(fileContent).toBe(modifiedContent);
  });

  it("preserves changes when config.rollbackOnFailure=true in a non-interactive run", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modified = "export const x = 999;\n";
    await makeInitialCommit(projectDir, "lib.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "lib.ts"), modified, "utf-8");

    // Config key = true only enables the interactive prompt; with no TTY there
    // is no confirmation, so nothing is reverted.
    await finalizeRun({ run: buildMinimalRun("failed"), henchDir, projectDir, rollbackOnFailure: true });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(modified);
  });
});

describe("non-interactive runs never revert (CI / --yes)", () => {
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

  it("leaves changes in place without prompting or hanging in a non-TTY environment (CI)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    // In test environments process.stdin.isTTY is always false (non-interactive).
    expect(process.stdin.isTTY).toBeFalsy();

    const modified = "export const ci = false;\n";
    await makeInitialCommit(projectDir, "ci.ts", "export const ci = true;\n");
    await writeFile(join(projectDir, "ci.ts"), modified, "utf-8");

    // Must complete without hanging on a readline prompt, and without reverting.
    await finalizeRun({ run: buildMinimalRun("failed"), henchDir, projectDir, rollbackOnFailure: true });

    const content = await readFile(join(projectDir, "ci.ts"), "utf-8");
    expect(content).toBe(modified);
  });

  it("leaves changes in place when yes=true (--yes never reverts)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modified = "export const prompted = true;\n";
    await makeInitialCommit(projectDir, "flag.ts", "export const prompted = false;\n");
    await writeFile(join(projectDir, "flag.ts"), modified, "utf-8");

    // yes=true is non-interactive → no prompt is shown, so no revert occurs.
    await finalizeRun({ run: buildMinimalRun("failed"), henchDir, projectDir, rollbackOnFailure: true, yes: true });

    const content = await readFile(join(projectDir, "flag.ts"), "utf-8");
    expect(content).toBe(modified);
  });

  it("leaves files unchanged and still resets PRD status on failure", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modified = "export const kept = false;\n";
    await makeInitialCommit(projectDir, "kept.ts", "export const kept = true;\n");
    await writeFile(join(projectDir, "kept.ts"), modified, "utf-8");

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

    await finalizeRun({ run: buildMinimalRun("failed"), henchDir, projectDir, rollbackOnFailure: true, yes: true, store });

    // File changes NOT reverted (prompt-only, non-interactive).
    const content = await readFile(join(projectDir, "kept.ts"), "utf-8");
    expect(content).toBe(modified);

    // PRD status IS reset regardless of rollback behavior.
    expect(currentStatus).toBe("pending");
  });
});
