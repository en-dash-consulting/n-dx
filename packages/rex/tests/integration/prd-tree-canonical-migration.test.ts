/**
 * Integration test: legacy PRD tree shapes migrate forward into the canonical
 * `index.md`-per-folder-item layout via the parser+serializer round-trip
 * driven by reshape/add.
 *
 * Seeds a tree that exercises every legacy shape mentioned in the schema
 * doc — bare `<title>.md`, dual `<title>.md` + `index.md`, single-child
 * compaction shim with `__parent*` fields, and the buggy phantom
 * `index-{hash}/` wrapper — then runs the migration plus a load+save and
 * asserts the result conforms to the current schema and round-trips with
 * zero data loss.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { migrateToFolderPerTask } from "../../src/core/folder-per-task-migration.js";
import { snapshotPRDTree } from "../../src/core/backup-snapshots.js";
import { FolderTreeStore } from "../../src/store/folder-tree-store.js";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";

let testDir: string;
let rexDir: string;
let treeRoot: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `prd-tree-canonical-migration-${randomUUID()}`);
  rexDir = join(testDir, ".rex");
  treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  await mkdir(treeRoot, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("PRD tree canonical migration", () => {
  it("normalizes a tree containing every legacy shape into the canonical layout", async () => {
    // ── Shape A: legacy `<title>.md` (no index.md) ───────────────────────────
    const epicADir = join(treeRoot, "epic-a-aaaaaa");
    await mkdir(epicADir, { recursive: true });
    await writeFile(
      join(epicADir, "epic_a.md"),
      `---\nid: "aaaaaaaa-1111-1111-1111-111111111111"\nlevel: "epic"\ntitle: "Epic A"\nstatus: "pending"\n---\n\n# Epic A\n`,
    );

    // ── Shape B: dual `<title>.md` + `index.md` in the same folder ──────────
    const epicBDir = join(treeRoot, "epic-b-bbbbbb");
    await mkdir(epicBDir, { recursive: true });
    const epicBFrontmatter = `---\nid: "bbbbbbbb-2222-2222-2222-222222222222"\nlevel: "epic"\ntitle: "Epic B"\nstatus: "pending"\n---\n\n# Epic B\n`;
    await writeFile(join(epicBDir, "epic_b.md"), epicBFrontmatter);
    await writeFile(join(epicBDir, "index.md"), epicBFrontmatter);

    // ── Shape C: single-child compaction shim ───────────────────────────────
    // An epic with a single feature whose child task got compacted up.
    // On disk: epic-c/<task-slug>/index.md with __parent* for the feature
    //          and __parent__parent* for the epic.
    const epicCDir = join(treeRoot, "epic-c-cccccc");
    const compactedTaskDir = join(epicCDir, "compact-task");
    await mkdir(compactedTaskDir, { recursive: true });
    await writeFile(
      join(epicCDir, "index.md"),
      `---\nid: "cccccccc-3333-3333-3333-333333333333"\nlevel: "epic"\ntitle: "Epic C"\nstatus: "pending"\n---\n\n# Epic C\n`,
    );
    await writeFile(
      join(compactedTaskDir, "index.md"),
      [
        `---`,
        `id: "33330000-3333-3333-3333-333333333333"`,
        `level: "task"`,
        `title: "Compact Task"`,
        `status: "pending"`,
        `acceptanceCriteria: []`,
        `__parentId: "cf000000-3333-3333-3333-333333333333"`,
        `__parentTitle: "Compact Feature"`,
        `__parentLevel: "feature"`,
        `__parentStatus: "pending"`,
        `__parentAcceptanceCriteria: []`,
        `---`,
        ``,
        `# Compact Task`,
      ].join("\n"),
    );

    // ── Shape D: phantom `index-{hash}/` wrapper artifact ───────────────────
    // The parent feature's `index.md` got accidentally wrapped into a sibling
    // folder named `index-<hash>/`. Without migration the parent folder has
    // no own `index.md` and the parser silently drops the entire subtree.
    const epicDDir = join(treeRoot, "epic-d-dddddd");
    const phantomFeatureDir = join(epicDDir, "feature-d-ffffff");
    const phantomWrapperDir = join(phantomFeatureDir, "index-ffffff");
    await mkdir(phantomWrapperDir, { recursive: true });
    await writeFile(
      join(epicDDir, "index.md"),
      `---\nid: "dddddddd-4444-4444-4444-444444444444"\nlevel: "epic"\ntitle: "Epic D"\nstatus: "pending"\n---\n\n# Epic D\n`,
    );
    await writeFile(
      join(phantomWrapperDir, "index.md"),
      `---\nid: "df000000-4444-4444-4444-444444444444"\nlevel: "feature"\ntitle: "Feature D"\nstatus: "pending"\nacceptanceCriteria: []\n---\n\n# Feature D\n`,
    );

    // ── Shape E: legitimate leaf-subtask `.md` (Rule 1b, already canonical) ─
    // Sits next to its parent task to verify the migration doesn't break a
    // file that is already in the right shape.
    const epicEDir = join(treeRoot, "epic-e-eeeeee");
    const taskEDir = join(epicEDir, "task-e-tttttt");
    await mkdir(taskEDir, { recursive: true });
    await writeFile(
      join(epicEDir, "index.md"),
      `---\nid: "eeeeeeee-5555-5555-5555-555555555555"\nlevel: "epic"\ntitle: "Epic E"\nstatus: "pending"\n---\n\n# Epic E\n`,
    );
    await writeFile(
      join(taskEDir, "index.md"),
      `---\nid: "55550000-5555-5555-5555-555555555555"\nlevel: "task"\ntitle: "Task E"\nstatus: "pending"\nacceptanceCriteria: []\n---\n\n# Task E\n`,
    );
    await writeFile(
      join(taskEDir, "leaf-sub-eeffff.md"),
      `---\nid: "55ff0000-5555-5555-5555-555555555555"\nlevel: "subtask"\ntitle: "Leaf Sub"\nstatus: "pending"\n---\n\n# Leaf Sub\n`,
    );

    // ── Snapshot before mutating ─────────────────────────────────────────────
    const snapshot = await snapshotPRDTree(rexDir);
    expect(snapshot).not.toBeNull();
    // [\\/]: backupPath is built with join(), so it uses "\" on Windows.
    expect(snapshot!.backupPath).toMatch(/\.rex[\\/]\.backups[\\/]prd_tree_/);
    const backupExists = await stat(snapshot!.backupPath).then(() => true).catch(() => false);
    expect(backupExists).toBe(true);

    // ── Run migration + load+save round-trip ─────────────────────────────────
    const migrationResult = await migrateToFolderPerTask(treeRoot);
    expect(migrationResult.errors).toHaveLength(0);
    expect(migrationResult.migratedCount).toBeGreaterThan(0);

    // Phantom wrapper was either merged or removed.
    expect(
      migrationResult.migrations.some((m) =>
        m.type === "phantom-index-wrapper-merged" ||
        m.type === "phantom-index-wrapper-removed",
      ),
    ).toBe(true);
    // At least one legacy `<title>.md` got renamed to `index.md`.
    expect(
      migrationResult.migrations.some((m) => m.type === "title-md-renamed-to-index"),
    ).toBe(true);

    const store = new FolderTreeStore(rexDir);
    const loaded = await store.loadDocument();
    await store.saveDocument(loaded);

    // ── Assert canonical layout ──────────────────────────────────────────────
    // After load+save, item folders are renamed to their canonical slug
    // (derived from title + id), so we walk the post-save tree directly and
    // assert structural invariants rather than predicting folder names.
    async function listSubdirsSync(dir: string): Promise<string[]> {
      const entries = await readdir(dir);
      const subdirs: string[] = [];
      for (const e of entries) {
        const isDir = await stat(join(dir, e)).then((s) => s.isDirectory()).catch(() => false);
        if (isDir) subdirs.push(e);
      }
      return subdirs;
    }
    for (const subdir of await listSubdirsSync(treeRoot)) {
      const folder = join(treeRoot, subdir);
      const entries = await readdir(folder);
      expect(entries).toContain("index.md");
    }

    // No phantom `index-*` wrapper folders survived.
    async function findPhantomWrappers(dir: string): Promise<string[]> {
      const matches: string[] = [];
      const entries = await readdir(dir);
      for (const entry of entries) {
        const path = join(dir, entry);
        const isDir = await stat(path).then((s) => s.isDirectory()).catch(() => false);
        if (!isDir) continue;
        if (/^index-[A-Za-z0-9-]+$/.test(entry)) {
          const sub = await readdir(path);
          if (sub.length === 1 && sub[0] === "index.md") matches.push(path);
        }
        matches.push(...(await findPhantomWrappers(path)));
      }
      return matches;
    }
    expect(await findPhantomWrappers(treeRoot)).toEqual([]);

    // No `__parent*` fields survived in any on-disk file.
    async function collectMd(dir: string): Promise<string[]> {
      const out: string[] = [];
      const entries = await readdir(dir);
      for (const entry of entries) {
        const path = join(dir, entry);
        const isDir = await stat(path).then((s) => s.isDirectory()).catch(() => false);
        if (isDir) out.push(...(await collectMd(path)));
        else if (entry.endsWith(".md")) out.push(path);
      }
      return out;
    }
    for (const path of await collectMd(treeRoot)) {
      const text = await readFile(path, "utf-8");
      const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        expect(fmMatch[1]).not.toMatch(/^__parent/m);
      }
    }

    // Round-trip preserves every item id we seeded (no data loss).
    const reloaded = await store.loadDocument();
    const flatIds: string[] = [];
    function walk(items: typeof reloaded.items): void {
      for (const item of items) {
        flatIds.push(item.id);
        if (item.children) walk(item.children);
      }
    }
    walk(reloaded.items);
    const expectedIds = [
      "aaaaaaaa-1111-1111-1111-111111111111", // Epic A
      "bbbbbbbb-2222-2222-2222-222222222222", // Epic B
      "cccccccc-3333-3333-3333-333333333333", // Epic C
      "cf000000-3333-3333-3333-333333333333", // Compact Feature (reconstructed from __parent*)
      "33330000-3333-3333-3333-333333333333", // Compact Task
      "dddddddd-4444-4444-4444-444444444444", // Epic D
      "df000000-4444-4444-4444-444444444444", // Feature D (recovered from phantom wrapper)
      "eeeeeeee-5555-5555-5555-555555555555", // Epic E
      "55550000-5555-5555-5555-555555555555", // Task E
      "55ff0000-5555-5555-5555-555555555555", // Leaf Sub
    ];
    for (const id of expectedIds) {
      expect(flatIds, `id ${id} should survive the round-trip`).toContain(id);
    }
  });
});
