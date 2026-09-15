import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";
import { PRD_TREE_DIRNAME, TREE_META_FILENAME } from "../../src/prd/rex-gateway.js";
import { initGitFixtureRepo } from "../helpers/index.js";

/** The agent's proposed commit message, as the commit prompt expects to find it. */
const PENDING_COMMIT_FILE = ".hench-commit-msg.txt";

const execAsync = promisify(execCb);

/**
 * `.rex/tree-meta.json` through both commit paths.
 *
 * The sidecar is tracked, and every folder-tree save rewrites it — so in any
 * project whose committed copy predates the schema marker (this repo's merge
 * base carried a bare `{"title":"PRD"}`), the first PRD write of a run leaves
 * ` M .rex/tree-meta.json` behind. It is not a hench runtime artifact and it
 * is not under `.rex/prd_tree/`, so before this it was discounted by neither
 * gate and staged by neither committer: the completion gate refused every
 * task, forever, on dirt the run's own code had produced.
 */
describe("tree-meta sidecar — commit paths", () => {
  const taskId = "task-abc-123";
  let projectDir: string;
  let henchDir: string;
  let taskIndexPath: string;
  let treeMetaPath: string;

  function buildCompletedRun(): RunRecord {
    return {
      id: randomUUID(),
      taskId,
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

  /** A store whose status write rewrites the sidecar, as the real one does. */
  function buildStore() {
    let status = "in_progress";
    return {
      getItem: vi.fn(async (id: string) =>
        id === taskId ? { id: taskId, status, title: "Test task", level: "task" } : null,
      ),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id !== taskId || typeof updates.status !== "string") return;
        const next = updates.status;
        const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
        await writeFile(taskIndexPath, current.replace(`status: ${status}`, `status: ${next}`), "utf-8");
        // Every save rewrites the sidecar, marker included.
        await writeFile(treeMetaPath, JSON.stringify({ title: "PRD", schema: "rex/v1" }), "utf-8");
        status = next;
      }),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };
  }

  async function runFinalize(
    run: RunRecord,
    store: ReturnType<typeof buildStore>,
    autoCommit: boolean,
  ): Promise<void> {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    await (finalizeRun as Function)({
      run,
      henchDir,
      projectDir,
      autoCommit,
      skipFullTestGate: true,
      autonomous: true,
      yes: true,
      store,
    });
  }

  /**
   * The agent's own in-run `rex_update_status` call, which is what dirties the
   * sidecar *before* `finalizeRun`'s gate rather than after it. The committed
   * copy predates the schema marker, so rewriting it changes its bytes.
   */
  async function simulateAgentPrdWrite(): Promise<void> {
    await writeFile(treeMetaPath, JSON.stringify({ title: "PRD", schema: "rex/v1" }), "utf-8");
  }

  /** Paths touched by the tip commit. */
  async function filesInHeadCommit(): Promise<string[]> {
    const { stdout } = await execAsync("git show --name-only --pretty=format: HEAD", {
      cwd: projectDir,
    });
    return stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-tree-meta-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);

    const taskDir = join(projectDir, ".rex", PRD_TREE_DIRNAME, "task-slug-abc");
    await mkdir(taskDir, { recursive: true });
    taskIndexPath = join(taskDir, "index.md");
    await writeFile(taskIndexPath, "# Test task\nstatus: in_progress\n", "utf-8");
    treeMetaPath = join(projectDir, ".rex", TREE_META_FILENAME);
    // Committed in its pre-marker shape, so the next store save changes it.
    await writeFile(treeMetaPath, JSON.stringify({ title: "PRD" }), "utf-8");

    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("completes when the only dirt is a rewritten sidecar, and commits it (autoCommit)", async () => {
    // The agent committed its own work, as the autoCommit path assumes; the
    // sidecar rewrite happens afterwards, inside finalizeRun's status write.
    await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "feat: the work"', { cwd: projectDir });
    await simulateAgentPrdWrite();

    const run = buildCompletedRun();
    await runFinalize(run, buildStore(), true);

    expect(run.status).toBe("completed");
    expect(await filesInHeadCommit()).toContain(`.rex/${TREE_META_FILENAME}`);

    const { stdout } = await execAsync("git status --porcelain", { cwd: projectDir });
    expect(stdout).not.toContain(TREE_META_FILENAME);
  });

  it("still refuses when real work is leaked alongside the sidecar", async () => {
    await writeFile(join(projectDir, "leaked.ts"), "export const leaked = true;\n", "utf-8");

    const run = buildCompletedRun();
    await runFinalize(run, buildStore(), true);

    expect(run.status).toBe("failed");
    expect(run.error).toContain("leaked.ts");
  });

  it("stages the sidecar into the commit prompt's commit (non-autoCommit)", async () => {
    // The interactive path: the agent staged its work and left a commit
    // message, and performCommitPromptIfNeeded runs `git commit -F` next.
    await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });
    await writeFile(join(projectDir, PENDING_COMMIT_FILE), "feat: the work\n", "utf-8");
    await simulateAgentPrdWrite();

    const run = buildCompletedRun();
    await runFinalize(run, buildStore(), false);

    expect(run.status).toBe("completed");
    const committed = await filesInHeadCommit();
    expect(committed).toContain("src.ts");
    expect(committed).toContain(`.rex/${TREE_META_FILENAME}`);
  });
});
