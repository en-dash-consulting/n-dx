/**
 * A run must refuse to start against a PRD tree this build would re-slug.
 *
 * An autonomous run is a PRD writer — it records the status transition when it
 * finishes the task — so a run started with a build whose slug rule disagrees
 * with the tree does not fail. It *succeeds*, and carries a whole-tree rewrite
 * into whatever branch is open under a "task completed" message. That is the
 * 2026-09-17 incident (1,570 renamed files reaching main) with the agent as the
 * sweeper rather than a stray MCP server.
 *
 * The store's write guard already refuses such a write, but it only fires once
 * the run has claimed the task, spent its tokens and edited the code. This gate
 * asks the same question before any of that, and answers it by not starting.
 *
 * What is pinned here:
 *  - a conformant tree passes, so the gate is not simply always-on
 *  - one re-suffixed path stops the run, naming the count and `rex migrate-slugs`
 *  - a foreign slug-rule marker stops it too, even with conformant paths
 *  - the refusal takes no claim and writes nothing — the tree is byte-identical
 *  - `--dry-run` refuses as well; a preview that hid this would report that the
 *    real run was going to be fine
 *
 * @see packages/hench/src/cli/commands/run.ts — assertPrdTreeConformant
 * @see packages/rex/src/store/slug-rule-guard.ts — checkTreeConformance
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readdir, rename, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { assertPrdTreeConformant, cmdRun } from "../../src/cli/commands/run.js";
import { resolveStore, PRD_TREE_DIRNAME, TREE_META_FILENAME } from "../../src/prd/rex-gateway.js";
import { setupProjectDir, cleanupProjectDir, initGitFixtureRepo } from "../helpers/index.js";

const DOC = {
  schema: "rex/v1",
  title: "Conformance Gate",
  items: [
    {
      id: "epic-abc123",
      title: "Child Process Cleanup And Exit Hygiene",
      level: "epic" as const,
      status: "pending" as const,
      children: [
        {
          id: "task-def456",
          title: "Harden the runner",
          level: "task" as const,
          status: "pending" as const,
        },
      ],
    },
  ],
};

let projectDir: string;
let henchDir: string;
let rexDir: string;
let treeRoot: string;

/**
 * Every file in the tree with its content, for proving a refusal wrote nothing.
 *
 * A guard that threw *after* a partial rewrite would satisfy an assertion on the
 * message and still be the bug the gate exists to prevent, so the tree itself is
 * compared rather than only the error.
 */
async function snapshotTree(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(current: string, rel: string): Promise<void> {
    for (const entry of await readdir(current)) {
      const abs = join(current, entry);
      const key = rel ? `${rel}/${entry}` : entry;
      if ((await stat(abs)).isDirectory()) await walk(abs, key);
      else out.set(key, await readFile(abs, "utf-8"));
    }
  }
  await walk(dir, "");
  return out;
}

/** Rename the epic directory into the superseded id-qualified form. */
async function reSuffixEpicDir(): Promise<string> {
  const entries = (await readdir(treeRoot)).filter((e) => e !== TREE_META_FILENAME);
  const current = entries[0];
  const foreign = "child-process-cleanup-and-exit-epicab";
  await rename(join(treeRoot, current), join(treeRoot, foreign));
  return foreign;
}

beforeEach(async () => {
  ({ projectDir, henchDir, rexDir } = await setupProjectDir("hench-tree-conformance-"));
  treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  await initGitFixtureRepo(projectDir);
  await (await resolveStore(rexDir)).saveDocument(DOC as never);

  // cmdRun prints a vendor/model header before it reaches the gate.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupProjectDir(projectDir);
});

describe("the pre-run PRD tree conformance gate", () => {
  it("passes a tree this build wrote", async () => {
    await expect(assertPrdTreeConformant(rexDir)).resolves.toBeUndefined();
  });

  it("refuses one re-suffixed path, naming the count and rex migrate-slugs", async () => {
    await reSuffixEpicDir();

    await expect(assertPrdTreeConformant(rexDir)).rejects.toThrow(
      /1 path in the PRD tree does not match slug rule/,
    );
    await expect(assertPrdTreeConformant(rexDir)).rejects.toThrow(/rex migrate-slugs/);
  });

  /** Rewrite the marker to `slugRule`, leaving every path conformant. */
  async function markRule(slugRule: number): Promise<void> {
    const metaPath = join(rexDir, TREE_META_FILENAME);
    const meta = JSON.parse(await readFile(metaPath, "utf-8"));
    await writeFile(metaPath, JSON.stringify({ ...meta, slugRule }), "utf-8");
  }

  it("refuses a foreign slug-rule marker even when every path conforms", async () => {
    // A tree written by a rule this build does not implement looks conformant
    // to nothing it can compute, so the marker is the only evidence there is.
    const { slugRule } = JSON.parse(await readFile(join(rexDir, TREE_META_FILENAME), "utf-8"));
    await markRule(slugRule - 1);

    await expect(assertPrdTreeConformant(rexDir)).rejects.toThrow(/rex migrate-slugs/);
  });

  // Direction matters in the advice, not just in the refusal: `migrate-slugs`
  // rewrites the tree under *this* build's rule, so recommending it for a
  // newer tree walks the operator into a downgrade.
  it("tells the operator to upgrade, not to migrate, when the tree is newer", async () => {
    const { slugRule } = JSON.parse(await readFile(join(rexDir, TREE_META_FILENAME), "utf-8"));
    await markRule(slugRule + 1);

    const err = await assertPrdTreeConformant(rexDir).then(
      () => undefined,
      (e: unknown) => e as Error,
    );

    expect(err?.message).toMatch(/Upgrade rex/);
    expect(err?.message).not.toMatch(/Run 'rex migrate-slugs'/);
  });

  it("names the offending path so the operator can see the shape of the rewrite", async () => {
    const foreign = await reSuffixEpicDir();

    await expect(assertPrdTreeConformant(rexDir)).rejects.toThrow(new RegExp(foreign));
  });

  describe("driven through cmdRun", () => {
    /** Where rex keeps cross-worktree claims — absent means none was taken. */
    function claimsDirExists(): boolean {
      return existsSync(join(projectDir, ".git", "ndx"));
    }

    it("stops the run, taking no claim and writing nothing", async () => {
      await reSuffixEpicDir();
      const before = await snapshotTree(treeRoot);

      await expect(cmdRun(projectDir, { auto: "true" })).rejects.toThrow(/rex migrate-slugs/);

      expect(await snapshotTree(treeRoot)).toEqual(before);
      expect(claimsDirExists()).toBe(false);
    });

    it("refuses a --dry-run too", async () => {
      // A preview is the one place an operator looks to find out whether the
      // real run would work. Hiding the refusal here would answer "yes".
      await reSuffixEpicDir();
      const before = await snapshotTree(treeRoot);

      await expect(
        cmdRun(projectDir, { auto: "true", "dry-run": "true" }),
      ).rejects.toThrow(/rex migrate-slugs/);

      expect(await snapshotTree(treeRoot)).toEqual(before);
      expect(claimsDirExists()).toBe(false);
    });
  });
});
