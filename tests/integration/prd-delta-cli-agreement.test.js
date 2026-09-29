/**
 * The dashboard's PRD delta and `rex tree-diff` must answer the same question
 * the same way.
 *
 * Both sides describe "how does this worktree's PRD differ from the anchor's".
 * The dashboard reaches that answer through `computePrdDelta`, the CLI through
 * `rex tree-diff` — and since 0.8.0 both are projections of rex's one
 * `diffTrees`. This test is what keeps that true. If someone re-implements
 * either side, or widens one's compared-field list without the other, the two
 * start disagreeing about the same pair of trees, which is a defect nobody
 * would think to look for: each side looks correct on its own, and they are
 * never seen side by side outside a test like this one.
 *
 * Runs against the built dist/ artifacts and a real folder tree on disk, so it
 * exercises the same parser, the same serializer and the same CLI a user gets.
 *
 * @see packages/web/src/server/prd-delta.ts
 * @see packages/rex/src/cli/commands/tree-diff.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REX_CLI = join(import.meta.dirname, "../../packages/rex/dist/cli/index.js");

/** One PRD document, written to `<dir>/.rex/prd_tree/` by rex's own serializer. */
async function writeTree(serializeFolderTree, dir, items) {
  const treeRoot = join(dir, ".rex", "prd_tree");
  await mkdir(treeRoot, { recursive: true });
  await serializeFolderTree(items, treeRoot);
}

function item(id, title, status, extra = {}) {
  return { id, title, level: "task", status, ...extra };
}

/**
 * The fixture both sides are asked about.
 *
 * Deliberately exercises every category at once, including the overlaps that
 * make the two projections non-trivial: `shared-completed` is completed on one
 * side only, `only-here` is both added *and* completed, and `renamed` changes a
 * compared field without changing status.
 */
const ANCHOR_ITEMS = [
  {
    id: "epic-1",
    title: "Epic One",
    level: "epic",
    status: "in_progress",
    children: [
      item("shared-pending", "Shared pending", "pending"),
      item("shared-completed", "Shared completed", "pending"),
      item("renamed", "Old title", "pending"),
      item("only-anchor", "Only on the anchor", "pending"),
    ],
  },
];

const WORKSPACE_ITEMS = [
  {
    id: "epic-1",
    title: "Epic One",
    level: "epic",
    status: "in_progress",
    children: [
      item("shared-pending", "Shared pending", "pending"),
      item("shared-completed", "Shared completed", "completed"),
      item("renamed", "New title", "pending"),
      item("only-here", "Added and finished here", "completed"),
    ],
  },
];

describe("PRD delta and rex tree-diff agree", () => {
  let root;
  let anchorDir;
  let workspaceDir;
  let cliDiff;
  let delta;

  beforeAll(async () => {
    const { serializeFolderTree, parseFolderTree } = await import("../../packages/rex/dist/public.js");
    const { computePrdDelta } = await import("../../packages/web/dist/server/prd-delta.js");

    root = await mkdtemp(join(tmpdir(), "ndx-delta-agreement-"));
    anchorDir = join(root, "anchor");
    workspaceDir = join(root, "workspace");

    await writeTree(serializeFolderTree, anchorDir, ANCHOR_ITEMS);
    await writeTree(serializeFolderTree, workspaceDir, WORKSPACE_ITEMS);

    // The CLI's answer: --against compares two checkouts on disk, which is the
    // same pair of trees the dashboard holds for two worktrees.
    const stdout = execFileSync(
      process.execPath,
      [REX_CLI, "tree-diff", "--json", `--against=${anchorDir}`, workspaceDir],
      { encoding: "utf-8" },
    );
    cliDiff = JSON.parse(stdout);

    // The dashboard's answer, from the same two trees through the same parser.
    const [anchorParsed, workspaceParsed] = await Promise.all([
      parseFolderTree(join(anchorDir, ".rex", "prd_tree")),
      parseFolderTree(join(workspaceDir, ".rex", "prd_tree")),
    ]);
    delta = computePrdDelta(
      { schema: "rex/v1", title: "Fixture", items: anchorParsed.items },
      { schema: "rex/v1", title: "Fixture", items: workspaceParsed.items },
      { anchor: "anchor", workspace: "workspace" },
    );
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  const ids = (entries) => entries.map((e) => e.id).sort();

  it("produces a non-trivial diff, so agreement is worth something", () => {
    // An all-empty diff would let both sides agree by doing nothing.
    expect(delta.identical).toBe(false);
    expect(cliDiff.identical).toBe(false);
  });

  it("agrees on what only this workspace has", () => {
    expect(delta.onlyHere.sort()).toEqual(ids(cliDiff.added));
    expect(delta.onlyHere.sort()).toEqual(["only-here"]);
  });

  it("agrees on what only the anchor has", () => {
    expect(delta.onlyAnchor.sort()).toEqual(ids(cliDiff.removed));
    expect(delta.onlyAnchor.sort()).toEqual(["only-anchor"]);
  });

  it("agrees on what this workspace completed", () => {
    expect(delta.completedHere.sort()).toEqual(ids(cliDiff.completed));
    // Both the newly added item and the one finished here, per the overlap rule.
    expect(delta.completedHere.sort()).toEqual(["only-here", "shared-completed"]);
  });

  it("agrees on what changed", () => {
    expect(delta.changed.sort()).toEqual(ids(cliDiff.changed));
    expect(delta.changed).toContain("renamed");
  });

  it("agrees on the size of each tree", () => {
    expect(delta.totals.anchor).toBe(cliDiff.sources.from.items);
    expect(delta.totals.workspace).toBe(cliDiff.sources.to.items);
  });
});
