/**
 * A failure after a v2 completion applied its change keeps the completion.
 *
 * Completing the last task of a change applies the change's amendments to the
 * product layer in the same write. Every failure after that point used to
 * withdraw the completion, resetting the task and, through the v1 ancestor
 * reset, the change, while the change kept `appliedAt` and product/ kept the
 * amendment. Decision S1-Q2: an applied change is never reopened by the run
 * that applied it. The completion stays, the run fails, and the error names
 * every uncommitted path and the commands that commit them under the task's
 * N-DX-Item trailer.
 *
 * Every test works on a temp copy of rex's v2 fixture inside a git repository.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { loadPrdModel } from "@n-dx/rex";
import type { PRDStore } from "@n-dx/rex";
import { initConfig } from "../../src/store/config.js";
import { TaskClaims } from "../../src/process/task-claims.js";
import type { RunRecord } from "../../src/schema/index.js";
import { cleanupProjectDir, initGitFixtureRepo } from "../helpers/index.js";

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");

/** CH-1, "Add Apple Pay"; amends capability "Pay by card". */
const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";
/** Its only task, "Wire the button". */
const WIRE_ID = "c0000000-0000-4000-8000-000000000002";
const CAPABILITY_ID = "a0000000-0000-4000-8000-000000000002";
const AMENDED_CRITERION = "Apple Pay is offered on Safari";

let projectDir: string;
let rexDir: string;
let henchDir: string;
let claims: TaskClaims;
let baseline: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: projectDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * The store, from the module graph hench is about to load. Each test resets
 * modules, and `isChangeLayerStore` is an `instanceof`: a store built by the
 * statically imported rex reads as v1 to a freshly imported lifecycle.
 */
async function store(): Promise<PRDStore> {
  return (await import("@n-dx/rex")).resolveStore(rexDir);
}

/** The task, its change and the capability, read fresh from disk. */
async function onDisk() {
  const tree = (await loadPrdModel(rexDir)).tree;
  const change = tree.changes.find((n) => n.id === CHANGE_ID)!;
  const task = (change.children ?? []).find((n) => n.id === WIRE_ID)!;
  const capability = tree.product.flatMap((a) => a.children ?? []).find((n) => n.id === CAPABILITY_ID) as
    | { criteria?: Array<{ text: string }> }
    | undefined;
  return {
    taskStatus: task.status,
    changeStatus: change.status,
    appliedAt: change.appliedAt,
    criteria: (capability?.criteria ?? []).map((c) => c.text),
  };
}

function buildRun(): RunRecord {
  return {
    id: randomUUID(),
    taskId: WIRE_ID,
    taskTitle: "Wire the button",
    startedAt: new Date().toISOString(),
    status: "completed",
    summary: "Wired the button",
    turns: 2,
    tokenUsage: { input: 1, output: 1 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
    startHead: baseline,
    worktreeRoot: projectDir,
  };
}

/** The agent asked to complete and rex held it on the run's claim. */
async function agentHoldsCompletion(): Promise<void> {
  await claims.recordPendingCompletion(WIRE_ID, { resolutionType: "code-change", requestedAt: new Date().toISOString() });
}

/** The agent's code change, staged, with the commit message it proposed. */
async function agentStagesWork(): Promise<void> {
  await writeFile(join(projectDir, "src", "pay.ts"), "export const pay = 2;\n");
  git("add", "src/pay.ts");
  await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: wire the Apple Pay button\n");
}

async function installFailingPreCommitHook(): Promise<void> {
  const hook = join(projectDir, ".git", "hooks", "pre-commit");
  await writeFile(hook, "#!/bin/sh\necho 'lint failed' >&2\nexit 1\n");
  await chmod(hook, 0o755);
  // The test setup points the global hooksPath at an empty directory; this repo opts back in.
  git("config", "core.hooksPath", join(projectDir, ".git", "hooks"));
}

/** Fail one git subcommand inside hench, the way git-mutation-failures.test.ts does. */
function failGitMutation(operation: "add" | "commit", message: string): void {
  vi.doMock("../../src/process/exec.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/process/exec.js")>();
    return {
      ...actual,
      exec: vi.fn(async (command: string, args: string[], options: Parameters<typeof actual.exec>[2]) => {
        if (command === "git" && args[0] === operation) {
          return { stdout: "", stderr: message, exitCode: 1, error: new Error(`git ${args.join(" ")}\n${message}`), launched: true };
        }
        return actual.exec(command, args, options);
      }),
    };
  });
}

/** finalizeRun with the full test gate's verdict fixed to a failure. */
function failTestGate(): void {
  vi.doMock("../../src/tools/test-runner.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/tools/test-runner.js")>()),
    runTestGate: async () => ({
      ran: true,
      passed: false,
      packages: [{ name: "workspace", passed: false, failureOutput: "FAIL  tests/pay.test.ts > pays" }],
      command: "npm run test",
      totalDurationMs: 5,
    }),
  }));
}

async function lifecycle() {
  return import("../../src/agent/lifecycle/shared.js");
}

function expectKeptReport(run: RunRecord, cause: string): void {
  expect(run.status).toBe("failed");
  expect(run.error).toContain(cause);
  expect(run.error).toContain(`Change ${CHANGE_ID} was applied`);
  expect(run.error).toMatch(/\.rex\/product\/checkout\/(state\.yaml|pay-by-card\.md)/);
  expect(run.error).toContain(".rex/changes/add-apple-pay/state.yaml");
  expect(run.error).toContain(`-m "N-DX-Item: ${WIRE_ID}"`);
}

async function expectCompletionKept(): Promise<void> {
  const state = await onDisk();
  expect(state.taskStatus).toBe("completed");
  expect(state.changeStatus).toBe("completed");
  expect(state.appliedAt).toBeTruthy();
  expect(state.criteria).toContain(AMENDED_CRITERION);
}

beforeEach(async () => {
  projectDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hench-v2-kept-")));
  rexDir = join(projectDir, ".rex");
  henchDir = join(projectDir, ".hench");
  await initGitFixtureRepo(projectDir);
  await initConfig(henchDir);
  await mkdir(join(henchDir, "runs"), { recursive: true });
  await cp(FIXTURE, rexDir, { recursive: true });
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
  await writeFile(
    join(rexDir, "changes", "add-apple-pay", "state.yaml"),
    ['schema: "rex/v2"', "items:", `  "${CHANGE_ID}":`, '    status: "pending"', `  "${WIRE_ID}":`, '    status: "in_progress"', ""].join("\n"),
  );
  await writeFile(join(projectDir, ".gitignore"), ".hench/\n.rex/execution-log*.jsonl\n.rex/.cache/\n");
  await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: "shop", scripts: { test: "vitest run" } }));
  await mkdir(join(projectDir, "src"));
  await writeFile(join(projectDir, "src", "pay.ts"), "export const pay = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "baseline");
  baseline = git("rev-parse", "HEAD").trim();

  claims = TaskClaims.forProject(projectDir);
  expect(await claims.claim(WIRE_ID)).toBeNull();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await claims.releaseAll();
  vi.doUnmock("../../src/process/exec.js");
  vi.doUnmock("../../src/tools/test-runner.js");
  vi.restoreAllMocks();
  vi.resetModules();
  await cleanupProjectDir(projectDir);
});

describe("a failure after a v2 completion applied its change", () => {
  it("keeps the completion when a pre-commit hook rejects the agent's commit", async () => {
    await agentHoldsCompletion();
    await agentStagesWork();
    await installFailingPreCommitHook();
    const { finalizeRun } = await lifecycle();

    const run = buildRun();
    await finalizeRun({
      run, henchDir, projectDir, store: await store(), claims,
      autoCommit: false, yes: true, autonomous: true, rollbackOnFailure: false, skipFullTestGate: true,
      startingHead: baseline,
    });

    await expectCompletionKept();
    expectKeptReport(run, "Commit failed");
    expect(run.error).toContain("src/pay.ts");
    expect(git("log", "-1", "--format=%s").trim()).toBe("baseline");
  });

  it("keeps the completion when staging review repairs fails", async () => {
    await agentStagesWork();
    await writeFile(join(projectDir, "src", "repair.ts"), "export const repaired = true;\n");
    const s = await store();
    const run = buildRun();
    run.review = {
      model: "reviewer", resumedSession: false, findingCount: 1, unresolvedCount: 0,
      unrepairedMustFixCount: 0, failedActionCount: 0, fixesApplied: true, repairedFiles: ["src/repair.ts"],
    };

    failGitMutation("add", "fatal: could not lock index");
    const { updateCompletedTaskStatus, performCommitPromptIfNeeded } = await lifecycle();
    expect(await updateCompletedTaskStatus(s, WIRE_ID, run)).toBe(true);
    await performCommitPromptIfNeeded(run, projectDir, false, true, true, s, WIRE_ID);

    await expectCompletionKept();
    expectKeptReport(run, "Could not stage review repairs");
  });

  it("keeps the completion when the review-repair commit fails", async () => {
    await agentHoldsCompletion();
    // autoCommit: the agent committed its own work; only the repair is loose.
    await writeFile(join(projectDir, "src", "pay.ts"), "export const pay = 2;\n");
    git("commit", "-q", "-am", "feat: wire the Apple Pay button");
    await writeFile(join(projectDir, "src", "pay.ts"), "export const pay = 3; // reviewer repair\n");
    const run = buildRun();
    run.review = {
      model: "reviewer", resumedSession: false, findingCount: 1, unresolvedCount: 0,
      unrepairedMustFixCount: 0, failedActionCount: 0, fixesApplied: true, repairedFiles: ["src/pay.ts"],
    };

    failGitMutation("commit", "pre-commit hook rejected the repair");
    const { finalizeRun } = await lifecycle();
    await finalizeRun({
      run, henchDir, projectDir, store: await store(), claims,
      autoCommit: true, autonomous: true, rollbackOnFailure: false, skipFullTestGate: true,
      startingHead: baseline,
    });

    await expectCompletionKept();
    expectKeptReport(run, "Could not commit review repairs");
    expect(run.error).toContain("src/pay.ts");
  });

  it("keeps a bypassed completion when the test gate then fails", async () => {
    // No hold: the agent's completion is written straight through and applies the change.
    await claims.releaseAll();
    const { toolRexUpdateStatus } = await import("../../src/tools/rex.js");
    await toolRexUpdateStatus(await store(), WIRE_ID, { status: "completed", resolutionType: "code-change" });
    await expectCompletionKept();

    failTestGate();
    const { finalizeRun } = await lifecycle();
    const run = buildRun();
    run.structuredSummary = {
      filesChanged: ["src/pay.ts"],
      counts: { filesChanged: 1, toolCalls: 0, testsRun: 0 },
    } as unknown as RunRecord["structuredSummary"];
    await finalizeRun({
      run, henchDir, projectDir, store: await store(),
      autoCommit: true, autonomous: true, rollbackOnFailure: false, startingHead: baseline,
    });

    expect(run.completionHold?.outcome).toBe("bypassed");
    await expectCompletionKept();
    expectKeptReport(run, "Test gate");
  });
});

describe("a failure after a v2 completion that applied nothing", () => {
  it("withdraws the completion as before", async () => {
    // rex.applyOn: review — the change completes with its task but waits for a steward.
    await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({ rex: { applyOn: "review" } }));
    git("add", ".n-dx.json");
    git("commit", "-q", "-m", "apply on review");
    await agentHoldsCompletion();
    await agentStagesWork();
    await installFailingPreCommitHook();
    const { finalizeRun } = await lifecycle();

    const run = buildRun();
    await finalizeRun({
      run, henchDir, projectDir, store: await store(), claims,
      autoCommit: false, yes: true, autonomous: true, rollbackOnFailure: false, skipFullTestGate: true,
      startingHead: baseline,
    });

    const state = await onDisk();
    expect(run.status).toBe("failed");
    expect(run.error).toContain("Commit failed");
    expect(run.error).not.toContain("was applied");
    expect(state.appliedAt).toBeUndefined();
    expect(state.taskStatus).toBe("pending");
    expect(state.changeStatus).toBe("pending");
    expect(state.criteria).not.toContain(AMENDED_CRITERION);
  });
});
