import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import {
  collectBranchWork,
  parsePRDDocument,
  diffCompletedItems,
  buildBranchWorkItems,
} from "../../../src/analyzers/branch-work-collector.js";
import type {
  BranchWorkResult,
  CollectorOptions,
} from "../../../src/analyzers/branch-work-collector.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal PRD document factory. */
function makePRD(items: Record<string, unknown>[] = []) {
  return {
    schema: "rex/v1",
    title: "Test PRD",
    items,
  };
}

/** Minimal item factory with sensible defaults. */
function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "item-1",
    title: overrides.title ?? "Test item",
    status: overrides.status ?? "pending",
    level: overrides.level ?? "task",
    ...overrides,
  };
}

/** Initialise a git repo with the given PRD on `main`, then create a feature branch. */
async function setupGitRepo(
  dir: string,
  basePRD: Record<string, unknown>,
  branchPRD?: Record<string, unknown>,
  branchName = "feature/test-branch",
) {
  const rexDir = join(dir, ".rex");
  await mkdir(rexDir, { recursive: true });

  // Initialise git repo on main
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });

  // Write base PRD and commit on main
  await writeFile(join(rexDir, "prd.json"), JSON.stringify(basePRD, null, 2));
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial PRD"], { cwd: dir });

  // Create feature branch and optionally update PRD
  execFileSync("git", ["checkout", "-b", branchName], { cwd: dir });
  if (branchPRD) {
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(branchPRD, null, 2));
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "update PRD on branch"], { cwd: dir });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("branch-work-collector", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-bwc-"));
  });

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  // ── parsePRDDocument ────────────────────────────────────────────

  describe("parsePRDDocument", () => {
    it("parses a valid PRD JSON string", () => {
      const doc = parsePRDDocument(JSON.stringify(makePRD([makeItem()])));
      expect(doc).not.toBeNull();
      expect(doc!.items).toHaveLength(1);
      expect(doc!.items[0].id).toBe("item-1");
    });

    it("returns null for empty string", () => {
      expect(parsePRDDocument("")).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      expect(parsePRDDocument("{not valid json")).toBeNull();
    });

    it("returns null for JSON without items array", () => {
      expect(parsePRDDocument(JSON.stringify({ schema: "rex/v1" }))).toBeNull();
    });

    it("returns null for JSON where items is not an array", () => {
      expect(parsePRDDocument(JSON.stringify({ schema: "rex/v1", items: "oops" }))).toBeNull();
    });
  });

  // ── diffCompletedItems ─────────────────────────────────────────

  describe("diffCompletedItems", () => {
    it("returns items completed on branch but not on base", () => {
      const base = makePRD([
        makeItem({ id: "a", status: "completed" }),
        makeItem({ id: "b", status: "pending" }),
        makeItem({ id: "c", status: "pending" }),
      ]);
      const current = makePRD([
        makeItem({ id: "a", status: "completed" }),
        makeItem({ id: "b", status: "completed" }),
        makeItem({ id: "c", status: "pending" }),
      ]);

      const diff = diffCompletedItems(current.items, base.items);
      expect(diff).toEqual(new Set(["b"]));
    });

    it("returns all completed IDs when base has no completed items", () => {
      const base = makePRD([
        makeItem({ id: "a", status: "pending" }),
        makeItem({ id: "b", status: "pending" }),
      ]);
      const current = makePRD([
        makeItem({ id: "a", status: "completed" }),
        makeItem({ id: "b", status: "completed" }),
      ]);

      const diff = diffCompletedItems(current.items, base.items);
      expect(diff).toEqual(new Set(["a", "b"]));
    });

    it("returns empty set when no new completions", () => {
      const items = [
        makeItem({ id: "a", status: "completed" }),
        makeItem({ id: "b", status: "pending" }),
      ];

      const diff = diffCompletedItems(items, items);
      expect(diff.size).toBe(0);
    });

    it("handles nested children in hierarchy", () => {
      const baseItems = [
        makeItem({
          id: "epic-1",
          level: "epic",
          status: "pending",
          children: [
            makeItem({
              id: "feat-1",
              level: "feature",
              status: "pending",
              children: [
                makeItem({ id: "task-1", level: "task", status: "pending" }),
                makeItem({ id: "task-2", level: "task", status: "completed" }),
              ],
            }),
          ],
        }),
      ];

      const currentItems = [
        makeItem({
          id: "epic-1",
          level: "epic",
          status: "completed",
          children: [
            makeItem({
              id: "feat-1",
              level: "feature",
              status: "completed",
              children: [
                makeItem({ id: "task-1", level: "task", status: "completed" }),
                makeItem({ id: "task-2", level: "task", status: "completed" }),
              ],
            }),
          ],
        }),
      ];

      const diff = diffCompletedItems(currentItems, baseItems);
      // task-2 was already completed on base, so excluded
      expect(diff).toEqual(new Set(["epic-1", "feat-1", "task-1"]));
    });

    it("handles items that exist on current but not on base (new items)", () => {
      const baseItems = [makeItem({ id: "a", status: "pending" })];
      const currentItems = [
        makeItem({ id: "a", status: "pending" }),
        makeItem({ id: "b", status: "completed" }),
      ];

      const diff = diffCompletedItems(currentItems, baseItems);
      expect(diff).toEqual(new Set(["b"]));
    });

    it("handles empty base (no PRD on base branch)", () => {
      const currentItems = [
        makeItem({ id: "a", status: "completed" }),
        makeItem({ id: "b", status: "pending" }),
      ];

      const diff = diffCompletedItems(currentItems, []);
      expect(diff).toEqual(new Set(["a"]));
    });
  });

  // ── buildBranchWorkItems ───────────────────────────────────────

  describe("buildBranchWorkItems", () => {
    it("builds items with parent chain for leaf tasks", () => {
      const items = [
        makeItem({
          id: "epic-1",
          title: "Epic One",
          level: "epic",
          status: "pending",
          children: [
            makeItem({
              id: "feat-1",
              title: "Feature One",
              level: "feature",
              status: "pending",
              children: [
                makeItem({
                  id: "task-1",
                  title: "Task One",
                  level: "task",
                  status: "completed",
                  completedAt: "2026-02-24T10:00:00Z",
                  priority: "high",
                  tags: ["backend"],
                }),
              ],
            }),
          ],
        }),
      ];

      const branchIds = new Set(["task-1"]);
      const result = buildBranchWorkItems(items, branchIds);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("task-1");
      expect(result[0].title).toBe("Task One");
      expect(result[0].level).toBe("task");
      expect(result[0].completedAt).toBe("2026-02-24T10:00:00Z");
      expect(result[0].priority).toBe("high");
      expect(result[0].tags).toEqual(["backend"]);
      expect(result[0].parentChain).toEqual([
        { id: "epic-1", title: "Epic One", level: "epic" },
        { id: "feat-1", title: "Feature One", level: "feature" },
      ]);
    });

    it("builds items at multiple levels", () => {
      const items = [
        makeItem({
          id: "epic-1",
          title: "Epic One",
          level: "epic",
          status: "completed",
          children: [
            makeItem({
              id: "feat-1",
              title: "Feature One",
              level: "feature",
              status: "completed",
              children: [
                makeItem({
                  id: "task-1",
                  title: "Task One",
                  level: "task",
                  status: "completed",
                }),
              ],
            }),
          ],
        }),
      ];

      const branchIds = new Set(["epic-1", "feat-1", "task-1"]);
      const result = buildBranchWorkItems(items, branchIds);

      expect(result).toHaveLength(3);
      const ids = result.map((r) => r.id);
      expect(ids).toContain("epic-1");
      expect(ids).toContain("feat-1");
      expect(ids).toContain("task-1");

      // Epic has no parents
      const epic = result.find((r) => r.id === "epic-1")!;
      expect(epic.parentChain).toEqual([]);

      // Feature has epic as parent
      const feat = result.find((r) => r.id === "feat-1")!;
      expect(feat.parentChain).toEqual([
        { id: "epic-1", title: "Epic One", level: "epic" },
      ]);
    });

    it("returns empty array when no matching IDs", () => {
      const items = [makeItem({ id: "a", status: "completed" })];
      expect(buildBranchWorkItems(items, new Set())).toEqual([]);
    });

    it("handles items with description and acceptanceCriteria", () => {
      const items = [
        makeItem({
          id: "task-1",
          status: "completed",
          description: "Do the thing",
          acceptanceCriteria: ["It works", "It doesn't break"],
        }),
      ];

      const result = buildBranchWorkItems(items, new Set(["task-1"]));
      expect(result[0].description).toBe("Do the thing");
      expect(result[0].acceptanceCriteria).toEqual(["It works", "It doesn't break"]);
    });
  });

  // ── collectBranchWork (integration) ────────────────────────────

  describe("collectBranchWork", () => {
    it("identifies completed items on feature branch", async () => {
      const basePRD = makePRD([
        makeItem({
          id: "epic-1",
          level: "epic",
          status: "pending",
          children: [
            makeItem({ id: "task-1", level: "task", status: "pending" }),
            makeItem({ id: "task-2", level: "task", status: "completed" }),
          ],
        }),
      ]);

      const branchPRD = makePRD([
        makeItem({
          id: "epic-1",
          level: "epic",
          status: "pending",
          children: [
            makeItem({ id: "task-1", level: "task", status: "completed", completedAt: "2026-02-24T12:00:00Z" }),
            makeItem({ id: "task-2", level: "task", status: "completed" }),
          ],
        }),
      ]);

      await setupGitRepo(tmpDir, basePRD, branchPRD);

      const result = await collectBranchWork({ dir: tmpDir });

      expect(result.branch).toBe("feature/test-branch");
      expect(result.baseBranch).toBe("main");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("task-1");
      expect(result.collectedAt).toBeTruthy();
    });

    it("returns all completed items when no PRD exists on base branch", async () => {
      // Initialise git with an empty commit on main (no rex dir)
      execFileSync("git", ["init", "-b", "main"], { cwd: tmpDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });

      // Create an initial commit with a dummy file
      await writeFile(join(tmpDir, "README.md"), "hello");
      execFileSync("git", ["add", "."], { cwd: tmpDir });
      execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });

      // Feature branch with PRD
      execFileSync("git", ["checkout", "-b", "feature/new"], { cwd: tmpDir });
      const rexDir = join(tmpDir, ".rex");
      await mkdir(rexDir, { recursive: true });
      const prd = makePRD([
        makeItem({ id: "a", status: "completed" }),
        makeItem({ id: "b", status: "pending" }),
      ]);
      await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd, null, 2));
      execFileSync("git", ["add", "."], { cwd: tmpDir });
      execFileSync("git", ["commit", "-m", "add PRD"], { cwd: tmpDir });

      const result = await collectBranchWork({ dir: tmpDir });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("a");
    });

    it("returns empty items when no PRD exists on current branch", async () => {
      // Initialise git with no rex dir
      execFileSync("git", ["init", "-b", "main"], { cwd: tmpDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });
      await writeFile(join(tmpDir, "README.md"), "hello");
      execFileSync("git", ["add", "."], { cwd: tmpDir });
      execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });
      execFileSync("git", ["checkout", "-b", "feature/empty"], { cwd: tmpDir });

      const result = await collectBranchWork({ dir: tmpDir });

      expect(result.items).toEqual([]);
      expect(result.branch).toBe("feature/empty");
    });

    it("supports custom baseBranch option", async () => {
      // Create develop as base branch
      execFileSync("git", ["init", "-b", "develop"], { cwd: tmpDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });

      const rexDir = join(tmpDir, ".rex");
      await mkdir(rexDir, { recursive: true });
      const basePRD = makePRD([makeItem({ id: "a", status: "pending" })]);
      await writeFile(join(rexDir, "prd.json"), JSON.stringify(basePRD, null, 2));
      execFileSync("git", ["add", "."], { cwd: tmpDir });
      execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });

      execFileSync("git", ["checkout", "-b", "feature/from-develop"], { cwd: tmpDir });
      const branchPRD = makePRD([makeItem({ id: "a", status: "completed" })]);
      await writeFile(join(rexDir, "prd.json"), JSON.stringify(branchPRD, null, 2));
      execFileSync("git", ["add", "."], { cwd: tmpDir });
      execFileSync("git", ["commit", "-m", "complete task"], { cwd: tmpDir });

      const result = await collectBranchWork({
        dir: tmpDir,
        baseBranch: "develop",
      });

      expect(result.baseBranch).toBe("develop");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("a");
    });

    it("handles corrupted PRD on disk gracefully", async () => {
      execFileSync("git", ["init", "-b", "main"], { cwd: tmpDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });
      await writeFile(join(tmpDir, "README.md"), "hello");
      execFileSync("git", ["add", "."], { cwd: tmpDir });
      execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });
      execFileSync("git", ["checkout", "-b", "feature/broken"], { cwd: tmpDir });

      // Write corrupted PRD
      const rexDir = join(tmpDir, ".rex");
      await mkdir(rexDir, { recursive: true });
      await writeFile(join(rexDir, "prd.json"), "{{{not valid");
      execFileSync("git", ["add", "."], { cwd: tmpDir });
      execFileSync("git", ["commit", "-m", "broken PRD"], { cwd: tmpDir });

      const result = await collectBranchWork({ dir: tmpDir });

      expect(result.items).toEqual([]);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("handles non-git directory gracefully", async () => {
      // No git init — just a bare directory
      const rexDir = join(tmpDir, ".rex");
      await mkdir(rexDir, { recursive: true });
      const prd = makePRD([makeItem({ id: "a", status: "completed" })]);
      await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd, null, 2));

      const result = await collectBranchWork({ dir: tmpDir });

      // Should still work: returns all completed items with unknown branch
      expect(result.branch).toBe("unknown");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("a");
    });

    it("auto-detects master as base branch when main does not exist", async () => {
      execFileSync("git", ["init", "-b", "master"], { cwd: tmpDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });

      const rexDir = join(tmpDir, ".rex");
      await mkdir(rexDir, { recursive: true });
      const basePRD = makePRD([makeItem({ id: "x", status: "pending" })]);
      await writeFile(join(rexDir, "prd.json"), JSON.stringify(basePRD, null, 2));
      execFileSync("git", ["add", "."], { cwd: tmpDir });
      execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });

      execFileSync("git", ["checkout", "-b", "feature/from-master"], { cwd: tmpDir });
      const branchPRD = makePRD([makeItem({ id: "x", status: "completed" })]);
      await writeFile(join(rexDir, "prd.json"), JSON.stringify(branchPRD, null, 2));
      execFileSync("git", ["add", "."], { cwd: tmpDir });
      execFileSync("git", ["commit", "-m", "done"], { cwd: tmpDir });

      const result = await collectBranchWork({ dir: tmpDir });

      expect(result.baseBranch).toBe("master");
      expect(result.items).toHaveLength(1);
    });

    it("populates epic summaries for branch work items", async () => {
      const basePRD = makePRD([
        makeItem({
          id: "epic-1",
          title: "Auth System",
          level: "epic",
          status: "pending",
          children: [
            makeItem({ id: "t1", level: "task", status: "pending" }),
            makeItem({ id: "t2", level: "task", status: "pending" }),
          ],
        }),
        makeItem({
          id: "epic-2",
          title: "Dashboard",
          level: "epic",
          status: "pending",
          children: [
            makeItem({ id: "t3", level: "task", status: "pending" }),
          ],
        }),
      ]);

      const branchPRD = makePRD([
        makeItem({
          id: "epic-1",
          title: "Auth System",
          level: "epic",
          status: "pending",
          children: [
            makeItem({ id: "t1", level: "task", status: "completed" }),
            makeItem({ id: "t2", level: "task", status: "completed" }),
          ],
        }),
        makeItem({
          id: "epic-2",
          title: "Dashboard",
          level: "epic",
          status: "pending",
          children: [
            makeItem({ id: "t3", level: "task", status: "pending" }),
          ],
        }),
      ]);

      await setupGitRepo(tmpDir, basePRD, branchPRD);

      const result = await collectBranchWork({ dir: tmpDir });

      expect(result.items).toHaveLength(2); // t1, t2
      expect(result.epicSummaries).toBeDefined();
      expect(result.epicSummaries).toHaveLength(1); // Only Auth System
      expect(result.epicSummaries![0].id).toBe("epic-1");
      expect(result.epicSummaries![0].title).toBe("Auth System");
      expect(result.epicSummaries![0].completedCount).toBe(2);
    });

    it("works when running on the base branch itself", async () => {
      const prd = makePRD([
        makeItem({ id: "a", status: "completed" }),
        makeItem({ id: "b", status: "pending" }),
      ]);

      execFileSync("git", ["init", "-b", "main"], { cwd: tmpDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });
      const rexDir = join(tmpDir, ".rex");
      await mkdir(rexDir, { recursive: true });
      await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd, null, 2));
      execFileSync("git", ["add", "."], { cwd: tmpDir });
      execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });

      // Running on main — diffing against itself should yield 0 items
      const result = await collectBranchWork({ dir: tmpDir });

      expect(result.branch).toBe("main");
      expect(result.items).toEqual([]);
    });
  });
});
