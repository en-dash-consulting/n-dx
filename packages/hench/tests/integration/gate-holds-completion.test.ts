/**
 * No completion lands before hench's test gate passes (0.7.1 PR C2).
 *
 * Runs 6eacca42, 8dc53406 and a6e7efa6 ended `failed` with their task
 * `completed` on disk and in git: the agent marked its own task completed
 * through rex MCP, `git add -A && git commit` carried the flip into the work
 * commit, and the full-suite gate failed afterwards with nothing to withdraw
 * it. These tests replay that sequence against a real repository, a real
 * folder tree, the real claims store and rex's real MCP handler; only the
 * gate's verdict is stubbed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  resolveStore,
  serializeFolderTree,
  PRD_TREE_DIRNAME,
  TREE_META_FILENAME,
  SLUG_RULE_VERSION,
} from "@n-dx/rex";
import type { PRDItem, PRDStore } from "@n-dx/rex";
import { handleUpdateTaskStatus } from "@n-dx/rex/dist/cli/mcp-tools.js";
import { initConfig } from "../../src/store/config.js";
import { TaskClaims } from "../../src/process/task-claims.js";
import { rexToolHandlers } from "../../src/tools/rex.js";
import type { RunRecord } from "../../src/schema/index.js";
import { initGitFixtureRepo, cleanupProjectDir } from "../helpers/index.js";

const TASK = "task-c2";

const ITEMS: PRDItem[] = [
  {
    id: "epic-c2", title: "Epic", level: "epic", status: "in_progress",
    children: [
      { id: "feature-c2", title: "Feature", level: "feature", status: "in_progress",
        children: [{ id: TASK, title: "Gate holds completion", level: "task", status: "pending" }] },
    ],
  },
];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

let projectDir: string;
let henchDir: string;
let store: PRDStore;
let claims: TaskClaims;
let baseline: string;

beforeEach(async () => {
  projectDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hench-gate-hold-")));
  henchDir = join(projectDir, ".hench");
  await initConfig(henchDir);
  await mkdir(join(henchDir, "runs"), { recursive: true });
  await initGitFixtureRepo(projectDir);

  const rexDir = join(projectDir, ".rex");
  await serializeFolderTree(ITEMS, join(rexDir, PRD_TREE_DIRNAME));
  await writeFile(
    join(rexDir, TREE_META_FILENAME),
    JSON.stringify({ title: "C2", schema: "rex/v1", slugRule: SLUG_RULE_VERSION }),
    "utf-8",
  );
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "c2", adapter: "file" }));
  await writeFile(join(projectDir, ".gitignore"), ".hench/\n.run-logs/\n.rex/execution-log*.jsonl\n.rex/.cache/\n");
  // The gate's verdict is stubbed, but finalizeRun still resolves a command first.
  await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: "c2", scripts: { test: "vitest run" } }));
  await mkdir(join(projectDir, "src"));
  await writeFile(join(projectDir, "src", "gate.ts"), "export const gate = 1;\n");
  git(projectDir, "add", "-A");
  git(projectDir, "commit", "-q", "-m", "baseline");
  baseline = git(projectDir, "rev-parse", "HEAD").trim();

  store = await resolveStore(rexDir);
  // What hench does before it spawns the agent: claim the task (this test's
  // process stands in for the run) and move it to in_progress.
  claims = TaskClaims.forProject(projectDir);
  expect(await claims.claim(TASK)).toBeNull();
  await store.updateItem(TASK, { status: "in_progress" });

  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await claims.releaseAll();
  vi.doUnmock("../../src/tools/test-runner.js");
  vi.restoreAllMocks();
  vi.resetModules();
  await cleanupProjectDir(projectDir);
});

function buildRun(): RunRecord {
  return {
    id: randomUUID(),
    taskId: TASK,
    taskTitle: "Gate holds completion",
    startedAt: new Date().toISOString(),
    status: "completed",
    turns: 4,
    tokenUsage: { input: 100, output: 50 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
    startHead: baseline,
    branch: git(projectDir, "rev-parse", "--abbrev-ref", "HEAD").trim(),
    worktreeRoot: projectDir,
  };
}

/** finalizeRun with the gate's verdict fixed; everything else real. */
async function finalizeWithGate(passed: boolean) {
  vi.resetModules();
  vi.doMock("../../src/tools/test-runner.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/tools/test-runner.js")>()),
    runTestGate: async () => passed
      ? { ran: true, passed: true, packages: [{ name: "workspace", passed: true }], command: "npm run test", totalDurationMs: 5 }
      : {
          ran: true,
          passed: false,
          packages: [{ name: "workspace", passed: false, failureOutput: "FAIL  tests/e2e/cli-config.test.js > config > sets" }],
          command: "npm run test",
          totalDurationMs: 5,
        },
  }));
  return (await import("../../src/agent/lifecycle/shared.js")).finalizeRun;
}

/** The agent's side: mark the task completed through rex MCP, as the Claude and Codex CLIs do. */
async function agentCompletesThroughMcp(detail: string): Promise<Record<string, unknown>> {
  const out = await handleUpdateTaskStatus(
    store,
    projectDir,
    { id: TASK, status: "completed", resolutionType: "code-change", resolutionDetail: detail },
    { store: claims.store, worktreeRoot: claims.holder.worktreeRoot },
  );
  return JSON.parse(out.content[0].text);
}

/** The agent's side: change code and commit everything, PRD included. */
async function agentCommitsEverything(): Promise<void> {
  await writeFile(join(projectDir, "src", "gate.ts"), "export const gate = 2;\n");
  git(projectDir, "add", "-A");
  git(projectDir, "commit", "-q", "-m", "feat: the work");
}

async function statusOnDisk(): Promise<string | undefined> {
  const fresh = await resolveStore(join(projectDir, ".rex"));
  return (await fresh.getItem(TASK))?.status;
}

/** Every version of the task's index.md committed since the baseline. */
function committedTaskFiles(): string[] {
  const shas = git(projectDir, "log", "--format=%H", `${baseline}..HEAD`).trim().split("\n").filter(Boolean);
  const taskPath = git(projectDir, "ls-files", ".rex/prd_tree").split("\n").find((p) => p.includes("gate-holds-completion"));
  expect(taskPath).toBeDefined();
  return shas.map((sha) => {
    try {
      return git(projectDir, "show", `${sha}:${taskPath}`);
    } catch {
      return "";
    }
  });
}

async function executionLog(): Promise<string> {
  try {
    return await readFile(join(projectDir, ".rex", "execution-log.jsonl"), "utf-8");
  } catch {
    return "";
  }
}

describe("6eacca42: the agent completes and commits, then the gate fails", () => {
  it("leaves the task not completed on disk and in every commit, keeping the resolution for the retry", async () => {
    const reply = await agentCompletesThroughMcp("Fixed config parsing");
    expect(reply.completionHeld).toBe(true);
    await agentCommitsEverything();

    const finalizeRun = await finalizeWithGate(false);
    const run = buildRun();
    await finalizeRun({
      run, henchDir, projectDir, store, claims,
      autoCommit: true, autonomous: true, rollbackOnFailure: false, startingHead: baseline,
    });

    expect(run.status).toBe("failed");
    expect(await statusOnDisk()).not.toBe("completed");
    for (const version of committedTaskFiles()) {
      expect(version).not.toMatch(/status:\s*"?completed/);
    }
    expect(run.completionHold).toMatchObject({
      outcome: "not-applied",
      resolutionType: "code-change",
      resolutionDetail: "Fixed config parsing",
    });
    expect(await executionLog()).toMatch(/completion_not_applied.*Fixed config parsing/);
  });
});

describe("the gate passes", () => {
  it("completes the task in hench's record commit, with the agent's resolution", async () => {
    await agentCompletesThroughMcp("Fixed config parsing");
    await agentCommitsEverything();
    const workCommit = git(projectDir, "rev-parse", "HEAD").trim();

    const finalizeRun = await finalizeWithGate(true);
    const run = buildRun();
    await finalizeRun({
      run, henchDir, projectDir, store, claims,
      autoCommit: true, autonomous: true, rollbackOnFailure: false, startingHead: baseline,
    });

    expect(run.status).toBe("completed");
    const item = await (await resolveStore(join(projectDir, ".rex"))).getItem(TASK);
    expect(item?.status).toBe("completed");
    expect(item?.resolutionType).toBe("code-change");
    expect(item?.resolutionDetail).toBe("Fixed config parsing");
    expect(run.completionHold?.outcome).toBe("applied");

    // The work commit never said completed; the record commit after it does.
    expect(git(projectDir, "show", "--stat", workCommit)).not.toContain("completed)");
    const subjects = git(projectDir, "log", "--format=%s", `${workCommit}..HEAD`);
    expect(subjects).toMatch(/chore\(prd\).*task-c2 completed/);
    expect(git(projectDir, "status", "--porcelain", "--", ".rex/prd_tree").trim()).toBe("");
  });

  it("applies the latest completion when a resumed session asks again", async () => {
    await agentCompletesThroughMcp("first session: waiting on the suite");
    await agentCompletesThroughMcp("resumed session: suite passed, committed");
    await agentCommitsEverything();

    const finalizeRun = await finalizeWithGate(true);
    const run = buildRun();
    await finalizeRun({
      run, henchDir, projectDir, store, claims,
      autoCommit: true, autonomous: true, rollbackOnFailure: false, startingHead: baseline,
    });

    const item = await (await resolveStore(join(projectDir, ".rex"))).getItem(TASK);
    expect(item?.resolutionDetail).toBe("resumed session: suite passed, committed");
  });
});

describe("API-loop runs", () => {
  it("hold the agent's rex_update_status completion the same way", async () => {
    await writeFile(join(projectDir, "src", "gate.ts"), "export const gate = 3;\n");
    const reply = await rexToolHandlers.updateStatus(
      { projectDir, store, taskId: TASK, startingHead: baseline } as Parameters<typeof rexToolHandlers.updateStatus>[0],
      { status: "completed", resolutionType: "code-change" },
    );
    expect(reply).toMatch(/^\[COMPLETION_HELD\]/);
    expect(await statusOnDisk()).toBe("in_progress");
    expect(await claims.pendingCompletion(TASK)).toMatchObject({ resolutionType: "code-change" });
  });
});

describe("review repairs when the gate fails", () => {
  async function withRepair(): Promise<RunRecord> {
    await agentCommitsEverything();
    await writeFile(join(projectDir, "src", "repaired.ts"), "export const repaired = true;\n");
    const run = buildRun();
    run.review = { repairedFiles: ["src/repaired.ts"] } as RunRecord["review"];
    return run;
  }

  it("autoCommit: commits them as their own commit", async () => {
    const run = await withRepair();
    const finalizeRun = await finalizeWithGate(false);
    await finalizeRun({
      run, henchDir, projectDir, store, claims,
      autoCommit: true, autonomous: true, rollbackOnFailure: false, startingHead: baseline,
    });

    expect(run.status).toBe("failed");
    expect(git(projectDir, "log", "-1", "--format=%s")).toMatch(/^fix\(review\)/);
    expect(git(projectDir, "status", "--porcelain", "--", "src").trim()).toBe("");
    expect(run.review?.repairCommit).toBeDefined();
  });

  it("without autoCommit: names them as left uncommitted", async () => {
    const run = await withRepair();
    const finalizeRun = await finalizeWithGate(false);
    await finalizeRun({
      run, henchDir, projectDir, store, claims,
      autoCommit: false, autonomous: true, rollbackOnFailure: false, startingHead: baseline,
    });

    const printed = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toMatch(/Review repairs left uncommitted.*src\/repaired\.ts/);
    expect(run.diagnostics?.notes ?? []).toContain("review_repairs_uncommitted: src/repaired.ts");
    expect(run.uncommittedPaths).toContain("src/repaired.ts");
  });
});

describe("a completion that bypassed the hold", () => {
  it("is withdrawn from disk when the gate fails", async () => {
    // No run claim holds the task: the write goes straight to the PRD, as it
    // does with a rex server built before the hold existed.
    await claims.releaseAll();
    await agentCompletesThroughMcp("written straight through");
    expect(await statusOnDisk()).toBe("completed");

    const finalizeRun = await finalizeWithGate(false);
    const run = buildRun();
    await finalizeRun({
      run, henchDir, projectDir, store,
      autoCommit: true, autonomous: true, rollbackOnFailure: false, startingHead: baseline,
    });

    expect(run.status).toBe("failed");
    expect(await statusOnDisk()).toBe("pending");
    expect(run.completionHold?.outcome).toBe("bypassed");
  });
});
