import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";
import { PRD_TREE_DIRNAME } from "../../src/prd/rex-gateway.js";
import { initGitFixtureRepo, RM_RETRY } from "../helpers/index.js";

const execAsync = promisify(execCb);

function buildCompletedRun(taskId: string): RunRecord {
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

/**
 * The completion commit on the `.ndx/` layout, through rex's real store.
 *
 * hench keeps only report paths under `.ndx/rex/prd_tree/`. The store used to
 * report them relative to `.ndx/` (`rex/prd_tree/...`), so every one was
 * dropped: the commit carried the tree-meta sidecar alone and the completed
 * item's file stayed dirty.
 */
describe("commitCompletionMetadata — .ndx/ layout, real store save report", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-ndx-layout-stage-"));
    henchDir = join(projectDir, ".ndx", "hench");
    rexDir = join(projectDir, ".ndx", "rex");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("commits the completed item's file under .ndx/rex/prd_tree/ and leaves it clean", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { resolveStore, takeSaveFileReport } = await import("../../src/prd/rex-gateway.js");

    await mkdir(join(rexDir, PRD_TREE_DIRNAME), { recursive: true });
    const store = await resolveStore(rexDir);
    await store.addItem({ id: "epic-1", title: "Epic One", status: "pending", level: "epic" });
    await store.addItem(
      { id: "feat-1", title: "Feature One", status: "in_progress", level: "feature", acceptanceCriteria: [] },
      "epic-1",
    );

    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "baseline"', { cwd: projectDir });
    takeSaveFileReport(store);

    await (finalizeRun as Function)({
      run: buildCompletedRun("feat-1"),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store,
    });

    // With the report dropped nothing is staged and HEAD stays at the baseline.
    const { stdout: subject } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
    expect(subject.trim()).toContain("feat-1");

    const { stdout: changed } = await execAsync("git show --format= --name-only HEAD", { cwd: projectDir });
    const changedFiles = changed.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(changedFiles).toContain(".ndx/rex/prd_tree/epic-one/feature-one.md");
    for (const file of changedFiles) {
      expect(file).toMatch(/^\.ndx\/rex\/(prd_tree\/epic-one\/(index\.md|feature-one\.md)|tree-meta\.json)$/);
    }

    const { stdout: status } = await execAsync("git status --porcelain", { cwd: projectDir });
    const dirtyTree = status.split("\n").filter((line) => line.includes("prd_tree"));
    expect(dirtyTree).toEqual([]);
  });
});
