/**
 * A task-less change is a unit of work a hench run can finish, end to end.
 *
 * On the change layer a change with no live tasks is itself the unit
 * (`rex/src/core/change-selection.ts`). A run opens the store `resolveStore`
 * returns — the change layer on a v2 tree — and selects through rex's v2
 * selector (`selectTaskEntry` with the tree); the v1 selector never answers
 * for a v2 tree, not even when v2's rules leave nothing to run.
 *
 * Real throughout: a real v2 tree on disk, the store `resolveStore` returns,
 * the real claims store, rex's real MCP status handler and hench's real
 * `finalizeRun`. Only the test gate's verdict is stubbed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { handleUpdateTaskStatus } from "@n-dx/rex/dist/cli/mcp-tools/index.js";
import { resolveStore, isChangeLayerStore } from "../../src/prd/rex-gateway.js";
import type { PRDStore, V2Tree } from "../../src/prd/rex-gateway.js";
import { selectTaskEntry } from "../../src/agent/planning/brief.js";
import { loadV2Tree } from "../../src/agent/planning/work-selection.js";
import { initConfig } from "../../src/store/config.js";
import { TaskClaims } from "../../src/process/task-claims.js";
import type { RunRecord } from "../../src/schema/index.js";
import { initGitFixtureRepo, cleanupProjectDir } from "../helpers/index.js";

/** The capability the change is placed on. */
const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
/** The change with no tasks — the unit under test. */
const CHANGE = "c0000000-0000-4000-8000-000000000001";
/** A second change, with one task, so selection has something to choose between. */
const TASKED_CHANGE = "c0000000-0000-4000-8000-000000000011";
const TASK = "c0000000-0000-4000-8000-000000000012";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

let projectDir: string;
let rexDir: string;
let henchDir: string;
let store: PRDStore;
let claims: TaskClaims;
let baseline: string;

/** A v2 tree: one area with one capability, and two changes placed on it. */
async function writeV2Tree(): Promise<void> {
  await mkdir(join(rexDir, "product", "checkout"), { recursive: true });
  await writeFile(
    join(rexDir, "product", "index.md"),
    `---\ntitle: "Fixture shop"\nschema: "rex/v2"\nslugRule: 2\n---\n`,
  );
  await writeFile(
    join(rexDir, "product", "checkout", "index.md"),
    `---\nid: "a0000000-0000-4000-8000-000000000001"\ntype: "area"\ntitle: "Checkout"\nslug: "checkout"\ndisplayId: "A1"\n---\n`,
  );
  await writeFile(
    join(rexDir, "product", "checkout", "pay-by-card.md"),
    `---\nid: "${CAPABILITY}"\ntype: "capability"\ntitle: "Pay by card"\nslug: "pay-by-card"\ndisplayId: "A1.1"\nstatement: "A shopper can pay by card."\ncriteria: [{"id":"c1","text":"The charge succeeds"}]\n---\n`,
  );

  await mkdir(join(rexDir, "changes", "raise-the-card-timeout"), { recursive: true });
  await writeFile(
    join(rexDir, "changes", "raise-the-card-timeout", "index.md"),
    `---\nid: "${CHANGE}"\ntype: "change"\ntitle: "Raise the card timeout"\nslug: "raise-the-card-timeout"\ndisplayId: "CH-1"\nintent: "The gateway is slower than our timeout."\ntouches: ["${CAPABILITY}"]\npriority: "high"\n---\n`,
  );

  await mkdir(join(rexDir, "changes", "retry-declined-cards"), { recursive: true });
  await writeFile(
    join(rexDir, "changes", "retry-declined-cards", "index.md"),
    `---\nid: "${TASKED_CHANGE}"\ntype: "change"\ntitle: "Retry declined cards"\nslug: "retry-declined-cards"\ndisplayId: "CH-2"\nintent: "A soft decline should be retried once."\ntouches: ["${CAPABILITY}"]\npriority: "low"\n---\n`,
  );
  await writeFile(
    join(rexDir, "changes", "retry-declined-cards", "wire-the-retry.md"),
    `---\nid: "${TASK}"\ntype: "task"\ntitle: "Wire the retry"\nslug: "wire-the-retry"\n---\n`,
  );

  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }),
  );
}

/** The tree selection reads, loaded fresh from the store each time. */
async function tree(): Promise<V2Tree> {
  const loaded = await loadV2Tree(store);
  if (!loaded) throw new Error("the fixture is a v2 tree");
  return loaded;
}

beforeEach(async () => {
  projectDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hench-v2-unit-")));
  rexDir = join(projectDir, ".rex");
  henchDir = join(projectDir, ".hench");
  await initConfig(henchDir);
  await mkdir(join(henchDir, "runs"), { recursive: true });
  await initGitFixtureRepo(projectDir);
  await writeV2Tree();

  await writeFile(join(projectDir, ".gitignore"), ".hench/\n.run-logs/\n.rex/execution-log*.jsonl\n.rex/.cache/\n");
  await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: "shop", scripts: { test: "vitest run" } }));
  await mkdir(join(projectDir, "src"));
  await writeFile(join(projectDir, "src", "checkout.ts"), "export const timeoutMs = 2000;\n");
  git(projectDir, "add", "-A");
  git(projectDir, "commit", "-q", "-m", "baseline");
  baseline = git(projectDir, "rev-parse", "HEAD").trim();

  store = await resolveStore(rexDir);
  claims = TaskClaims.forProject(projectDir);

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

/** `finalizeRun` with the gate's verdict fixed; everything else real. */
async function finalizeWithPassingGate() {
  vi.resetModules();
  vi.doMock("../../src/tools/test-runner.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/tools/test-runner.js")>()),
    runTestGate: async () => ({
      ran: true,
      passed: true,
      packages: [{ name: "workspace", passed: true }],
      command: "npm run test",
      totalDurationMs: 5,
    }),
  }));
  return (await import("../../src/agent/lifecycle/shared.js")).finalizeRun;
}

function buildRun(taskId: string, taskTitle: string): RunRecord {
  return {
    id: randomUUID(),
    taskId,
    taskTitle,
    startedAt: new Date().toISOString(),
    status: "completed",
    turns: 2,
    tokenUsage: { input: 100, output: 50 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
    startHead: baseline,
    branch: git(projectDir, "rev-parse", "--abbrev-ref", "HEAD").trim(),
    worktreeRoot: projectDir,
  };
}

/** The agent's side: mark its own unit completed through rex MCP. */
async function agentCompletesThroughMcp(id: string, detail: string): Promise<Record<string, unknown>> {
  const out = await handleUpdateTaskStatus(
    store,
    projectDir,
    { id, status: "completed", resolutionType: "code-change", resolutionDetail: detail },
    { store: claims.store, worktreeRoot: claims.holder.worktreeRoot },
  );
  return JSON.parse(out.content[0].text);
}

describe("the store a run opens on a v2 tree", () => {
  it("is the change layer, with a task-less change as an item of its own", async () => {
    // `resolveStore` is layout-aware: a run that opened the v1 store here
    // would look for prd_tree/, which a v2 checkout does not have, and read
    // an empty PRD — "no actionable tasks" where the tree has two changes.
    expect(isChangeLayerStore(store)).toBe(true);
    const { items } = await store.loadDocument();
    expect(items.map((i) => i.id).sort()).toEqual([CHANGE, TASKED_CHANGE].sort());
  });
});

describe("selecting a task-less change", () => {
  it("picks the change itself, and claims it", async () => {
    const entry = await selectTaskEntry((await store.loadDocument()).items, { tree: await tree(), claims });

    expect(entry.item.id).toBe(CHANGE);
    expect(entry.item.title).toBe("Raise the card timeout");
    // Claimed here, not elsewhere: a re-claim from this worktree is a renewal.
    // That the claim is live is what makes the completion below held rather
    // than written, which the last test asserts end to end.
    expect(await claims.heldElsewhere(CHANGE)).toBeNull();
    expect(await claims.claim(CHANGE)).toBeNull();
  });

  it("picks the task inside a change that has one, never the change", async () => {
    // The task-less change is `high` and sorts first, so excluding it is the
    // only way to reach the second change — which must then yield its task.
    const entry = await selectTaskEntry((await store.loadDocument()).items, {
      tree: await tree(),
      excludeTaskIds: new Set([CHANGE]),
    });

    expect(entry.item.id).toBe(TASK);
  });

  it("refuses rather than falling back to the v1 selector when nothing is actionable", async () => {
    // Falling through here is the bug this guards: `findNextTask` knows
    // nothing of v2's rules, so it would answer for a tree they had just
    // excluded everything from.
    await expect(
      selectTaskEntry((await store.loadDocument()).items, {
        tree: await tree(),
        excludeTaskIds: new Set([CHANGE, TASKED_CHANGE, TASK]),
      }),
    ).rejects.toThrow(/No actionable tasks found in PRD/);
  });
});

describe("completing a task-less change through a run", () => {
  it("holds the agent's completion, then writes it to the v2 tree once the gate passes", async () => {
    const entry = await selectTaskEntry((await store.loadDocument()).items, { tree: await tree(), claims });
    expect(entry.item.id).toBe(CHANGE);
    await store.updateItem(CHANGE, { status: "in_progress" });

    // The agent does the work, completes its unit, and commits everything.
    const reply = await agentCompletesThroughMcp(CHANGE, "Timeout raised to 8s");
    expect(reply.completionHeld).toBe(true);
    await writeFile(join(projectDir, "src", "checkout.ts"), "export const timeoutMs = 8000;\n");
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "feat: raise the card timeout");

    // Held, not written: the change is still in_progress on disk.
    expect((await (await resolveStore(rexDir)).getItem(CHANGE))?.status).toBe("in_progress");

    const finalizeRun = await finalizeWithPassingGate();
    const run = buildRun(CHANGE, "Raise the card timeout");
    await finalizeRun({
      run, henchDir, projectDir, store, claims,
      autoCommit: true, autonomous: true, rollbackOnFailure: false, startingHead: baseline,
    });

    expect(run.status).toBe("completed");
    expect(run.completionHold?.outcome).toBe("applied");

    const completed = await (await resolveStore(rexDir)).getItem(CHANGE);
    expect(completed?.status).toBe("completed");
    expect(completed?.resolutionDetail).toBe("Timeout raised to 8s");

    // Written as v2 state, not as a v1 item: the change keeps its own folder
    // and its status lives in that folder's state.yaml.
    const state = await readFile(join(rexDir, "changes", "raise-the-card-timeout", "state.yaml"), "utf-8");
    expect(state).toMatch(/completed/);
    const index = await readFile(join(rexDir, "changes", "raise-the-card-timeout", "index.md"), "utf-8");
    expect(index).toMatch(/type: "change"/);
  });
});
