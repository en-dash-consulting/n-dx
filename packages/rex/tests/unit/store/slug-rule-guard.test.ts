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
import {
  SlugRuleMismatchError,
  readSlugRuleMarker,
  checkTreeConformance,
} from "../../../src/store/slug-rule-guard.js";
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

    // Absence used to be adopted when the paths scanned clean, on the reading
    // that no marker meant a tree older than the guard. A rex MCP server
    // running an older build disproved it: rewriting `tree-meta.json` from a
    // type with no `slugRule` field erased the marker while moving no path at
    // all, so a disarmed guard and a pre-guard tree became indistinguishable.
    // Adoption now refuses, and `rex migrate-slugs` — which verifies the paths
    // before recording anything — is the only way to re-arm it.
    describe("a tree whose marker has gone missing", () => {
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

      it("is refused even when every path already conforms", async () => {
        await unmarkedTree();
        const before = await snapshotTree(rexDir);

        const err = await make(rexDir)
          .saveDocument(doc())
          .then(
            () => undefined,
            (e: unknown) => e as SlugRuleMismatchError,
          );

        expect(err).toBeInstanceOf(SlugRuleMismatchError);
        expect(err!.found).toBeUndefined();
        expect(err!.message).toContain("slug rule marker missing; run rex migrate-slugs");
        // The refusal's whole promise: nothing was written on the way out.
        expect(await snapshotTree(rexDir)).toEqual(before);
        expect(await readSlugRuleMarker(rexDir)).toBeUndefined();
      });

      it("is refused on the transaction path too", async () => {
        await unmarkedTree();
        const before = await snapshotTree(rexDir);

        await expect(
          make(rexDir).withTransaction(async (d) => {
            d.items[0]!.title = "Renamed Support";
          }),
        ).rejects.toThrow(SlugRuleMismatchError);

        expect(await snapshotTree(rexDir)).toEqual(before);
      });

      it("is refused when the paths follow a foreign rule", async () => {
        await unmarkedTree();

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
        expect(err!.message).toContain("slug rule marker missing; run rex migrate-slugs");
        expect(await snapshotTree(rexDir)).toEqual(before);
      });

      // The escape hatch has to work from exactly this state, or the refusal
      // above is a wall rather than a detour.
      it("is cleared by adoptSlugRule, which re-records the marker", async () => {
        await unmarkedTree();

        await make(rexDir).adoptSlugRule!();

        expect(await readSlugRuleMarker(rexDir)).toBe(SLUG_RULE_VERSION);
        await expect(make(rexDir).saveDocument(doc())).resolves.toBeUndefined();
      });
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

  // The gate half. `ndx work` and the dashboard's Execute both call this
  // before starting an agent, so what it refuses decides whether a run begins
  // at all — and a run that begins writes the PRD when it finishes.
  describe("checkTreeConformance", () => {
    it("refuses a tree whose marker has gone missing", async () => {
      const store = new FolderTreeStore(rexDir);
      await store.saveDocument(doc());
      await writeFile(
        join(rexDir, TREE_META),
        JSON.stringify({ title: "Guarded PRD", schema: SCHEMA_VERSION }),
        "utf-8",
      );

      const refusal = await checkTreeConformance(
        rexDir,
        treeRoot,
        (await new FolderTreeStore(rexDir).loadDocument()).items,
      );

      expect(refusal).not.toBeNull();
      expect(refusal!.markerFound).toBeUndefined();
      // The same sentence the store and `rex validate` use, so an operator who
      // meets the refusal in one surface recognises it in the others.
      expect(refusal!.message).toContain("slug rule marker missing; run rex migrate-slugs");
    });

    // A project that has been initialised but never written to has a `.rex/`
    // and no items. Refusing it would block the first run in every new
    // repository on a migration with nothing to migrate.
    it("passes an empty tree with no marker", async () => {
      await mkdir(treeRoot, { recursive: true });

      expect(await checkTreeConformance(rexDir, treeRoot, [])).toBeNull();
    });

    it("passes a tree this build owns", async () => {
      await new FolderTreeStore(rexDir).saveDocument(doc());

      const refusal = await checkTreeConformance(
        rexDir,
        treeRoot,
        (await new FolderTreeStore(rexDir).loadDocument()).items,
      );

      expect(refusal).toBeNull();
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

    // Re-slug the *nested* entry the superseded rule's way, so the offender
    // has a parent directory in its rendered path. The marker is left intact:
    // a tree this build owns whose paths were disturbed under it is exactly
    // the case the gate reports and the write guard's marker check misses.
    const epicDir = join(treeRoot, "alpha-epic");
    const body = await readFile(join(epicDir, "nested-task.md"), "utf-8");
    await rm(join(epicDir, "nested-task.md"));
    await writeFile(join(epicDir, "nested-task-eeeeee.md"), body, "utf-8");

    // Through the gate rather than the write guard: since an absent marker is
    // refused outright, `checkTreeConformance` is the only caller left that
    // scans paths and renders offenders. It is also the one whose output an
    // operator actually reads — `ndx work` and the dashboard print it verbatim.
    const store = new FolderTreeStore(rexDir);
    const refusal = await checkTreeConformance(
      rexDir,
      treeRoot,
      (await store.loadDocument()).items,
    );

    expect(refusal).not.toBeNull();
    expect(refusal!.message).toContain(join("alpha-epic", "nested-task-eeeeee.md"));
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
