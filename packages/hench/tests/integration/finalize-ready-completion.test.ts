import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { validateCompletion } from "../../src/validation/completion.js";
import { isFinalizeReadyParent } from "../../src/validation/finalize-ready.js";
import type { PRDStore } from "../../src/prd/rex-gateway.js";
import { initGitFixtureRepo, RM_RETRY } from "../helpers/index.js";

const execAsync = promisify(execCb);

/**
 * rex offers a parent whose children are all completed as actionable work.
 * Its work landed with its children, so a run on it changes no code; the gate
 * refused every such run, reset it to pending, and the next selection picked
 * it again — run after run, each leaving its status writes uncommitted.
 */

function storeWith(items: unknown[]): PRDStore {
  return { loadDocument: async () => ({ items }) } as unknown as PRDStore;
}

const feature = (childStatuses: string[]) => ({
  id: "feat-1",
  title: "Feature",
  level: "feature",
  status: "in_progress",
  children: childStatuses.map((status, i) => ({
    id: `task-${i}`,
    title: `Task ${i}`,
    level: "task",
    status,
  })),
});

describe("isFinalizeReadyParent", () => {
  it("is true for a parent whose children are all completed", async () => {
    expect(await isFinalizeReadyParent(storeWith([feature(["completed", "completed"])]), "feat-1")).toBe(true);
  });

  it("is false while any child is not completed — deferred included (#364)", async () => {
    expect(await isFinalizeReadyParent(storeWith([feature(["completed", "pending"])]), "feat-1")).toBe(false);
    expect(await isFinalizeReadyParent(storeWith([feature(["completed", "deferred"])]), "feat-1")).toBe(false);
  });

  it("is false for a leaf task, an unknown id, and an unreadable store", async () => {
    const items = [feature(["completed"])];
    expect(await isFinalizeReadyParent(storeWith(items), "task-0")).toBe(false);
    expect(await isFinalizeReadyParent(storeWith(items), "nope")).toBe(false);
    const broken = { loadDocument: async () => { throw new Error("boom"); } } as unknown as PRDStore;
    expect(await isFinalizeReadyParent(broken, "feat-1")).toBe(false);
  });
});

describe("validateCompletion — finalize-ready parent", () => {
  let projectDir: string;
  let head: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-finalize-ready-"));
    await initGitFixtureRepo(projectDir);
    await writeFile(join(projectDir, "README.md"), "x\n", "utf-8");
    await execAsync("git add . && git commit -m initial", { cwd: projectDir });
    head = (await execAsync("git rev-parse HEAD", { cwd: projectDir })).stdout.trim();
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("still refuses an empty diff for ordinary work", async () => {
    const result = await validateCompletion(projectDir, { startingHead: head });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/No changes detected/);
  });

  it("accepts an empty diff when the task only closes a finalize-ready parent", async () => {
    const result = await validateCompletion(projectDir, { startingHead: head, finalizeReadyParent: true });
    expect(result.valid).toBe(true);
    expect(result.hasChanges).toBe(false);
  });
});
