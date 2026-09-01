/**
 * Slugs are title-only; merge safety moves from the path into validation.
 *
 * Every slug used to carry a `-<shortId>` suffix. The stated reason
 * (folder-tree-serializer.ts) was real: two same-titled items created on
 * divergent branches land on identical paths, and a git merge silently unifies
 * two distinct items. But paying for that with a hex string in every path
 * forever is the wrong trade — the paths are read by people far more often
 * than branches diverge, and the hazard is detectable after the fact.
 *
 * A collision-only suffix would not have worked: each branch sees no local
 * collision, so neither would add one. The guard has to run on the merged
 * result, which is what the raw-tree duplicate-id scan does.
 *
 * @see packages/rex/src/store/folder-tree-serializer.ts — slugify
 * @see packages/rex/src/core/post-merge-validate.ts — duplicate-id scan
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { slugify, MAX_SLUG_LENGTH } from "../../src/store/folder-tree-serializer.js";
import { serializeFolderTree } from "../../src/store/folder-tree-serializer.js";
import { detectPostMergeIssues } from "../../src/core/post-merge-validate.js";
import type { PRDItem } from "../../src/schema/index.js";

let dir: string;
let treeRoot: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rex-title-slug-"));
  treeRoot = join(dir, "prd_tree");
  await mkdir(treeRoot, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ── Criterion 1: title-only slugs ────────────────────────────────────

describe("slugify", () => {
  it("carries no id-derived component", () => {
    const slug = slugify("Child Process Cleanup And Exit Hygiene", "epic-abc123def456");

    expect(slug).toBe("child-process-cleanup-and-exit-hygiene");
    // The old rule produced "...-epicab". Nothing from the id may survive.
    expect(slug).not.toMatch(/epicab|abc123/);
  });

  it("is identical for two items differing only by id", () => {
    // This is precisely what makes the merge hazard possible, and precisely
    // what the readable-path goal requires. Stated as a test so the trade-off
    // is explicit rather than discovered.
    expect(slugify("Same Title", "id-one")).toBe(slugify("Same Title", "id-two"));
  });

  it("still bounds length, truncating at a word boundary", () => {
    const slug = slugify(
      "An extremely long item title that keeps going well past any sensible path component length",
      "task-123456",
    );

    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug).not.toMatch(/-$/); // no dangling separator from a mid-word cut
    expect(slug.startsWith("an-extremely-long-item-title")).toBe(true);
  });

  it("never returns an empty slug", () => {
    expect(slugify("", "task-abc").length).toBeGreaterThan(0);
    expect(slugify("!!!", "task-abc").length).toBeGreaterThan(0);
  });
});

describe("serializeFolderTree with title-only slugs", () => {
  it("writes readable paths at every depth", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1", title: "Testing And Documentation", level: "epic", status: "pending",
        children: [
          {
            id: "feat-1", title: "Skills Reference", level: "feature", status: "pending",
            children: [{ id: "task-1", title: "Add skills used in this guide", level: "task", status: "pending" }],
          },
        ],
      },
    ];

    await serializeFolderTree(items, treeRoot, { allowBulkDelete: true });

    const epics = (await readdir(treeRoot)).filter((e) => e !== "tree-meta.json");
    expect(epics).toEqual(["testing-and-documentation"]);
    const feats = (await readdir(join(treeRoot, "testing-and-documentation"))).filter((e) => e !== "index.md");
    expect(feats).toEqual(["skills-reference"]);
    expect(
      (await readdir(join(treeRoot, "testing-and-documentation", "skills-reference")))
        .filter((e) => e !== "index.md"),
    ).toEqual(["add-skills-used-in-this-guide.md"]);
  });
});

// ── Criteria 2 & 3: the divergent-branch merge case ──────────────────

describe("duplicate-id detection catches the divergent-branch merge", () => {
  /**
   * Simulate the hazard the id suffix used to prevent. Two branches each add a
   * differently-identified item with the same title under the same parent.
   * With title-only slugs both want the same path, so a git merge leaves one
   * path — or, if the merge preserves both files under different names, two
   * paths claiming different ids for the same slot. The case that must not pass
   * silently is one id appearing at two paths.
   */
  it("reports one id living at two paths", async () => {
    const epicDir = join(treeRoot, "authentication");
    await mkdir(epicDir, { recursive: true });
    await writeFile(join(epicDir, "index.md"), '---\nid: "epic-auth"\nlevel: "epic"\ntitle: "Authentication"\nstatus: "pending"\n---\n');

    // The same item id landing at two paths — what a bad merge leaves behind.
    // Declared at feature level because a `.md` directly under an epic sits at
    // feature depth; using "task" here would add level-mismatch noise that has
    // nothing to do with what this case is about.
    const frontmatter = '---\nid: "feat-dup"\nlevel: "feature"\ntitle: "Token refresh"\nstatus: "pending"\n---\n';
    await writeFile(join(epicDir, "token-refresh.md"), frontmatter);
    await writeFile(join(epicDir, "token-refresh-copy.md"), frontmatter);

    const { issues } = await detectPostMergeIssues(treeRoot);
    const dupes = issues.filter((i) => i.class === "duplicate-id");

    expect(dupes.length, "a duplicated item id was not reported").toBeGreaterThan(0);
    expect(dupes.some((i) => i.itemId === "feat-dup")).toBe(true);
    // The message has to name both paths — "there is a duplicate somewhere" is
    // not actionable when the tree has 1300 files.
    expect(dupes[0].message).toContain("token-refresh.md");
    expect(dupes[0].message).toContain("token-refresh-copy.md");
    // And nothing unrelated should fire on this fixture.
    expect(issues.filter((i) => i.class !== "duplicate-id")).toEqual([]);
  });

  it("is quiet on a clean tree", async () => {
    await serializeFolderTree(
      [
        { id: "epic-1", title: "Alpha", level: "epic", status: "pending",
          children: [{ id: "task-1", title: "Do a thing", level: "task", status: "pending" }] },
      ],
      treeRoot,
      { allowBulkDelete: true },
    );

    const { issues } = await detectPostMergeIssues(treeRoot);
    expect(issues.filter((i) => i.class === "duplicate-id")).toEqual([]);
  });
});

// ── Criterion 4: the length cap decision ─────────────────────────────

describe("MAX_SLUG_LENGTH", () => {
  it("is documented and kept at a Windows-path-safe value", () => {
    // The cap survives the suffix removal for path-length reasons, not for
    // aesthetics — see the constant's comment. Dropping the suffix gave the
    // title body ~7 more characters within the same cap, which is the
    // readability win; raising the cap further would risk MAX_PATH on Windows
    // at four levels of nesting.
    expect(MAX_SLUG_LENGTH).toBe(40);
  });

  it("bounds the tree's own contribution to a fully nested path", () => {
    // Only the part rex controls: `.rex/prd_tree` + three directory levels +
    // a leaf `.md`. The repository prefix is the caller's budget, so the claim
    // is that rex leaves most of Windows' 260-character ceiling for it —
    // ~180 here, which covers this repo's 40-character prefix several times
    // over. Raising the cap eats directly into that headroom.
    const treeContribution =
      "/.rex/prd_tree".length + 3 * (MAX_SLUG_LENGTH + 1) + MAX_SLUG_LENGTH + ".md".length;

    expect(treeContribution).toBeLessThan(200);
    expect(260 - treeContribution).toBeGreaterThan(60); // headroom for the repo path
  });
});

// ── Local collision safety ───────────────────────────────────────────

describe("resolveSiblingSlugs with title-only slugs", () => {
  it("gives colliding siblings distinct paths instead of clobbering", async () => {
    // Without a fallback both of these want `auth-feature` and the second
    // write destroys the first. Dropping the id suffix makes this reachable,
    // so the fallback is load-bearing rather than defensive.
    const items: PRDItem[] = [
      { id: "aaaaaaaa-0000-0000-0000-000000000000", title: "Auth Feature", level: "feature", status: "pending",
        children: [{ id: "t1", title: "One", level: "task", status: "pending" }] },
      { id: "bbbbbbbb-0000-0000-0000-000000000000", title: "Auth Feature!", level: "feature", status: "pending",
        children: [{ id: "t2", title: "Two", level: "task", status: "pending" }] },
    ];

    await serializeFolderTree(items, treeRoot, { allowBulkDelete: true });

    const dirs = (await readdir(treeRoot)).filter((e) => e !== "tree-meta.json").sort();
    expect(dirs).toHaveLength(2);
    expect(new Set(dirs).size, "the two siblings shared a path").toBe(2);
    // Both children survived — the clobber would have lost one.
    for (const d of dirs) {
      const inner = (await readdir(join(treeRoot, d))).filter((e) => e !== "index.md");
      expect(inner).toHaveLength(1);
    }
  });

  it("leaves non-colliding siblings unsuffixed", async () => {
    const items: PRDItem[] = [
      { id: "aaaaaaaa-0000-0000-0000-000000000000", title: "Alpha", level: "epic", status: "pending" },
      { id: "bbbbbbbb-0000-0000-0000-000000000000", title: "Beta", level: "epic", status: "pending" },
    ];

    await serializeFolderTree(items, treeRoot, { allowBulkDelete: true });

    const entries = (await readdir(treeRoot)).filter((e) => e !== "tree-meta.json").sort();
    expect(entries).toEqual(["alpha.md", "beta.md"]);
  });
});
