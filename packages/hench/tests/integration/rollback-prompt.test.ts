import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";

const execAsync = promisify(execCb);

/**
 * Regression tests for the express-prompt gate on the rollbackOnFailure
 * revert (finalizeRun → performRollbackIfNeeded).
 *
 * Contract:
 * - Interactive TTY failed run prompts before reverting and defaults to No,
 *   so an empty answer (bare Enter) preserves the working tree.
 * - An explicit 'y' reverts.
 * - Autonomous runs never prompt and keep the unattended auto-revert.
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

function buildFailedRun(): RunRecord {
  return {
    id: randomUUID(),
    taskId: "task-1",
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    status: "failed",
    turns: 3,
    tokenUsage: { input: 100, output: 50 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
  };
}

interface FakeReadlineHandle {
  answer: (text: string) => void;
  closed: boolean;
}

/**
 * Install a fake `node:readline` so tests can drive the confirmation
 * prompt deterministically. `fakes` captures every interface the code
 * under test opens — its length is also the assertion that a prompt did
 * (or did not) appear.
 */
function installFakeReadline(): { fakes: FakeReadlineHandle[] } {
  const fakes: FakeReadlineHandle[] = [];
  vi.doMock("node:readline", () => ({
    createInterface: () => {
      let answerCb: ((answer: string) => void) | undefined;
      const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
      const fake: FakeReadlineHandle = {
        answer: (text: string) => answerCb?.(text),
        closed: false,
      };
      fakes.push(fake);
      return {
        question: (_q: string, cb: (answer: string) => void) => {
          answerCb = cb;
        },
        close: () => {
          fake.closed = true;
        },
        on: (event: string, listener: (...a: unknown[]) => void) => {
          (listeners[event] ??= []).push(listener);
        },
        removeListener: (event: string, listener: (...a: unknown[]) => void) => {
          const arr = listeners[event];
          if (!arr) return;
          const idx = arr.indexOf(listener);
          if (idx >= 0) arr.splice(idx, 1);
        },
      };
    },
  }));
  return { fakes };
}

async function waitForFakePrompt(fakes: FakeReadlineHandle[]): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (fakes.length === 0 && Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 10));
  }
}

/** Detach outer SIGINT listeners so the prompt shim runs in isolation. */
function detachExistingSigintListeners(): Array<(...a: unknown[]) => void> {
  const saved = process.listeners("SIGINT") as Array<(...a: unknown[]) => void>;
  for (const l of saved) process.removeListener("SIGINT", l);
  return saved;
}

function restoreSigintListeners(saved: Array<(...a: unknown[]) => void>): void {
  for (const l of process.listeners("SIGINT") as Array<(...a: unknown[]) => void>) {
    process.removeListener("SIGINT", l);
  }
  for (const l of saved) process.on("SIGINT", l);
}

describe("rollbackOnFailure express-prompt gate", () => {
  let projectDir: string;
  let henchDir: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-rollback-prompt-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await setupGitRepo(projectDir);

    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(async () => {
    vi.doUnmock("node:readline");
    vi.resetModules();
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    await rm(projectDir, { recursive: true, force: true });
  });

  it("preserves the working tree when the interactive prompt is declined", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "src.ts"), "export const x = 999;\n", "utf-8");

    const priorListeners = detachExistingSigintListeners();
    try {
      const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
      const finalizePromise = finalizeRun({
        run: buildFailedRun(),
        henchDir,
        projectDir,
        rollbackOnFailure: true,
      });

      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);

      fakes[0].answer("n");
      await finalizePromise;

      const content = await readFile(join(projectDir, "src.ts"), "utf-8");
      expect(content).toBe("export const x = 999;\n");
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("defaults to No — a bare Enter preserves the working tree", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "src.ts"), "export const x = 999;\n", "utf-8");

    const priorListeners = detachExistingSigintListeners();
    try {
      const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
      const finalizePromise = finalizeRun({
        run: buildFailedRun(),
        henchDir,
        projectDir,
        rollbackOnFailure: true,
      });

      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);

      // Empty answer == default. For a destructive revert the default is No.
      fakes[0].answer("");
      await finalizePromise;

      const content = await readFile(join(projectDir, "src.ts"), "utf-8");
      expect(content).toBe("export const x = 999;\n");
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("reverts tracked changes and removes agent-created untracked files when the prompt is accepted, preserving pre-existing untracked work", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    // Pre-existing untracked work (in the pre-run baseline — think `.env`).
    await writeFile(join(projectDir, "pre-existing.ts"), "// mine\n", "utf-8");
    // Changes made during the run: a tracked edit and an agent-created file.
    await writeFile(join(projectDir, "src.ts"), "export const x = 999;\n", "utf-8");
    await writeFile(join(projectDir, "scratch.ts"), "// untracked\n", "utf-8");

    const priorListeners = detachExistingSigintListeners();
    try {
      const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
      const finalizePromise = finalizeRun({
        run: buildFailedRun(),
        henchDir,
        projectDir,
        rollbackOnFailure: true,
        baselineUntracked: ["pre-existing.ts"],
      });

      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);

      fakes[0].answer("y");
      await finalizePromise;

      // Tracked change reverted.
      const content = await readFile(join(projectDir, "src.ts"), "utf-8");
      expect(content).toBe("export const x = 1;\n");

      // Explicit confirmation authorizes removing agent-created files...
      await expect(readFile(join(projectDir, "scratch.ts"), "utf-8")).rejects.toThrow();

      // ...but the confirmed revert stays scoped: pre-existing untracked
      // work (the baseline) is never deleted (#303).
      const preExisting = await readFile(join(projectDir, "pre-existing.ts"), "utf-8");
      expect(preExisting).toBe("// mine\n");
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("never reverts in autonomous mode, even on a TTY (no prompt, nothing discarded)", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "src.ts"), "export const x = 999;\n", "utf-8");
    await writeFile(join(projectDir, "scratch.ts"), "// untracked\n", "utf-8");

    const priorListeners = detachExistingSigintListeners();
    try {
      const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
      await finalizeRun({
        run: buildFailedRun(),
        henchDir,
        projectDir,
        rollbackOnFailure: true,
        autonomous: true,
      });

      // Autonomous is non-interactive, so no confirmation prompt is opened...
      expect(fakes).toHaveLength(0);

      // ...and nothing is discarded — tracked changes stay...
      const content = await readFile(join(projectDir, "src.ts"), "utf-8");
      expect(content).toBe("export const x = 999;\n");

      // ...and untracked work stays too.
      const untracked = await readFile(join(projectDir, "scratch.ts"), "utf-8");
      expect(untracked).toBe("// untracked\n");
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });
});
