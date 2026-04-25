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
 * Integration tests for the SIGINT-suspension shim around the rollback
 * and commit-approval prompts.
 *
 * The run-loop in `packages/hench/src/cli/commands/run.ts` registers a
 * SIGINT handler that calls `process.exit(1)` on a second Ctrl-C. Before
 * opening an interactive readline prompt the lifecycle layer must
 * temporarily detach that handler so a second Ctrl-C does not terminate
 * the process mid-question.
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

function buildCompletedRun(): RunRecord {
  return {
    id: randomUUID(),
    taskId: "task-1",
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

interface FakeReadlineHandle {
  answer: (text: string) => void;
  /** Trigger the readline-surface SIGINT event (raw-mode Ctrl-C path). */
  emitRlSigint: () => void;
  closed: boolean;
}

/**
 * Install a fake `node:readline` module that stores the answer callback
 * and tracks listeners registered via `rl.on(...)`. The returned `fakes`
 * array captures each interface the code under test opens so tests can
 * drive the prompt deterministically.
 */
function installFakeReadline(): { fakes: FakeReadlineHandle[] } {
  const fakes: FakeReadlineHandle[] = [];
  vi.doMock("node:readline", () => ({
    createInterface: () => {
      let answerCb: ((answer: string) => void) | undefined;
      const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
      const fake: FakeReadlineHandle = {
        answer: (text: string) => answerCb?.(text),
        emitRlSigint: () => {
          for (const l of listeners.SIGINT ?? []) l();
        },
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
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(listener);
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

/** Snapshot existing SIGINT listeners and clear the slot for a test. */
function detachExistingSigintListeners(): Array<(...a: unknown[]) => void> {
  const saved = process.listeners("SIGINT") as Array<(...a: unknown[]) => void>;
  for (const l of saved) process.removeListener("SIGINT", l);
  return saved;
}

/** Restore the snapshot — drops whatever the test installed and
 *  re-installs the original set exactly once. */
function restoreSigintListeners(saved: Array<(...a: unknown[]) => void>): void {
  for (const l of process.listeners("SIGINT") as Array<(...a: unknown[]) => void>) {
    process.removeListener("SIGINT", l);
  }
  for (const l of saved) process.on("SIGINT", l);
}

describe("prompt SIGINT suspension", () => {
  let projectDir: string;
  let henchDir: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-sigint-prompt-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await setupGitRepo(projectDir);

    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
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

  it("detaches and restores outer SIGINT listeners around the rollback prompt", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "src.ts"), "export const x = 999;\n", "utf-8");

    // Simulate the run-loop's force-exit handler from run.ts by
    // registering a marker listener. The prompt must detach it while
    // open and restore it exactly after the prompt closes.
    const priorListeners = detachExistingSigintListeners();
    const outerHandler = vi.fn();
    process.on("SIGINT", outerHandler);

    try {
      const { finalizeRun } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const run = buildFailedRun();
      const finalizePromise = finalizeRun({
        run,
        henchDir,
        projectDir,
        rollbackOnFailure: true,
      });

      // Give the async prompt setup a tick to open.
      await waitForFakePrompt(fakes);

      expect(fakes).toHaveLength(1);
      // Outer handler is suspended while the prompt is visible.
      expect(process.listeners("SIGINT")).not.toContain(outerHandler);

      // Simulate the user declining the rollback.
      fakes[0].answer("n");
      await finalizePromise;

      // Outer handler is re-attached after the prompt closes and the
      // user's answer was delivered without any SIGINT activity.
      expect(process.listeners("SIGINT")).toContain(outerHandler);
      expect(outerHandler).not.toHaveBeenCalled();
      expect(fakes[0].closed).toBe(true);

      // Decline path leaves the working tree dirty.
      const content = await readFile(join(projectDir, "src.ts"), "utf-8");
      expect(content).toBe("export const x = 999;\n");
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("cancels the rollback prompt cleanly on Ctrl-C without invoking the outer handler", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "src.ts"), "export const x = 999;\n", "utf-8");

    const priorListeners = detachExistingSigintListeners();
    const outerHandler = vi.fn();
    process.on("SIGINT", outerHandler);

    try {
      const { finalizeRun } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const run = buildFailedRun();
      const finalizePromise = finalizeRun({
        run,
        henchDir,
        projectDir,
        rollbackOnFailure: true,
      });

      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);

      // Emit a process-level SIGINT while the prompt is visible. The
      // outer handler has been detached, so only the prompt's internal
      // onInterrupt fires — cancelling the readline and resolving the
      // prompt as a decline.
      process.emit("SIGINT");
      await finalizePromise;

      expect(outerHandler).not.toHaveBeenCalled();
      expect(fakes[0].closed).toBe(true);

      // Decline path leaves the working tree unchanged.
      const content = await readFile(join(projectDir, "src.ts"), "utf-8");
      expect(content).toBe("export const x = 999;\n");
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("does not call process.exit(1) when a second SIGINT arrives during the rollback prompt", async () => {
    // Reproduces the original bug scenario as closely as possible: the
    // run-loop in `run.ts` registers a handler that calls
    // `process.exit(1)` on a second Ctrl-C. The first Ctrl-C is assumed
    // to have already ended the run (the run arrives here in a failed
    // state and enters the rollback path). The outer handler stays
    // registered unless something detaches it — without the suspension
    // shim, the second Ctrl-C delivered while the rollback prompt is
    // open would immediately kill the process before the user can
    // answer.
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "src.ts"), "export const x = 999;\n", "utf-8");

    // Spy on process.exit so the assertion can state the behavior in
    // the exact language of the acceptance criterion.
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => undefined) as never);

    const priorListeners = detachExistingSigintListeners();
    // Install a handler with the force-exit shape used by run.ts's
    // second-Ctrl-C branch. The test asserts this never fires while the
    // prompt is open — the suspension shim must detach it first.
    const outerForceExit = vi.fn(() => {
      process.exit(1);
    });
    process.on("SIGINT", outerForceExit);

    try {
      const { finalizeRun } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const run = buildFailedRun();
      const finalizePromise = finalizeRun({
        run,
        henchDir,
        projectDir,
        rollbackOnFailure: true,
      });

      // Let the prompt open.
      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);
      // Precondition: the outer force-exit handler is detached while
      // the prompt is open.
      expect(process.listeners("SIGINT")).not.toContain(outerForceExit);

      // Deliver the "second" Ctrl-C. The first one is the signal that
      // ended the run and opened the prompt in the first place.
      process.emit("SIGINT");
      await finalizePromise;

      // Core criterion: process.exit(1) must not have been invoked.
      expect(exitSpy).not.toHaveBeenCalled();
      expect(outerForceExit).not.toHaveBeenCalled();
      // The readline interface completed cleanly — it was closed by the
      // shim's onInterrupt handler, and the finalizeRun promise resolved
      // without rejection (implicit in the awaited promise above).
      expect(fakes[0].closed).toBe(true);
      // And the outer handler is reinstalled exactly once so subsequent
      // Ctrl-C handling is uninterrupted.
      const restored = (process.listeners("SIGINT") as Array<(...a: unknown[]) => void>).filter(
        (l) => l === outerForceExit,
      );
      expect(restored).toHaveLength(1);
    } finally {
      restoreSigintListeners(priorListeners);
      exitSpy.mockRestore();
    }
  });

  it("also cancels cleanly when SIGINT is delivered via readline's own event", async () => {
    // Some terminals deliver Ctrl-C through the readline surface instead
    // of (or in addition to) the process-level signal. The prompt
    // listens on both so either delivery channel unblocks the question.
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "src.ts"), "export const x = 999;\n", "utf-8");

    const priorListeners = detachExistingSigintListeners();
    const outerHandler = vi.fn();
    process.on("SIGINT", outerHandler);

    try {
      const { finalizeRun } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const run = buildFailedRun();
      const finalizePromise = finalizeRun({
        run,
        henchDir,
        projectDir,
        rollbackOnFailure: true,
      });

      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);

      fakes[0].emitRlSigint();
      await finalizePromise;

      expect(outerHandler).not.toHaveBeenCalled();
      expect(fakes[0].closed).toBe(true);
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("still performs rollback when the user accepts the prompt", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await writeFile(join(projectDir, "src.ts"), "export const x = 999;\n", "utf-8");

    const priorListeners = detachExistingSigintListeners();
    const outerHandler = vi.fn();
    process.on("SIGINT", outerHandler);

    try {
      const { finalizeRun } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const run = buildFailedRun();
      const finalizePromise = finalizeRun({
        run,
        henchDir,
        projectDir,
        rollbackOnFailure: true,
      });

      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);

      // Accept the rollback.
      fakes[0].answer("y");
      await finalizePromise;

      expect(process.listeners("SIGINT")).toContain(outerHandler);
      expect(outerHandler).not.toHaveBeenCalled();

      // Accept path reverts the modified file back to the committed version.
      const content = await readFile(join(projectDir, "src.ts"), "utf-8");
      expect(content).toBe("export const x = 1;\n");
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("applies the same SIGINT suspension to the commit-approval prompt", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    // Stage a change and write a pending commit message so the commit
    // prompt path activates.
    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: bump x", "utf-8");

    const priorListeners = detachExistingSigintListeners();
    const outerHandler = vi.fn();
    process.on("SIGINT", outerHandler);

    try {
      const { performCommitPromptIfNeeded } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const run = buildCompletedRun();
      const promptPromise = performCommitPromptIfNeeded(
        run,
        projectDir,
        /* autoCommit */ false,
        /* yes */ false,
        /* autonomous */ false,
      );

      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);

      // Outer handler is suspended — a SIGINT during the commit prompt
      // must not reach it and must not call process.exit(1).
      expect(process.listeners("SIGINT")).not.toContain(outerHandler);
      process.emit("SIGINT");

      await promptPromise;

      expect(outerHandler).not.toHaveBeenCalled();
      expect(process.listeners("SIGINT")).toContain(outerHandler);
      expect(fakes[0].closed).toBe(true);
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });
});
