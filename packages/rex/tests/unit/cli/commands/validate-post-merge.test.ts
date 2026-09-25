/**
 * `rex validate --post-merge` — structural check for a freshly merged PRD tree.
 *
 * A git merge of `.rex/prd_tree/` can leave corruption no ordinary code path
 * produces: duplicate IDs (both branches added the same item at different
 * paths), orphaned directories, level/nesting mismatches, dangling blockedBy
 * references, and unresolved conflict markers. One fixture per class below;
 * `--repair` fixes the deterministic classes and refuses the ambiguous ones.
 *
 * @see packages/rex/src/core/post-merge-validate.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectPostMergeIssues,
  repairPostMergeIssues,
} from "../../../../src/core/post-merge-validate.js";
import { cmdValidate } from "../../../../src/cli/commands/validate.js";

function md(fields: Record<string, unknown>, body = ""): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const v of value) lines.push(`  - ${JSON.stringify(v)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---", "");
  if (body) lines.push(body);
  return lines.join("\n");
}

/**
 * The `## Children` table a conformant folder item carries. Fixtures that put a
 * child file next to an `index.md` need it: without it the item's table
 * disagrees with its own directory, which is the `children-table-out-of-sync`
 * class, and the fixture would be modelling a second defect by accident.
 */
function childrenTable(rows: Array<[title: string, link: string, status: string]>): string {
  return [
    "## Children",
    "",
    "| Title | Status |",
    "|-------|--------|",
    ...rows.map(([title, link, status]) => `| [${title}](${link}) | ${status} |`),
    "",
  ].join("\n");
}

describe("post-merge corruption detection and repair", () => {
  let dir: string;
  let treeRoot: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "post-merge-"));
    treeRoot = join(dir, ".rex", "prd_tree");
    await mkdir(treeRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("passes silently on a healthy tree", async () => {
    await mkdir(join(treeRoot, "epic-aaaaaa"));
    await writeFile(
      join(treeRoot, "epic-aaaaaa", "index.md"),
      md(
        { id: "a", level: "epic", title: "Epic", status: "pending" },
        childrenTable([["Feat", "./feat-bbbbbb.md", "pending"]]),
      ),
    );
    await writeFile(join(treeRoot, "epic-aaaaaa", "feat-bbbbbb.md"), md({ id: "b", level: "feature", title: "Feat", status: "pending" }));

    const report = await detectPostMergeIssues(treeRoot);
    expect(report.issues).toEqual([]);
  });

  it("detects duplicate IDs across paths and refuses to repair them", async () => {
    await writeFile(join(treeRoot, "one-aaaaaa.md"), md({ id: "dup-1", level: "epic", title: "One", status: "pending" }));
    await writeFile(join(treeRoot, "two-bbbbbb.md"), md({ id: "dup-1", level: "epic", title: "Two", status: "pending" }));

    const report = await detectPostMergeIssues(treeRoot);
    const dupes = report.issues.filter((i) => i.class === "duplicate-id");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].repairable).toBe(false);
    expect(dupes[0].message).toContain("one-aaaaaa.md");
    expect(dupes[0].message).toContain("two-bbbbbb.md");

    const { repaired, refused } = await repairPostMergeIssues(treeRoot, report.issues);
    expect(repaired).toHaveLength(0);
    expect(refused).toHaveLength(1);
    // Both files untouched.
    await access(join(treeRoot, "one-aaaaaa.md"));
    await access(join(treeRoot, "two-bbbbbb.md"));
  });

  it("detects an empty orphaned directory (no index.md) and repairs it by removal", async () => {
    await mkdir(join(treeRoot, "husk-dir"));

    const report = await detectPostMergeIssues(treeRoot);
    const orphans = report.issues.filter((i) => i.class === "orphaned-directory");
    expect(orphans).toHaveLength(1);
    expect(orphans[0].repairable).toBe(true);

    const { repaired } = await repairPostMergeIssues(treeRoot, report.issues);
    expect(repaired).toHaveLength(1);
    await expect(access(join(treeRoot, "husk-dir"))).rejects.toThrow();
  });

  it("refuses to repair an orphaned directory that still contains items", async () => {
    await mkdir(join(treeRoot, "headless-dir"));
    await writeFile(join(treeRoot, "headless-dir", "child-cccccc.md"), md({ id: "c", level: "feature", title: "Child", status: "pending" }));

    const report = await detectPostMergeIssues(treeRoot);
    const orphans = report.issues.filter((i) => i.class === "orphaned-directory");
    expect(orphans).toHaveLength(1);
    expect(orphans[0].repairable).toBe(false);

    const { refused } = await repairPostMergeIssues(treeRoot, report.issues);
    expect(refused.some((i) => i.class === "orphaned-directory")).toBe(true);
    await access(join(treeRoot, "headless-dir", "child-cccccc.md")); // untouched
  });

  it("detects a level/nesting mismatch and repairs it to the depth-implied level", async () => {
    await mkdir(join(treeRoot, "epic-aaaaaa"));
    await writeFile(
      join(treeRoot, "epic-aaaaaa", "index.md"),
      md(
        { id: "a", level: "epic", title: "Epic", status: "pending" },
        childrenTable([["Impostor", "./impostor-dddddd.md", "pending"]]),
      ),
    );
    // A file at feature depth claiming to be an epic.
    await writeFile(join(treeRoot, "epic-aaaaaa", "impostor-dddddd.md"), md({ id: "d", level: "epic", title: "Impostor", status: "pending" }));

    const report = await detectPostMergeIssues(treeRoot);
    const mismatches = report.issues.filter((i) => i.class === "level-mismatch");
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repairable).toBe(true);

    await repairPostMergeIssues(treeRoot, report.issues);
    const repairedContent = await readFile(join(treeRoot, "epic-aaaaaa", "impostor-dddddd.md"), "utf-8");
    expect(repairedContent).toContain('level: "feature"');
    // Everything else survives untouched.
    expect(repairedContent).toContain('title: "Impostor"');

    const after = await detectPostMergeIssues(treeRoot);
    expect(after.issues).toEqual([]);
  });

  it("detects dangling blockedBy references and repairs by dropping only the dangling ids", async () => {
    await writeFile(
      join(treeRoot, "epic-aaaaaa.md"),
      md({ id: "a", level: "epic", title: "A", status: "pending", blockedBy: ["b", "ghost-1", "ghost-2"] }),
    );
    await writeFile(join(treeRoot, "epic-bbbbbb.md"), md({ id: "b", level: "epic", title: "B", status: "pending" }));

    const report = await detectPostMergeIssues(treeRoot);
    const dangling = report.issues.filter((i) => i.class === "dangling-blocked-by");
    expect(dangling).toHaveLength(1);
    expect(dangling[0].repairable).toBe(true);
    expect(dangling[0].message).toContain("ghost-1");

    await repairPostMergeIssues(treeRoot, report.issues);
    const repairedContent = await readFile(join(treeRoot, "epic-aaaaaa.md"), "utf-8");
    expect(repairedContent).toContain('- "b"'); // valid reference kept
    expect(repairedContent).not.toContain("ghost-1");
    expect(repairedContent).not.toContain("ghost-2");
  });

  it("removes the blockedBy field entirely when every reference is dangling", async () => {
    await writeFile(
      join(treeRoot, "epic-aaaaaa.md"),
      md({ id: "a", level: "epic", title: "A", status: "pending", blockedBy: ["ghost"] }),
    );

    const report = await detectPostMergeIssues(treeRoot);
    await repairPostMergeIssues(treeRoot, report.issues);
    const repairedContent = await readFile(join(treeRoot, "epic-aaaaaa.md"), "utf-8");
    expect(repairedContent).not.toContain("blockedBy");
    expect((await detectPostMergeIssues(treeRoot)).issues).toEqual([]);
  });

  // The Children table is informational — the parser walks the directory and
  // never reads it — so drift here loses nothing. It is reported because it
  // reached main unnoticed and was repaired by hand twice, and repairable so
  // the CI gate stays advisory. See the integration fixture that settled it:
  // tests/integration/children-table-omission.test.ts.
  describe("children-table-out-of-sync", () => {
    it("detects a child omitted from the table and repairs it by rewriting the table", async () => {
      await mkdir(join(treeRoot, "epic-aaaaaa"));
      await writeFile(
        join(treeRoot, "epic-aaaaaa", "index.md"),
        md(
          { id: "a", level: "epic", title: "Epic", status: "pending" },
          childrenTable([["Listed", "./listed-bbbbbb.md", "pending"]]),
        ),
      );
      await writeFile(join(treeRoot, "epic-aaaaaa", "listed-bbbbbb.md"), md({ id: "b", level: "feature", title: "Listed", status: "pending" }));
      await writeFile(join(treeRoot, "epic-aaaaaa", "omitted-cccccc.md"), md({ id: "c", level: "feature", title: "Omitted", status: "in_progress" }));

      const report = await detectPostMergeIssues(treeRoot);
      const drift = report.issues.filter((i) => i.class === "children-table-out-of-sync");
      expect(drift).toHaveLength(1);
      expect(drift[0].repairable).toBe(true);
      expect(drift[0].detail).toEqual(["omitted-cccccc.md"]);

      const { repaired } = await repairPostMergeIssues(treeRoot, report.issues);
      expect(repaired).toHaveLength(1);

      const rewritten = await readFile(join(treeRoot, "epic-aaaaaa", "index.md"), "utf-8");
      expect(rewritten).toContain("| [Listed](./listed-bbbbbb.md) | pending |");
      // The row carries the child's real status, not a placeholder.
      expect(rewritten).toContain("| [Omitted](./omitted-cccccc.md) | in_progress |");
      expect(await detectPostMergeIssues(treeRoot)).toMatchObject({ issues: [] });
    });

    it("detects a row pointing at a file that is gone, and drops it", async () => {
      await mkdir(join(treeRoot, "epic-aaaaaa"));
      await writeFile(
        join(treeRoot, "epic-aaaaaa", "index.md"),
        md(
          { id: "a", level: "epic", title: "Epic", status: "pending" },
          childrenTable([
            ["Here", "./here-bbbbbb.md", "pending"],
            ["Gone", "./gone-cccccc.md", "pending"],
          ]),
        ),
      );
      await writeFile(join(treeRoot, "epic-aaaaaa", "here-bbbbbb.md"), md({ id: "b", level: "feature", title: "Here", status: "pending" }));

      const report = await detectPostMergeIssues(treeRoot);
      const drift = report.issues.filter((i) => i.class === "children-table-out-of-sync");
      expect(drift).toHaveLength(1);
      expect(drift[0].message).toContain("gone-cccccc.md");
      // Nothing is missing — only the stale row — so there is no repair payload.
      expect(drift[0].detail).toEqual([]);

      await repairPostMergeIssues(treeRoot, report.issues);
      const rewritten = await readFile(join(treeRoot, "epic-aaaaaa", "index.md"), "utf-8");
      expect(rewritten).not.toContain("gone-cccccc.md");
      expect(rewritten).toContain("here-bbbbbb.md");
    });

    it("drops the section entirely when the item has no children left", async () => {
      await mkdir(join(treeRoot, "epic-aaaaaa"));
      await writeFile(
        join(treeRoot, "epic-aaaaaa", "index.md"),
        md(
          { id: "a", level: "epic", title: "Epic", status: "pending" },
          childrenTable([["Gone", "./gone-cccccc.md", "pending"]]),
        ),
      );

      await repairPostMergeIssues(treeRoot, (await detectPostMergeIssues(treeRoot)).issues);
      const rewritten = await readFile(join(treeRoot, "epic-aaaaaa", "index.md"), "utf-8");
      expect(rewritten).not.toContain("## Children");
      expect(rewritten).toContain('title: "Epic"');
    });

    it("repairs the table without touching body content that follows it", async () => {
      // The block is bounded by the table, not by the next `##` heading. An
      // `h3` or trailing prose is introduced by neither, so a heading-bounded
      // block swallowed it and --repair deleted it — silently, on the very
      // command the CI gate's advisory line tells operators to run.
      await mkdir(join(treeRoot, "epic-aaaaaa"));
      await writeFile(
        join(treeRoot, "epic-aaaaaa", "index.md"),
        md({ id: "a", level: "epic", title: "Epic", status: "pending" }, childrenTable([["Listed", "./listed-bbbbbb.md", "pending"]])) +
          "\n### Operator notes\n\nDo not delete this.\n\n## Later section\n\nnor this\n",
      );
      await writeFile(join(treeRoot, "epic-aaaaaa", "listed-bbbbbb.md"), md({ id: "b", level: "feature", title: "Listed", status: "pending" }));
      await writeFile(join(treeRoot, "epic-aaaaaa", "omitted-cccccc.md"), md({ id: "c", level: "feature", title: "Omitted", status: "pending" }));

      await repairPostMergeIssues(treeRoot, (await detectPostMergeIssues(treeRoot)).issues);

      const rewritten = await readFile(join(treeRoot, "epic-aaaaaa", "index.md"), "utf-8");
      expect(rewritten).toContain("| [Omitted](./omitted-cccccc.md) | pending |");
      expect(rewritten).toContain("### Operator notes");
      expect(rewritten).toContain("Do not delete this.");
      expect(rewritten).toContain("## Later section");
      expect(rewritten).toContain("nor this");
      // The heading survives exactly once — the block was replaced, not appended to.
      expect(rewritten.match(/^## Children$/gm)).toHaveLength(1);
      expect((await detectPostMergeIssues(treeRoot)).issues).toEqual([]);
    });

    it("appends a table to an item that has none, keeping its body", async () => {
      await mkdir(join(treeRoot, "epic-aaaaaa"));
      await writeFile(
        join(treeRoot, "epic-aaaaaa", "index.md"),
        md({ id: "a", level: "epic", title: "Epic", status: "pending" }, "Some requirements prose.\n"),
      );
      await writeFile(join(treeRoot, "epic-aaaaaa", "kid-bbbbbb.md"), md({ id: "b", level: "feature", title: "Kid", status: "pending" }));

      await repairPostMergeIssues(treeRoot, (await detectPostMergeIssues(treeRoot)).issues);

      const rewritten = await readFile(join(treeRoot, "epic-aaaaaa", "index.md"), "utf-8");
      expect(rewritten).toContain("Some requirements prose.");
      expect(rewritten).toContain("| [Kid](./kid-bbbbbb.md) | pending |");
      expect((await detectPostMergeIssues(treeRoot)).issues).toEqual([]);
    });

    it("reads a row whose title contains square brackets", async () => {
      // The serializer writes `[${title}](${link})` unescaped, so a title like
      // this one — taken from this repo's own tree — puts `[Tool]` and
      // `[Agent]` inside the link label. A label-anchored link pattern misses
      // the row entirely and reports the child as unlisted.
      const title = "Color-code [Tool], [Agent], and vendor prefix labels";
      await mkdir(join(treeRoot, "epic-aaaaaa"));
      await writeFile(
        join(treeRoot, "epic-aaaaaa", "index.md"),
        md({ id: "a", level: "epic", title: "Epic", status: "pending" }, childrenTable([[title, "./bracketed-bbbbbb.md", "completed"]])),
      );
      await writeFile(join(treeRoot, "epic-aaaaaa", "bracketed-bbbbbb.md"), md({ id: "b", level: "feature", title, status: "completed" }));

      expect((await detectPostMergeIssues(treeRoot)).issues).toEqual([]);
    });

    it("ignores the tree-root banner index.md, which is not an item", async () => {
      // `rex init` writes this; it has no frontmatter, so every epic in the
      // tree would otherwise read as an unlisted child of it.
      await writeFile(join(treeRoot, "index.md"), "# project\n\nPRD folder tree.\n");
      await writeFile(join(treeRoot, "epic-aaaaaa.md"), md({ id: "a", level: "epic", title: "Epic", status: "pending" }));

      const report = await detectPostMergeIssues(treeRoot);
      expect(report.issues).toEqual([]);
    });

    it("says nothing about an item whose table matches a mixed set of leaf and folder children", async () => {
      await mkdir(join(treeRoot, "epic-aaaaaa", "branch-dddddd"), { recursive: true });
      await writeFile(
        join(treeRoot, "epic-aaaaaa", "index.md"),
        md(
          { id: "a", level: "epic", title: "Epic", status: "pending" },
          // Folder children first, then leaves — the order the parser builds
          // `children` and the serializer writes them back.
          childrenTable([
            ["Branch", "./branch-dddddd/index.md", "pending"],
            ["Leaf", "./leaf-bbbbbb.md", "pending"],
          ]),
        ),
      );
      await writeFile(join(treeRoot, "epic-aaaaaa", "leaf-bbbbbb.md"), md({ id: "b", level: "feature", title: "Leaf", status: "pending" }));
      await writeFile(
        join(treeRoot, "epic-aaaaaa", "branch-dddddd", "index.md"),
        md({ id: "d", level: "feature", title: "Branch", status: "pending" }, childrenTable([["Kid", "./kid-eeeeee.md", "pending"]])),
      );
      await writeFile(join(treeRoot, "epic-aaaaaa", "branch-dddddd", "kid-eeeeee.md"), md({ id: "e", level: "task", title: "Kid", status: "pending" }));

      expect((await detectPostMergeIssues(treeRoot)).issues).toEqual([]);
    });
  });

  it("detects unresolved conflict markers and refuses to repair them", async () => {
    await writeFile(
      join(treeRoot, "epic-aaaaaa.md"),
      ["---", 'id: "a"', "<<<<<<< ours", 'status: "completed"', "=======", 'status: "failing"', ">>>>>>> theirs", "---", ""].join("\n"),
    );

    const report = await detectPostMergeIssues(treeRoot);
    const markers = report.issues.filter((i) => i.class === "conflict-markers");
    expect(markers).toHaveLength(1);
    expect(markers[0].repairable).toBe(false);

    const { refused } = await repairPostMergeIssues(treeRoot, report.issues);
    expect(refused.some((i) => i.class === "conflict-markers")).toBe(true);
  });
});

describe("rex validate --post-merge CLI", () => {
  let dir: string;
  let treeRoot: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "post-merge-cli-"));
    treeRoot = join(dir, ".rex", "prd_tree");
    await mkdir(treeRoot, { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("exits 0 on a healthy tree (hook-friendly)", async () => {
    await writeFile(join(treeRoot, "epic-aaaaaa.md"), md({ id: "a", level: "epic", title: "A", status: "pending" }));
    await cmdValidate(dir, { "post-merge": "true" });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits 0 when there is no PRD tree at all — hooks in non-PRD repos are no-ops", async () => {
    await rm(treeRoot, { recursive: true, force: true });
    await cmdValidate(dir, { "post-merge": "true" });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits 1 when corruption is found", async () => {
    await writeFile(join(treeRoot, "one-aaaaaa.md"), md({ id: "dup", level: "epic", title: "One", status: "pending" }));
    await writeFile(join(treeRoot, "two-bbbbbb.md"), md({ id: "dup", level: "epic", title: "Two", status: "pending" }));

    await expect(cmdValidate(dir, { "post-merge": "true" })).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("with --repair, exits 0 once the safe classes are fixed", async () => {
    await mkdir(join(treeRoot, "husk-dir")); // repairable
    await writeFile(
      join(treeRoot, "epic-aaaaaa.md"),
      md({ id: "a", level: "epic", title: "A", status: "pending", blockedBy: ["ghost"] }), // repairable
    );

    await cmdValidate(dir, { "post-merge": "true", repair: "true" });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("with --repair, still exits 1 when ambiguous corruption remains", async () => {
    await writeFile(join(treeRoot, "one-aaaaaa.md"), md({ id: "dup", level: "epic", title: "One", status: "pending" }));
    await writeFile(join(treeRoot, "two-bbbbbb.md"), md({ id: "dup", level: "epic", title: "Two", status: "pending" }));

    await expect(cmdValidate(dir, { "post-merge": "true", repair: "true" })).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
