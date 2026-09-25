/**
 * Does a child missing from its parent's `## Children` table survive?
 *
 * `testing-documentation/make-test-results-independent-of` reached main with
 * its `index.md` present but four children absent from its Children table
 * (#391 wrote the files without listing them). PRs #394 and #395 each repaired
 * it by hand, and the 0.7.1 execution plan recorded the shape as destructive:
 * "invisible to the loader and deleted by the next full-tree save".
 *
 * The parser's contract says the opposite — `folder-tree-parser.ts:13`,
 * "`## Children` table is informational only; directory nesting is
 * authoritative" — which would make the shape cosmetic and self-healing.
 *
 * Only one of those can be true, and the difference decides whether
 * `rex validate --post-merge` must block a merge or merely report drift. This
 * file settles it against the real store: build a conformant tree, delete rows
 * from a feature's Children table, then load and save the full document.
 *
 * Result (asserted below): the children survive. The loader never reads the
 * table, so the omitted items are in the loaded document and the save
 * regenerates the table complete. The execution plan's claim conflated this
 * shape with the genuinely destructive one — a directory whose `index.md` is
 * missing, which the parser cannot see as an item and a full save collects as
 * unreachable. That shape is already `orphaned-directory` in
 * `post-merge-validate.ts`, and it is what commit 47062ab3 restored five files
 * from.
 *
 * @see packages/rex/src/store/folder-tree-parser.ts
 * @see packages/rex/src/core/post-merge-validate.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FolderTreeStore } from "../../src/store/folder-tree-store.js";
import { serializeFolderTree } from "../../src/store/folder-tree-serializer.js";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { detectPostMergeIssues } from "../../src/core/post-merge-validate.js";
import type { PRDItem } from "../../src/schema/index.js";

const FEATURE_INDEX = ["epic-one", "feature-a", "index.md"];
const LISTED_LEAF = ["epic-one", "feature-a", "listed-task.md"];
const UNLISTED_LEAF = ["epic-one", "feature-a", "unlisted-leaf-task.md"];
const UNLISTED_BRANCH_INDEX = ["epic-one", "feature-a", "unlisted-branch-task", "index.md"];

/**
 * A feature with three children: one that will stay listed in the Children
 * table, one leaf `.md` child that will be struck from it, and one child that
 * owns a directory (it has a child of its own) that will also be struck. Both
 * omitted shapes matter — the audit named a directory, the real incident was
 * leaf files.
 */
function fixtureItems(): PRDItem[] {
  return [
    {
      id: "epic-1",
      level: "epic",
      title: "Epic one",
      status: "pending",
      children: [
        {
          id: "feat-a",
          level: "feature",
          title: "Feature A",
          status: "pending",
          children: [
            { id: "task-listed", level: "task", title: "Listed task", status: "pending" },
            { id: "task-unlisted-leaf", level: "task", title: "Unlisted leaf task", status: "pending" },
            {
              id: "task-unlisted-branch",
              level: "task",
              title: "Unlisted branch task",
              status: "pending",
              children: [
                { id: "sub-1", level: "subtask", title: "Sub one", status: "pending" },
              ],
            },
          ],
        },
      ],
    },
  ];
}

describe("a child omitted from its parent's Children table", () => {
  let rexDir: string;
  let treeRoot: string;
  let store: FolderTreeStore;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "children-table-omission-"));
    rexDir = join(dir, ".rex");
    treeRoot = join(rexDir, PRD_TREE_DIRNAME);

    // Build a conformant tree through the serializer rather than by hand, so
    // the slugs match the current slug rule and the write guard stays out of
    // the way. Then corrupt only the table.
    await serializeFolderTree(fixtureItems(), treeRoot, { allowBulkDelete: true });
    await strikeChildrenRows(join(treeRoot, ...FEATURE_INDEX), [
      "Unlisted leaf task",
      "Unlisted branch task",
    ]);

    store = new FolderTreeStore(rexDir);
  });

  afterEach(async () => {
    await rm(join(rexDir, ".."), { recursive: true, force: true });
  });

  it("is still loaded — the parser walks the filesystem, not the table", async () => {
    const doc = await store.loadDocument();

    const feature = doc.items[0].children?.[0];
    expect(feature?.id).toBe("feat-a");
    expect(feature?.children?.map((c) => c.id).sort()).toEqual([
      "task-listed",
      "task-unlisted-branch",
      "task-unlisted-leaf",
    ]);
    // The omitted branch child keeps its own subtree.
    const branch = feature?.children?.find((c) => c.id === "task-unlisted-branch");
    expect(branch?.children?.map((c) => c.id)).toEqual(["sub-1"]);
  });

  it("survives a full-tree save, and the save regenerates the table complete", async () => {
    const doc = await store.loadDocument();
    await store.saveDocument({ ...doc, schema: SCHEMA_VERSION });

    // Every file is still on disk — nothing was collected as unreachable.
    for (const parts of [LISTED_LEAF, UNLISTED_LEAF, UNLISTED_BRANCH_INDEX]) {
      await access(join(treeRoot, ...parts));
    }

    // And the table the save rewrote lists all three again.
    const index = await readFile(join(treeRoot, ...FEATURE_INDEX), "utf-8");
    expect(index).toContain("[Listed task](./listed-task.md)");
    expect(index).toContain("[Unlisted leaf task](./unlisted-leaf-task.md)");
    expect(index).toContain("[Unlisted branch task](./unlisted-branch-task/index.md)");

    // A reload agrees: the tree is whole.
    const after = await new FolderTreeStore(rexDir).loadDocument();
    expect(after.items[0].children?.[0].children).toHaveLength(3);
  });

  it("is reported by post-merge validation as repairable drift, not as a blocker", async () => {
    const report = await detectPostMergeIssues(treeRoot);
    const drift = report.issues.filter((i) => i.class === "children-table-out-of-sync");

    expect(drift).toHaveLength(1);
    expect(drift[0].path).toBe(FEATURE_INDEX.join("/"));
    expect(drift[0].itemId).toBe("feat-a");
    expect(drift[0].repairable).toBe(true);
    expect(drift[0].detail?.sort()).toEqual(["unlisted-branch-task/index.md", "unlisted-leaf-task.md"]);
    // The message has to say the items are safe, or an operator reading the
    // #396 CI output will repair by hand for the fourth time.
    expect(drift[0].message).toContain("cosmetic");

    // Nothing else fires: this tree is otherwise healthy.
    expect(report.issues.filter((i) => i.class !== "children-table-out-of-sync")).toEqual([]);
  });
});

/** Delete the named rows from a file's `## Children` table, leaving the rest intact. */
async function strikeChildrenRows(path: string, titles: string[]): Promise<void> {
  const text = await readFile(path, "utf-8");
  const kept = text
    .split("\n")
    .filter((line) => !titles.some((title) => line.startsWith(`| [${title}](`)));
  const next = kept.join("\n");
  if (next === text) throw new Error(`fixture did not strike any row from ${path}`);
  await writeFile(path, next, "utf-8");
}
