/**
 * The slug-rule write guard, exercised through both local stores.
 *
 * The guard's whole promise is that a refused save leaves the tree exactly as
 * it was, so most of these tests assert on a byte-level snapshot of the tree
 * rather than on the thrown message alone: a guard that throws *after*
 * rewriting half the paths would satisfy an error-message assertion and still
 * be the bug this exists to prevent.
 *
 * Both `FileStore` and `FolderTreeStore` serialize the same tree, and
 * `resolveStore` hands CLI callers the former — so a guard on only one of them
 * would leave the ordinary CLI write path unprotected. Every behavioural case
 * here therefore runs against both.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { FolderTreeStore, ensureFolderTreeRexDir } from "../../../src/store/folder-tree-store.js";
import { FileStore } from "../../../src/store/file-adapter.js";
import { SlugRuleMismatchError, readSlugRuleMarker } from "../../../src/store/slug-rule-guard.js";
import { SLUG_RULE_VERSION } from "../../../src/store/folder-tree-serializer.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { syncFolderTree } from "../../../src/cli/commands/folder-tree-sync.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import type { PRDDocument, PRDItem, PRDStore } from "../../../src/store/index.js";

const TREE_META = "tree-meta.json";

function task(id: string, title: string): PRDItem {
  return {
    id,
    title,
    status: "pending",
    level: "task",
    description: "",
    priority: "medium",
  } as PRDItem;
}

const ITEMS: PRDItem[] = [task("aaaaaaaa-1111-4111-8111-111111111111", "Add SSO Support")];

function doc(items: PRDItem[] = ITEMS): PRDDocument {
  return { schema: SCHEMA_VERSION, title: "Guarded PRD", items };
}

/** Every file under `dir`, keyed by path relative to it. The byte-level pin. */
async function snapshotTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[relative(dir, full)] = await readFile(full, "utf-8");
    }
  }
  await walk(dir);
  return out;
}

/** Both local stores write the same tree; the guard must cover both. */
const STORES: ReadonlyArray<{ name: string; make: (rexDir: string) => PRDStore }> = [
  { name: "FolderTreeStore", make: (rexDir) => new FolderTreeStore(rexDir) },
  { name: "FileStore", make: (rexDir) => new FileStore(rexDir) },
];

describe("slug-rule write guard", () => {
  let tmpDir: string;
  let rexDir: string;
  let treeRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-slug-guard-"));
    rexDir = join(tmpDir, ".rex");
    treeRoot = join(rexDir, "prd_tree");
    await ensureFolderTreeRexDir(rexDir);
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "guard-test", adapter: "folder-tree" }),
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe.each(STORES)("$name", ({ make }) => {
    it("writes the marker on a first save, so a fresh tree is never refused", async () => {
      await make(rexDir).saveDocument(doc());

      expect(await readSlugRuleMarker(rexDir)).toBe(SLUG_RULE_VERSION);
      const meta = JSON.parse(await readFile(join(rexDir, TREE_META), "utf-8"));
      expect(meta).toMatchObject({ title: "Guarded PRD", slugRule: SLUG_RULE_VERSION });
    });

    it("refuses a save when the marker names a different rule, and writes nothing", async () => {
      const store = make(rexDir);
      await store.saveDocument(doc());

      // Rewrite the marker as a build on another rule would have left it.
      const meta = JSON.parse(await readFile(join(rexDir, TREE_META), "utf-8"));
      await writeFile(
        join(rexDir, TREE_META),
        JSON.stringify({ ...meta, slugRule: SLUG_RULE_VERSION + 1 }),
        "utf-8",
      );
      const before = await snapshotTree(rexDir);

      const next = make(rexDir);
      await expect(
        next.saveDocument(doc([...ITEMS, task("bbbbbbbb-2222-4222-8222-222222222222", "Second")])),
      ).rejects.toThrow(SlugRuleMismatchError);

      expect(await snapshotTree(rexDir)).toEqual(before);
    });

    it("names both versions and the migration command in the refusal", async () => {
      await make(rexDir).saveDocument(doc());
      const meta = JSON.parse(await readFile(join(rexDir, TREE_META), "utf-8"));
      await writeFile(
        join(rexDir, TREE_META),
        JSON.stringify({ ...meta, slugRule: 1 }),
        "utf-8",
      );

      const err = await make(rexDir)
        .saveDocument(doc())
        .then(
          () => undefined,
          (e: unknown) => e as SlugRuleMismatchError,
        );

      expect(err).toBeInstanceOf(SlugRuleMismatchError);
      expect(err!.found).toBe(1);
      expect(err!.expected).toBe(SLUG_RULE_VERSION);
      expect(err!.message).toContain("slug rule 1");
      expect(err!.message).toContain(`slug rule ${SLUG_RULE_VERSION}`);
      expect(err!.message).toContain("rex migrate-slugs");
    });

    it("adopts an unmarked tree whose paths already conform", async () => {
      await make(rexDir).saveDocument(doc());
      // Strip the marker, leaving a tree as any pre-guard build wrote it.
      await writeFile(
        join(rexDir, TREE_META),
        JSON.stringify({ title: "Guarded PRD", schema: SCHEMA_VERSION }),
        "utf-8",
      );
      expect(await readSlugRuleMarker(rexDir)).toBeUndefined();

      await make(rexDir).saveDocument(doc());

      expect(await readSlugRuleMarker(rexDir)).toBe(SLUG_RULE_VERSION);
    });

    // Every tree written before this guard shipped is unmarked, so the
    // path-scan branch is the one a real upgrade takes — and it used to judge
    // the tree by the document *about to be written*, which already carries
    // the mutation. Any slug-changing write therefore looked exactly like a
    // foreign build's re-slug, and was refused with that accusation. It bit
    // once per repository: the first such write after upgrading.
    describe("a slug-changing write on an unmarked tree", () => {
      /** Save through the store, then strip the marker the save recorded. */
      async function unmarkedTree(items: PRDItem[] = ITEMS): Promise<void> {
        await make(rexDir).saveDocument(doc(items));
        await writeFile(
          join(rexDir, TREE_META),
          JSON.stringify({ title: "Guarded PRD", schema: SCHEMA_VERSION }),
          "utf-8",
        );
        expect(await readSlugRuleMarker(rexDir)).toBeUndefined();
      }

      it("renames rather than refusing, and stamps the marker", async () => {
        await unmarkedTree();

        await make(rexDir).withTransaction(async (d) => {
          d.items[0]!.title = "Renamed Support";
        });

        expect(await readdir(treeRoot)).toEqual(["renamed-support.md"]);
        expect(await readSlugRuleMarker(rexDir)).toBe(SLUG_RULE_VERSION);
      });

      // The nastiest shape of the same bug: nobody edited a title, but adding
      // a same-titled sibling moves *both* siblings onto `-{id6}` paths, so
      // the pending document disagreed with the tree about an item the caller
      // never touched.
      it("allows an add that forces a colliding sibling onto an id suffix", async () => {
        await unmarkedTree();

        await make(rexDir).withTransaction(async (d) => {
          d.items.push(task("bbbbbbbb-2222-4222-8222-222222222222", "Add SSO Support"));
        });

        expect((await readdir(treeRoot)).sort()).toEqual([
          "add-sso-support-aaaaaa.md",
          "add-sso-support-bbbbbb.md",
        ]);
        expect(await readSlugRuleMarker(rexDir)).toBe(SLUG_RULE_VERSION);
      });

      // A move or a merge only trips the guard when it changes the slug of an
      // item it did not touch: taking one of two same-titled siblings away
      // leaves the other unique, so the survivor drops its `-{id6}` suffix.
      // Moving a *uniquely* titled item proves nothing here — the mismatch
      // scan only reports a rival entry found in the same directory, and a
      // moved item simply leaves its old directory, so that version of this
      // test passed against the unfixed guard.
      it("allows a move that re-slugs the twin left behind", async () => {
        const epic: PRDItem = {
          id: "dddddddd-4444-4444-8444-444444444444",
          title: "Alpha Epic",
          status: "pending",
          level: "epic",
          description: "",
          priority: "medium",
          children: [
            task("eeeeeeee-5555-4555-8555-555555555555", "Shared Title"),
            task("ffffffff-6666-4666-8666-666666666666", "Shared Title"),
          ],
        } as PRDItem;
        await unmarkedTree([epic]);
        // Both twins carry the suffix while they are siblings.
        expect((await readdir(join(treeRoot, "alpha-epic"))).sort()).toEqual([
          "index.md",
          "shared-title-eeeeee.md",
          "shared-title-ffffff.md",
        ]);

        await make(rexDir).withTransaction(async (d) => {
          const moved = d.items[0]!.children!.pop()!;
          (moved as PRDItem).level = "epic";
          d.items.push(moved);
        });

        // The survivor is unique now, so it sheds the suffix — the rename the
        // guard used to read as a foreign build's work.
        expect((await readdir(join(treeRoot, "alpha-epic"))).sort()).toEqual([
          "index.md",
          "shared-title.md",
        ]);
        expect(await readSlugRuleMarker(rexDir)).toBe(SLUG_RULE_VERSION);
      });
    });

    it("refuses an unmarked tree whose paths follow a foreign rule", async () => {
      await make(rexDir).saveDocument(doc());
      await writeFile(
        join(rexDir, TREE_META),
        JSON.stringify({ title: "Guarded PRD", schema: SCHEMA_VERSION }),
        "utf-8",
      );

      // Re-slug the single item the way the superseded rule did: an
      // unconditional `-{id6}` suffix, even without a sibling collision.
      const body = await readFile(join(treeRoot, "add-sso-support.md"), "utf-8");
      await rm(join(treeRoot, "add-sso-support.md"));
      await writeFile(join(treeRoot, "add-sso-support-aaaaaa.md"), body, "utf-8");
      const before = await snapshotTree(rexDir);

      const err = await make(rexDir)
        .saveDocument(doc())
        .then(
          () => undefined,
          (e: unknown) => e as SlugRuleMismatchError,
        );

      expect(err).toBeInstanceOf(SlugRuleMismatchError);
      expect(err!.found).toBeUndefined();
      expect(err!.message).toContain("no slug-rule marker");
      expect(err!.message).toContain("rex migrate-slugs");
      expect(await snapshotTree(rexDir)).toEqual(before);
    });

    it("guards the transaction path, not only saveDocument", async () => {
      const store = make(rexDir);
      await store.saveDocument(doc());
      const meta = JSON.parse(await readFile(join(rexDir, TREE_META), "utf-8"));
      await writeFile(
        join(rexDir, TREE_META),
        JSON.stringify({ ...meta, slugRule: 99 }),
        "utf-8",
      );
      const before = await snapshotTree(rexDir);

      await expect(
        make(rexDir).withTransaction(async (d) => {
          d.items.push(task("cccccccc-3333-4333-8333-333333333333", "Snuck In"));
        }),
      ).rejects.toThrow(SlugRuleMismatchError);

      expect(await snapshotTree(rexDir)).toEqual(before);
    });

    it("adoptSlugRule is the one way past a refusal, and is idempotent", async () => {
      await make(rexDir).saveDocument(doc());
      const meta = JSON.parse(await readFile(join(rexDir, TREE_META), "utf-8"));
      await writeFile(
        join(rexDir, TREE_META),
        JSON.stringify({ ...meta, slugRule: 1 }),
        "utf-8",
      );

      const store = make(rexDir);
      await store.adoptSlugRule!();
      expect(await readSlugRuleMarker(rexDir)).toBe(SLUG_RULE_VERSION);

      // A second run has nothing left to do and must not be refused either.
      const after = await snapshotTree(rexDir);
      await make(rexDir).adoptSlugRule!();
      expect(await snapshotTree(rexDir)).toEqual(after);

      // And the guard is armed again for ordinary writers.
      await expect(make(rexDir).saveDocument(doc())).resolves.toBeUndefined();
    });

    // A migration can only move a tree onto the rule this build implements,
    // so adopt-newer is a downgrade wearing a migration's name. Left
    // unbounded it made the guard's own advice into a loop: the newer build
    // refuses the downgraded tree, tells the operator to migrate, and the two
    // builds trade whole-tree renames forever.
    describe("a tree marked with a newer rule", () => {
      async function markNewer(): Promise<void> {
        await make(rexDir).saveDocument(doc());
        const meta = JSON.parse(await readFile(join(rexDir, TREE_META), "utf-8"));
        await writeFile(
          join(rexDir, TREE_META),
          JSON.stringify({ ...meta, slugRule: SLUG_RULE_VERSION + 1 }),
          "utf-8",
        );
      }

      it("is refused by adoptSlugRule, which writes nothing", async () => {
        await markNewer();
        const before = await snapshotTree(rexDir);

        await expect(make(rexDir).adoptSlugRule!()).rejects.toThrow(SlugRuleMismatchError);

        expect(await snapshotTree(rexDir)).toEqual(before);
        expect(await readSlugRuleMarker(rexDir)).toBe(SLUG_RULE_VERSION + 1);
      });

      it("is refused with an upgrade instruction, not a migration one", async () => {
        await markNewer();

        const err = await make(rexDir)
          .saveDocument(doc())
          .then(
            () => undefined,
            (e: unknown) => e as SlugRuleMismatchError,
          );

        expect(err).toBeInstanceOf(SlugRuleMismatchError);
        expect(err!.found).toBe(SLUG_RULE_VERSION + 1);
        expect(err!.message).toContain("Upgrade rex");
        expect(err!.message).not.toMatch(/Run 'rex migrate-slugs'/);
      });
    });
  });

  // `syncFolderTree` calls the serializer directly instead of going through a
  // store, so it does not inherit the store's guard. Every one of its sixteen
  // callers happens to perform a guarded store write first, which means a
  // command-level test passes whether or not this path is guarded — the shield
  // is the callers, not the write. These tests aim at the function itself,
  // because that is where the guarantee has to hold for the next caller too.
  describe("syncFolderTree", () => {
    it("refuses a mismatched marker instead of re-slugging the tree", async () => {
      const store = new FolderTreeStore(rexDir);
      await store.saveDocument(doc());
      const meta = JSON.parse(await readFile(join(rexDir, TREE_META), "utf-8"));
      await writeFile(
        join(rexDir, TREE_META),
        JSON.stringify({ ...meta, slugRule: 1 }),
        "utf-8",
      );
      const before = await snapshotTree(rexDir);

      await expect(syncFolderTree(rexDir, new FolderTreeStore(rexDir))).rejects.toThrow(
        SlugRuleMismatchError,
      );

      expect(await snapshotTree(rexDir)).toEqual(before);
    });

    it("refuses an unmarked tree whose paths follow a foreign rule", async () => {
      const store = new FolderTreeStore(rexDir);
      await store.saveDocument(doc());
      await writeFile(
        join(rexDir, TREE_META),
        JSON.stringify({ title: "Guarded PRD", schema: SCHEMA_VERSION }),
        "utf-8",
      );
      // The superseded rule's shape: an unconditional `-{id6}` suffix.
      const body = await readFile(join(treeRoot, "add-sso-support.md"), "utf-8");
      await rm(join(treeRoot, "add-sso-support.md"));
      await writeFile(join(treeRoot, "add-sso-support-aaaaaa.md"), body, "utf-8");
      const before = await snapshotTree(rexDir);

      await expect(syncFolderTree(rexDir, new FolderTreeStore(rexDir))).rejects.toThrow(
        SlugRuleMismatchError,
      );

      expect(await snapshotTree(rexDir)).toEqual(before);
    });

    it("still syncs a tree this build owns", async () => {
      const store = new FolderTreeStore(rexDir);
      await store.saveDocument(doc());

      await expect(syncFolderTree(rexDir, new FolderTreeStore(rexDir))).resolves.toBeUndefined();
    });
  });

  // The refusal exists to be read. `parentDir` is built with `path.join`, so
  // concatenating a hardcoded "/" onto it rendered a nested offender as the
  // mixed `epic-x\feature-y/task.md` on Windows — a path the operator cannot
  // paste anywhere.
  it("renders a nested offender with the platform separator", async () => {
    const epic: PRDItem = {
      id: "dddddddd-4444-4444-8444-444444444444",
      title: "Alpha Epic",
      status: "pending",
      level: "epic",
      description: "",
      priority: "medium",
      children: [task("eeeeeeee-5555-4555-8555-555555555555", "Nested Task")],
    } as PRDItem;
    await new FolderTreeStore(rexDir).saveDocument(doc([epic]));
    await writeFile(
      join(rexDir, TREE_META),
      JSON.stringify({ title: "Guarded PRD", schema: SCHEMA_VERSION }),
      "utf-8",
    );

    // Re-slug the *nested* entry the superseded rule's way, so the offender
    // has a parent directory in its rendered path.
    const epicDir = join(treeRoot, "alpha-epic");
    const body = await readFile(join(epicDir, "nested-task.md"), "utf-8");
    await rm(join(epicDir, "nested-task.md"));
    await writeFile(join(epicDir, "nested-task-eeeeee.md"), body, "utf-8");

    const err = await new FolderTreeStore(rexDir)
      .saveDocument(doc([epic]))
      .then(
        () => undefined,
        (e: unknown) => e as SlugRuleMismatchError,
      );

    expect(err).toBeInstanceOf(SlugRuleMismatchError);
    expect(err!.message).toContain(join("alpha-epic", "nested-task-eeeeee.md"));
  });

  it("treats a damaged sidecar as unmarked rather than as permission to write", async () => {
    await mkdir(treeRoot, { recursive: true });
    await writeFile(join(rexDir, TREE_META), "{ not json", "utf-8");

    expect(await readSlugRuleMarker(rexDir)).toBeUndefined();
  });

  it("treats a non-integer marker as unmarked", async () => {
    await writeFile(
      join(rexDir, TREE_META),
      JSON.stringify({ title: "t", schema: SCHEMA_VERSION, slugRule: "2" }),
      "utf-8",
    );
    expect(await readSlugRuleMarker(rexDir)).toBeUndefined();
  });
});
