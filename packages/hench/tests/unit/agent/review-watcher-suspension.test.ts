/**
 * The commit-message watcher must not auto-commit while the review pass runs.
 *
 * On a `--review` run the executor stages its work and writes
 * `.hench-commit-msg.txt` (the resolveEffectiveAutoCommit override), which arms
 * the watcher's one-shot auto-commit timer. The review pass that follows is a
 * whole second agent session and routinely outlives the default 5-minute
 * timeout, so an armed timer fires mid-review: it commits the executor's staged
 * work while the reviewer is still repairing, HEAD moves, and the repairs can
 * no longer join the commit they repair — the exact guarantee the --review
 * commit-ownership work exists to provide. Worse, performCommitPromptIfNeeded
 * then early-returns on didAutoCommit(), so repairs the reviewer staged are
 * never committed by hench at all.
 *
 * The fix cancels the watcher before the review pass spawns; the imminent
 * performCommitPromptIfNeeded owns the commit from there. The crash-net is
 * deliberately absent during the review window — a reviewer crash leaves
 * staged work plus the message file, which the pre-run commit gate already
 * recovers.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { processSuccessfulResult } from "../../../src/agent/lifecycle/cli-loop.js";
import type { ReviewPassContext } from "../../../src/agent/lifecycle/cli-loop.js";
import { startCommitMsgWatcher } from "../../../src/agent/lifecycle/commit-msg-watcher.js";
import { performCommitPromptIfNeeded } from "../../../src/agent/lifecycle/shared.js";
import type { VendorAdapter, SpawnConfig } from "../../../src/agent/lifecycle/vendor-adapter.js";
import { DEFAULT_EXECUTION_POLICY } from "../../../src/prd/llm-gateway.js";
import type { PRDStore } from "../../../src/prd/rex-gateway.js";

const exec = promisify(execFile);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long the stub reviewer runs. Must comfortably exceed WATCHER_TIMEOUT_MS. */
const REVIEW_DURATION_MS = 1500;
/** Armed the moment `.hench-commit-msg.txt` appears — mid-"review" if not cancelled. */
const WATCHER_TIMEOUT_MS = 500;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

async function commitCount(cwd: string): Promise<number> {
  return Number(await git(cwd, "rev-list", "--count", "HEAD"));
}

/** Adapter whose "reviewer" is a node script that just sleeps. */
function stubAdapter(sleepScript: string, calls: string[]): VendorAdapter {
  return {
    vendor: "claude",
    parseMode: "stream-json",
    buildSpawnConfig: (): SpawnConfig => {
      calls.push("buildSpawnConfig");
      return { binary: process.execPath, args: [sleepScript], env: {}, stdinContent: null };
    },
    parseEvent: () => null,
    classifyError: () => "unknown",
  } as unknown as VendorAdapter;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runRecord(): any {
  return {
    id: "run-review-watcher",
    taskId: "task-1",
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: "in_progress",
    turns: 0,
    tokenUsage: { input: 0, output: 0 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "claude-sonnet-4-6",
  };
}

describe("commit watcher is suspended for the review pass", () => {
  let projectDir: string;
  let henchDir: string;
  let sleepScript: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-review-watcher-"));
    henchDir = join(projectDir, ".hench");
    await mkdir(henchDir, { recursive: true });

    await git(projectDir, "init", "-q");
    await git(projectDir, "config", "user.email", "test@test.invalid");
    await git(projectDir, "config", "user.name", "Test");
    await writeFile(join(projectDir, "a.txt"), "base\n", "utf-8");
    await git(projectDir, "add", "-A");
    await git(projectDir, "commit", "-q", "-m", "base");

    // The executor's end-of-turn state: staged change + proposed message.
    await writeFile(join(projectDir, "a.txt"), "changed by executor\n", "utf-8");
    await git(projectDir, "add", "-A");
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: executor work\n", "utf-8");

    sleepScript = join(projectDir, "sleep.cjs");
    await writeFile(sleepScript, `setTimeout(() => {}, ${REVIEW_DURATION_MS});\n`, "utf-8");
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("cancels the watcher before the reviewer spawns, so a review longer than the timeout cannot auto-commit", async () => {
    const calls: string[] = [];
    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: WATCHER_TIMEOUT_MS });
    const watcherSpy = {
      cancel: () => {
        calls.push("cancel");
        watcher.cancel();
      },
      didAutoCommit: () => watcher.didAutoCommit(),
    };

    const reviewPass: ReviewPassContext = {
      adapter: stubAdapter(sleepScript, calls),
      vendor: "claude",
      cliBinary: process.execPath,
      policy: DEFAULT_EXECUTION_POLICY,
      henchDir,
      reviewModel: "",
      permissionMode: "acceptEdits",
      autonomous: true,
      taskTitle: "Test task",
    };

    const run = runRecord();
    const action = await processSuccessfulResult({
      run,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result: {
        turns: 3,
        toolCalls: [{ name: "Bash", input: "echo", timestamp: new Date().toISOString() }],
        tokenUsage: { input: 10, output: 10 },
        turnTokenUsage: [],
        summary: "did the work",
      } as any,
      accumulated: {
        turns: 3,
        toolCalls: [],
        turnTokenUsage: [],
        tokenUsage: { input: 10, output: 10 },
      },
      attempt: 0,
      store: {} as PRDStore,
      taskId: "task-1",
      projectDir,
      startingHead: undefined,
      reviewPass,
      commitWatcher: watcherSpy,
    });

    // Give a not-cancelled timer every chance to fire before asserting.
    await sleep(WATCHER_TIMEOUT_MS + 300);
    watcher.cancel();

    expect(action).toBe("break");
    expect(run.status).toBe("completed");
    // The wiring under test: cancel must precede the reviewer spawn.
    expect(calls[0]).toBe("cancel");
    expect(calls).toContain("buildSpawnConfig");
    // And the observable guarantee: no mid-review commit ever happened.
    expect(watcher.didAutoCommit()).toBe(false);
    expect(await commitCount(projectDir)).toBe(1);
    expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(true);
  }, 20_000);

  it("still runs the review pass when no watcher is provided (API/loop callers)", async () => {
    const calls: string[] = [];
    await writeFile(sleepScript, "setTimeout(() => {}, 10);\n", "utf-8");

    const run = runRecord();
    const action = await processSuccessfulResult({
      run,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result: {
        turns: 3,
        toolCalls: [{ name: "Bash", input: "echo", timestamp: new Date().toISOString() }],
        tokenUsage: { input: 10, output: 10 },
        turnTokenUsage: [],
        summary: "did the work",
      } as any,
      accumulated: { turns: 3, toolCalls: [], turnTokenUsage: [], tokenUsage: { input: 10, output: 10 } },
      attempt: 0,
      store: {} as PRDStore,
      taskId: "task-1",
      projectDir,
      startingHead: undefined,
      reviewPass: {
        adapter: stubAdapter(sleepScript, calls),
        vendor: "claude",
        cliBinary: process.execPath,
        policy: DEFAULT_EXECUTION_POLICY,
        henchDir,
        reviewModel: "",
        permissionMode: "acceptEdits",
        autonomous: true,
        taskTitle: "Test task",
      },
    });

    expect(action).toBe("break");
    expect(calls).toContain("buildSpawnConfig");
  }, 20_000);
});

describe("performCommitPromptIfNeeded after a pre-review auto-commit", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-autocommit-warn-"));
    await git(projectDir, "init", "-q");
    await git(projectDir, "config", "user.email", "test@test.invalid");
    await git(projectDir, "config", "user.name", "Test");
    await writeFile(join(projectDir, "a.txt"), "base\n", "utf-8");
    await git(projectDir, "add", "-A");
    await git(projectDir, "commit", "-q", "-m", "base");
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("warns instead of claiming success when staged changes remain after the auto-commit fired", async () => {
    // Repairs staged after the timer already fired and consumed the message file.
    await writeFile(join(projectDir, "a.txt"), "review repair\n", "utf-8");
    await git(projectDir, "add", "-A");

    const lines: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    const log = console.log.bind(console);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    try {
      await performCommitPromptIfNeeded(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "r1", taskId: "t1", status: "completed", tokenUsage: { input: 0, output: 0 }, toolCalls: [], turns: 1 } as any,
        projectDir,
        false,
        true,
        true,
        undefined,
        "t1",
        { cancel: () => {}, didAutoCommit: () => true },
      );
    } finally {
      process.stdout.write = write;
      console.log = log;
    }

    const output = lines.join("");
    expect(output).toContain("staged");
    expect(output).not.toContain("proceeding to next task");
    // Nothing was committed on its behalf.
    expect(await git(projectDir, "rev-list", "--count", "HEAD")).toBe("1");
    expect(await git(projectDir, "diff", "--cached", "--name-only")).toBe("a.txt");
  });

  it("warns when the leftovers are unstaged — the reviewer stages nothing by default", async () => {
    // The leftover check used to count only the index (`git diff --cached`),
    // but nothing on this path stages anything: the PRD completion write runs
    // without a `git add`, and the reviewer's brief forbids committing without
    // instructing staging. So the realistic leftover is dirty, not staged, and
    // counting the index alone reports a dirty tree as clean.
    await writeFile(join(projectDir, "a.txt"), "review repair, never staged\n", "utf-8");

    const lines: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    const log = console.log.bind(console);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    try {
      await performCommitPromptIfNeeded(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "r1", taskId: "t1", status: "completed", tokenUsage: { input: 0, output: 0 }, toolCalls: [], turns: 1 } as any,
        projectDir,
        false,
        true,
        true,
        undefined,
        "t1",
        { cancel: () => {}, didAutoCommit: () => true },
      );
    } finally {
      process.stdout.write = write;
      console.log = log;
    }

    const output = lines.join("");
    expect(output).toContain("uncommitted");
    expect(output).not.toContain("proceeding to next task");
    // Still nothing committed on its behalf — the warning is the whole action.
    expect(await git(projectDir, "rev-list", "--count", "HEAD")).toBe("1");
  });

  it("keeps the quiet acknowledgment when the auto-commit left nothing staged", async () => {
    const lines: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    const log = console.log.bind(console);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    try {
      await performCommitPromptIfNeeded(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "r1", taskId: "t1", status: "completed", tokenUsage: { input: 0, output: 0 }, toolCalls: [], turns: 1 } as any,
        projectDir,
        false,
        true,
        true,
        undefined,
        "t1",
        { cancel: () => {}, didAutoCommit: () => true },
      );
    } finally {
      process.stdout.write = write;
      console.log = log;
    }

    expect(await git(projectDir, "rev-list", "--count", "HEAD")).toBe("1");
  });
});
