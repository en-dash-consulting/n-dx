import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";
import { initGitFixtureRepo } from "../helpers/index.js";

const execAsync = promisify(execCb);

/**
 * Regression tests for the express-prompt gate on the rollbackOnFailure
 * revert (finalizeRun → performRollbackIfNeeded).
 *
 * Contract:
 * - Only hench's own PRD writes are ever revertable. The agent's source edits
 *   are reported and left alone, whatever the answer.
 * - Interactive TTY failed run prompts before reverting and defaults to Yes,
 *   so an empty answer (bare Enter) restores the pre-run PRD state.
 * - An explicit 'n' preserves the working tree.
 * - Autonomous runs never prompt and never revert.
 */

/** The PRD file the fixture commits and each test then dirties. */
const PRD_FILE = ".rex/prd_tree/task-slug/index.md";

/**
 * Commit a PRD file and a source file, so every test can dirty one of each and
 * assert which side a revert is allowed to touch.
 */
async function seedRepo(dir: string): Promise<void> {
  await mkdir(join(dir, ".rex", "prd_tree", "task-slug"), { recursive: true });
  await writeFile(join(dir, PRD_FILE), "status: pending\n", "utf-8");
  await writeFile(join(dir, "src.ts"), "export const x = 1;\n", "utf-8");
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

    await initGitFixtureRepo(projectDir);

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

    await seedRepo(projectDir);
    await writeFile(join(projectDir, PRD_FILE), "status: completed\n", "utf-8");
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

      expect(await readFile(join(projectDir, PRD_FILE), "utf-8")).toBe("status: completed\n");
      expect(await readFile(join(projectDir, "src.ts"), "utf-8")).toBe("export const x = 999;\n");
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("defaults to Yes — a bare Enter restores the PRD and leaves the agent's work alone", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    // The shape that made this a data-loss path: hench's PRD write and the
    // agent's finished source edit, dirty together. The default answer must
    // undo the first and not touch the second.
    await seedRepo(projectDir);
    await writeFile(join(projectDir, PRD_FILE), "status: completed\n", "utf-8");
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

      // Empty answer == default. Leaving hench's own dirty writes in place is
      // the damage, so the default reverts and restores the pre-run PRD state.
      fakes[0].answer("");
      await finalizePromise;

      expect(await readFile(join(projectDir, PRD_FILE), "utf-8")).toBe("status: pending\n");
      // …and the agent's work survives the same keystroke that reverted the PRD.
      expect(await readFile(join(projectDir, "src.ts"), "utf-8")).toBe("export const x = 999;\n");
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("an accepted revert removes agent-created files under the PRD only, preserving pre-existing and out-of-scope work", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await seedRepo(projectDir);
    // Pre-existing untracked work inside the PRD (in the pre-run baseline).
    await writeFile(join(projectDir, ".rex/prd_tree/pre-existing.md"), "// mine\n", "utf-8");
    // Changes made during the run: hench's PRD write, an agent-created PRD
    // file, the agent's own source edit, and the agent's scratch file.
    await writeFile(join(projectDir, PRD_FILE), "status: completed\n", "utf-8");
    await writeFile(join(projectDir, ".rex/prd_tree/new-task.md"), "status: pending\n", "utf-8");
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
        baselineUntracked: [".rex/prd_tree/pre-existing.md"],
      });

      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);

      fakes[0].answer("y");
      await finalizePromise;

      // hench's own tracked PRD write is reverted.
      expect(await readFile(join(projectDir, PRD_FILE), "utf-8")).toBe("status: pending\n");

      // Explicit confirmation authorizes removing agent-created files under
      // the PRD — a half-written tree entry is hench's mess to clean up...
      await expect(readFile(join(projectDir, ".rex/prd_tree/new-task.md"), "utf-8")).rejects.toThrow();

      // ...but never pre-existing untracked work, baseline or not (#303)...
      expect(await readFile(join(projectDir, ".rex/prd_tree/pre-existing.md"), "utf-8")).toBe("// mine\n");

      // ...and never anything outside the PRD, tracked or untracked. Out of
      // scope means out of reach: both of these are the agent's work.
      expect(await readFile(join(projectDir, "src.ts"), "utf-8")).toBe("export const x = 999;\n");
      expect(await readFile(join(projectDir, "scratch.ts"), "utf-8")).toBe("// untracked\n");
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("does not prompt at all when nothing hench wrote is dirty", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    // Only the agent's work is dirty. There is nothing hench may offer to
    // revert, so the question is never asked — a prompt here would only be an
    // invitation to discard work by answering the default.
    await seedRepo(projectDir);
    await writeFile(join(projectDir, "src.ts"), "export const x = 999;\n", "utf-8");

    const priorListeners = detachExistingSigintListeners();
    try {
      const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
      await finalizeRun({
        run: buildFailedRun(),
        henchDir,
        projectDir,
        rollbackOnFailure: true,
      });

      expect(fakes).toHaveLength(0);
      expect(await readFile(join(projectDir, "src.ts"), "utf-8")).toBe("export const x = 999;\n");
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("never reverts in autonomous mode, even on a TTY (no prompt, nothing discarded)", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await seedRepo(projectDir);
    await writeFile(join(projectDir, PRD_FILE), "status: completed\n", "utf-8");
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

      // ...and nothing is discarded — hench's own PRD write stays...
      expect(await readFile(join(projectDir, PRD_FILE), "utf-8")).toBe("status: completed\n");

      // ...the agent's tracked changes stay...
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
