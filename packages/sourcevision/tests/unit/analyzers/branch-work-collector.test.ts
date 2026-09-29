import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

vi.mock("../../../src/util/exec-cli.js", () => ({ execFileSyncCli: vi.fn() }));

import {
  collectBranchWork,
  collectCompletedIds,
  buildBranchWorkItems,
  diffCompletedViaRex,
} from "../../../src/analyzers/branch-work-collector.js";
import type {
  BranchWorkResult,
  CollectorOptions,
  RexBridge,
} from "../../../src/analyzers/branch-work-collector.js";
import { execFileSyncCli } from "../../../src/util/exec-cli.js";

const mockedExecFileSyncCli = vi.mocked(execFileSyncCli);

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

/**
 * Initialise a git repo on `baseName` and check out `branchName`.
 *
 * No PRD is written: since rex owns both reading the PRD and diffing it, the
 * collector's own tests supply those through {@link CollectorOptions.rex} and
 * need git only for the branch detection it still does itself.
 */
async function setupGitRepo(
  dir: string,
  branchName: string | null = "feature/test-branch",
  baseName = "main",
) {
  execFileSync("git", ["init", "-b", baseName], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });

  await writeFile(join(dir, "README.md"), "hello");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

  if (branchName) {
    execFileSync("git", ["checkout", "-b", branchName], { cwd: dir });
  }
}

/**
 * A {@link RexBridge} double that records what it was asked.
 *
 * `diffCompleted` returning null is rex saying "I could not compare", which is
 * a different answer from an empty set and the collector treats it as such.
 * `reliable: false` (via `overrides`) simulates tree-diff reporting either
 * side of the comparison as having no PRD tree at all.
 *
 * The returned `baseBranch` echoes what was actually asked for (falling back
 * to "main" when nothing was, simulating tree-diff's own default resolution
 * landing there) unless `overrides.baseBranch` names something else — the
 * collector must take its label from this answer, not recompute one locally.
 */
function fakeRex(
  doc: Record<string, unknown> | null,
  completed: string[] | null,
  overrides: { baseBranch?: string; reliable?: boolean } = {},
): RexBridge & { calls: { dir: string; baseBranch: string | undefined }[] } {
  const calls: { dir: string; baseBranch: string | undefined }[] = [];
  return {
    calls,
    readPRD: () => doc as never,
    diffCompleted: (dir: string, baseBranch?: string) => {
      calls.push({ dir, baseBranch });
      if (completed === null) return null;
      const reliable = overrides.reliable ?? true;
      return {
        baseBranch: overrides.baseBranch ?? baseBranch ?? "main",
        ids: reliable ? new Set(completed) : new Set(),
        reliable,
      };
    },
  };
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

  // ── collectCompletedIds ────────────────────────────────────────
  //
  // The fallback set, for when there is no baseline to diff against. The diff
  // itself is rex's — `diffCompletedItems` used to live here and is gone, so
  // that "what did this branch finish" has exactly one implementation. Its
  // semantics are covered by rex's own tree-diff tests.

  describe("collectCompletedIds", () => {
    it("collects completed ids across the whole hierarchy", () => {
      const items = [
        makeItem({
          id: "epic-1",
          level: "epic",
          status: "completed",
          children: [
            makeItem({
              id: "feat-1",
              level: "feature",
              status: "pending",
              children: [
                makeItem({ id: "task-1", level: "task", status: "completed" }),
                makeItem({ id: "task-2", level: "task", status: "pending" }),
              ],
            }),
          ],
        }),
      ];

      expect(collectCompletedIds(items)).toEqual(new Set(["epic-1", "task-1"]));
    });

    it("returns an empty set when nothing is completed", () => {
      expect(collectCompletedIds([makeItem({ id: "a", status: "pending" })]).size).toBe(0);
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

  // ── collectBranchWork ──────────────────────────────────────────
  //
  // rex answers both "what is in the PRD" and "what did this branch complete",
  // so these supply that pair directly and assert what the collector does with
  // it: which base branch it asks about, and what it reports when the answer
  // does not come back. The real spawns are covered by the `sv pr-markdown`
  // e2e test, which runs against a built rex and a real folder tree.

  describe("collectBranchWork", () => {
    const TREE = makePRD([
      makeItem({
        id: "epic-1",
        title: "Auth System",
        level: "epic",
        status: "pending",
        children: [
          makeItem({
            id: "task-1",
            level: "task",
            status: "completed",
            completedAt: "2026-02-24T12:00:00Z",
            description: "Exchange the token",
            acceptanceCriteria: ["It works"],
          }),
          makeItem({ id: "task-2", level: "task", status: "completed" }),
        ],
      }),
    ]);

    it("reports the items rex's diff attributes to this branch", async () => {
      await setupGitRepo(tmpDir);

      const result = await collectBranchWork({
        dir: tmpDir,
        rex: fakeRex(TREE, ["task-1"]),
      });

      expect(result.branch).toBe("feature/test-branch");
      expect(result.baseBranch).toBe("main");
      expect(result.items.map((i) => i.id)).toEqual(["task-1"]);
      expect(result.collectedAt).toBeTruthy();
    });

    it("enriches items from the PRD, not from the diff", async () => {
      await setupGitRepo(tmpDir);

      const result = await collectBranchWork({
        dir: tmpDir,
        rex: fakeRex(TREE, ["task-1"]),
      });

      // The diff only carries ids; everything a report needs comes from the
      // tree rex returned. This is the assertion that the two are joined.
      const item = result.items[0];
      expect(item.description).toBe("Exchange the token");
      expect(item.acceptanceCriteria).toEqual(["It works"]);
      expect(item.completedAt).toBe("2026-02-24T12:00:00Z");
      expect(item.parentChain.map((p) => p.id)).toEqual(["epic-1"]);
    });

    // #442 finding 6: this call used to pass a locally-detected base branch as
    // `--from`, overriding tree-diff's own `origin/HEAD`-aware default. It
    // must leave `--from` out when nothing was given explicitly, so tree-diff
    // applies its own default instead of a possibly-stale local guess.
    it("does not force a locally-detected base branch onto rex", async () => {
      await setupGitRepo(tmpDir);
      const rex = fakeRex(TREE, []);

      await collectBranchWork({ dir: tmpDir, rex });

      expect(rex.calls).toHaveLength(1);
      expect(rex.calls[0].baseBranch).toBeUndefined();
    });

    it("reports the base branch rex actually diffed against, not a local guess", async () => {
      await setupGitRepo(tmpDir, "feature/from-master", "master");
      // rex's own default resolution landed on "master" — simulated here since
      // there is no real rex/git-remote setup backing this fake.
      const rex = fakeRex(TREE, [], { baseBranch: "master" });

      const result = await collectBranchWork({ dir: tmpDir, rex });

      expect(result.baseBranch).toBe("master");
      expect(rex.calls[0].baseBranch).toBeUndefined();
    });

    it("honours an explicit baseBranch", async () => {
      await setupGitRepo(tmpDir, "feature/from-develop", "develop");
      const rex = fakeRex(TREE, ["task-1"]);

      const result = await collectBranchWork({
        dir: tmpDir,
        baseBranch: "develop",
        rex,
      });

      expect(result.baseBranch).toBe("develop");
      expect(rex.calls[0].baseBranch).toBe("develop");
    });

    it("returns an empty result with an error when rex has no PRD to read", async () => {
      await setupGitRepo(tmpDir);

      const result = await collectBranchWork({
        dir: tmpDir,
        rex: fakeRex(null, ["task-1"]),
      });

      expect(result.items).toEqual([]);
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it("falls back to every completed item when the diff fails, and says why", async () => {
      await setupGitRepo(tmpDir);

      // null is rex saying "I could not compare" — an unresolvable base ref.
      const result = await collectBranchWork({
        dir: tmpDir,
        rex: fakeRex(TREE, null),
      });

      expect(result.items.map((i) => i.id).sort()).toEqual(["task-1", "task-2"]);
      // The full list must not pass for a real answer.
      expect(result.errors?.join(" ")).toContain("main");
    });

    // #442 finding 2: a diff that succeeded but reported either side as
    // having no PRD tree (a legacy prd.md project on the "to" side, or a base
    // ref predating the PRD on the "from" side) used to be read as a real
    // answer — tree-diff's `completed` array either way, silently. Neither the
    // whole-project fallback above (a total diff failure) nor a silently empty
    // result is correct here: the caller must warn and report no branch work.
    it("warns and reports no branch work when either side of the diff has no PRD tree", async () => {
      await setupGitRepo(tmpDir);
      const rex = fakeRex(TREE, ["task-1", "task-2"], { reliable: false });

      const result = await collectBranchWork({ dir: tmpDir, rex });

      expect(result.items).toEqual([]);
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it("returns all completed items in a non-git directory, without asking rex to diff", async () => {
      const rex = fakeRex(TREE, ["task-1"]);

      const result = await collectBranchWork({ dir: tmpDir, rex });

      expect(result.branch).toBe("unknown");
      expect(result.items.map((i) => i.id).sort()).toEqual(["task-1", "task-2"]);
      // No baseline exists, so there is nothing to ask and nothing to explain.
      expect(rex.calls).toHaveLength(0);
      expect(result.errors).toBeUndefined();
    });

    it("yields nothing when running on the base branch itself", async () => {
      await setupGitRepo(tmpDir, null);
      const rex = fakeRex(TREE, ["task-1"]);

      const result = await collectBranchWork({ dir: tmpDir, rex });

      expect(result.branch).toBe("main");
      expect(result.items).toEqual([]);
      expect(rex.calls).toHaveLength(0);
    });

    it("populates epic summaries for branch work items", async () => {
      await setupGitRepo(tmpDir);

      const result = await collectBranchWork({
        dir: tmpDir,
        rex: fakeRex(TREE, ["task-1", "task-2"]),
      });

      expect(result.items).toHaveLength(2);
      expect(result.epicSummaries).toHaveLength(1);
      expect(result.epicSummaries![0].id).toBe("epic-1");
      expect(result.epicSummaries![0].title).toBe("Auth System");
      expect(result.epicSummaries![0].completedCount).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// diffCompletedViaRex — the JSON contract with the real `rex tree-diff --json`
// ---------------------------------------------------------------------------
//
// #442 findings 2 and 6: this is the parsing this module used to get wrong —
// reading `completed` while ignoring `sources.from.present` / `sources.to
// .present`, and always sending `--from`. `execFileSyncCli` is mocked here so
// the JSON shapes tree-diff actually produces (see rex's own
// `tree-diff-sources.test.ts`) can be fed in directly, without a built rex.

describe("diffCompletedViaRex", () => {
  beforeEach(() => {
    mockedExecFileSyncCli.mockReset();
  });

  function mockTreeDiffOutput(payload: Record<string, unknown>): void {
    mockedExecFileSyncCli.mockReturnValue(JSON.stringify(payload));
  }

  it("returns the completed ids and echoes the base label when both sides are present", () => {
    mockTreeDiffOutput({
      sources: { from: { label: "main", present: true }, to: { present: true } },
      completed: [{ id: "task-1" }, { id: "task-2" }],
    });

    const result = diffCompletedViaRex("/proj", undefined);

    expect(result).toEqual({
      baseBranch: "main",
      ids: new Set(["task-1", "task-2"]),
      reliable: true,
    });
  });

  it("omits --from when no baseBranch is given", () => {
    mockTreeDiffOutput({
      sources: { from: { label: "main", present: true }, to: { present: true } },
      completed: [],
    });

    diffCompletedViaRex("/proj", undefined);

    const args = mockedExecFileSyncCli.mock.calls[0][1];
    expect(args.some((a) => a.startsWith("--from="))).toBe(false);
  });

  it("passes --from when a baseBranch is given explicitly", () => {
    mockTreeDiffOutput({
      sources: { from: { label: "develop", present: true }, to: { present: true } },
      completed: [],
    });

    diffCompletedViaRex("/proj", "develop");

    const args = mockedExecFileSyncCli.mock.calls[0][1];
    expect(args).toContain("--from=develop");
  });

  it("reports unreliable with empty ids when the baseline has no PRD tree", () => {
    mockTreeDiffOutput({
      sources: { from: { label: "main", present: false }, to: { present: true } },
      // tree-diff's own completed array would list every current completion
      // here — the point of `reliable: false` is that this is disregarded.
      completed: [{ id: "task-1" }, { id: "task-2" }],
    });

    const result = diffCompletedViaRex("/proj", undefined);

    expect(result).toEqual({ baseBranch: "main", ids: new Set(), reliable: false });
  });

  it("reports unreliable with empty ids when the working tree has no PRD tree", () => {
    mockTreeDiffOutput({
      sources: { from: { label: "main", present: true }, to: { present: false } },
      completed: [],
    });

    const result = diffCompletedViaRex("/proj", undefined);

    expect(result).toEqual({ baseBranch: "main", ids: new Set(), reliable: false });
  });

  it("returns null when the JSON has no completed array", () => {
    mockTreeDiffOutput({ sources: { from: { label: "main", present: true }, to: { present: true } } });

    expect(diffCompletedViaRex("/proj", undefined)).toBeNull();
  });

  it("returns null when the spawn throws", () => {
    mockedExecFileSyncCli.mockImplementation(() => {
      throw new Error("rex: command not found");
    });

    expect(diffCompletedViaRex("/proj", undefined)).toBeNull();
  });
});
