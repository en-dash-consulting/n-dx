/**
 * A gate-failed run tells the next attempt what failed.
 *
 * The brief's "Previous attempt failed" section is filled from the task's
 * `failureReason`, but a gate failure used to go only to the run log, so every
 * retry of a task whose new test was broken started blind. These tests run
 * finalizeRun against a real repository and folder tree with the gate's
 * verdict stubbed, then build the next brief from the same store.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
import { initConfig } from "../../src/store/config.js";
import { assembleTaskBrief, formatTaskBrief } from "../../src/agent/planning/brief.js";
import { NEW_TEST_HINT } from "../../src/agent/analysis/gate-failure-reason.js";
import type { RunRecord } from "../../src/schema/index.js";
import { initGitFixtureRepo, cleanupProjectDir } from "../helpers/index.js";

const TASK = "task-gate-reason";

const ITEMS: PRDItem[] = [
  {
    id: "epic-gr", title: "Epic", level: "epic", status: "in_progress",
    children: [
      { id: "feature-gr", title: "Feature", level: "feature", status: "in_progress",
        children: [{ id: TASK, title: "Scan every configured repo", level: "task", status: "pending" }] },
    ],
  },
];

/** What the gate kept of a vitest run whose new test reads a repo missing from its config. */
const FAILED_GATE = {
  ran: true,
  passed: false,
  packages: [{ name: "workspace", passed: false, failureOutput: "" }],
  command: "npm run test",
  totalDurationMs: 5,
  failureDigest: [
    "Failing tests:",
    "  FAIL  tests/scan.test.ts > scan > lists every configured repo",
    "",
    "Failure 1:",
    "  FAIL  tests/scan.test.ts > scan > lists every configured repo",
    "  TypeError: Cannot read properties of undefined (reading 'repos')",
  ].join("\n"),
  outputTail: " Test Files  1 failed (1)\n      Tests  1 failed | 2 passed (3)",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

let projectDir: string;
let henchDir: string;
let store: PRDStore;
let baseline: string;

beforeEach(async () => {
  projectDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hench-gate-reason-")));
  henchDir = join(projectDir, ".hench");
  await initConfig(henchDir);
  await mkdir(join(henchDir, "runs"), { recursive: true });
  await initGitFixtureRepo(projectDir);

  const rexDir = join(projectDir, ".rex");
  await serializeFolderTree(ITEMS, join(rexDir, PRD_TREE_DIRNAME));
  await writeFile(
    join(rexDir, TREE_META_FILENAME),
    JSON.stringify({ title: "GR", schema: "rex/v1", slugRule: SLUG_RULE_VERSION }),
    "utf-8",
  );
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "gr", adapter: "file" }));
  await writeFile(join(projectDir, ".gitignore"), ".hench/\n.run-logs/\n.rex/execution-log*.jsonl\n.rex/.cache/\n");
  await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: "gr", scripts: { test: "vitest run" } }));
  await mkdir(join(projectDir, "src"));
  await mkdir(join(projectDir, "tests"));
  await writeFile(join(projectDir, "src", "scan.ts"), "export const scan = () => [];\n");
  git(projectDir, "add", "-A");
  git(projectDir, "commit", "-q", "-m", "baseline");
  baseline = git(projectDir, "rev-parse", "HEAD").trim();

  store = await resolveStore(rexDir);
  await store.updateItem(TASK, { status: "in_progress" });

  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.doUnmock("../../src/tools/test-runner.js");
  vi.restoreAllMocks();
  vi.resetModules();
  await cleanupProjectDir(projectDir);
});

function buildRun(): RunRecord {
  return {
    id: randomUUID(),
    taskId: TASK,
    taskTitle: "Scan every configured repo",
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

async function finalizeWithGate(passed: boolean) {
  vi.resetModules();
  vi.doMock("../../src/tools/test-runner.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/tools/test-runner.js")>()),
    runTestGate: async () => passed
      ? { ran: true, passed: true, packages: [{ name: "workspace", passed: true }], command: "npm run test", totalDurationMs: 5 }
      : FAILED_GATE,
  }));
  return (await import("../../src/agent/lifecycle/shared.js")).finalizeRun;
}

/** The agent's work: the code change plus a new test, both uncommitted. */
async function agentWritesCodeAndTest(): Promise<void> {
  await writeFile(join(projectDir, "src", "scan.ts"), "export const scan = (c: { repos: string[] }) => c.repos;\n");
  await writeFile(join(projectDir, "tests", "scan.test.ts"), "// the new test\n");
}

async function freshItem(): Promise<PRDItem | null> {
  return (await resolveStore(join(projectDir, ".rex"))).getItem(TASK);
}

describe("a gate-failed run", () => {
  it("leaves the failing test, its error and the new-test hint on the task, and the next brief shows them", async () => {
    await agentWritesCodeAndTest();
    const finalizeRun = await finalizeWithGate(false);
    const run = buildRun();
    await finalizeRun({
      run, henchDir, projectDir, store,
      autoCommit: false, autonomous: true, rollbackOnFailure: false, startingHead: baseline,
    });

    expect(run.status).toBe("failed");
    const item = await freshItem();
    expect(item?.status).toBe("pending");
    expect(item?.failureReason).toContain("Test gate failed [command: npm run test]");
    expect(item?.failureReason).toContain("- tests/scan.test.ts > scan > lists every configured repo");
    expect(item?.failureReason).toContain("TypeError: Cannot read properties of undefined (reading 'repos')");
    expect(item?.failureReason).toContain(NEW_TEST_HINT);

    const { brief } = await assembleTaskBrief(await resolveStore(join(projectDir, ".rex")), TASK, { projectDir });
    const text = formatTaskBrief(brief);
    expect(text).toContain("## Previous attempt failed — do not repeat it");
    expect(text).toContain("TypeError: Cannot read properties of undefined (reading 'repos')");
    expect(text).toContain(NEW_TEST_HINT);
  });

  it("is cleared by a later run that completes the task", async () => {
    await store.updateItem(TASK, { failureReason: "Test gate failed: an earlier attempt" });
    const finalizeRun = await finalizeWithGate(true);
    const run = buildRun();
    await finalizeRun({
      run, henchDir, projectDir, store,
      autoCommit: false, autonomous: true, yes: true, rollbackOnFailure: false, startingHead: baseline,
    });

    expect(run.status).toBe("completed");
    const item = await freshItem();
    expect(item?.status).toBe("completed");
    expect(item?.failureReason).toBeUndefined();
  });
});
