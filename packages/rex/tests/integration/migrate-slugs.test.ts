/**
 * `rex migrate-slugs` — one-shot rename of an existing tree to id-qualified slugs.
 *
 * slugify() used to emit title-only slugs, so same-titled items created on
 * divergent branches collided on identical paths. New writes now always carry
 * the -{id6} suffix; this command renames an existing tree in one deliberate
 * pass instead of letting the next ordinary save produce a surprise mass diff.
 *
 * @see packages/rex/src/cli/commands/migrate-slugs.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdMigrateSlugs } from "../../src/cli/commands/migrate-slugs.js";
import { FolderTreeStore } from "../../src/store/folder-tree-store.js";
import {
  readSlugRuleMarker,
  SlugRuleMismatchError,
  SLUG_RULE_VERSION,
  TREE_META_FILENAME,
} from "../../src/store/index.js";

/** Write a legacy title-only-slug tree by hand: one branch epic, one leaf task, one leaf epic. */
async function writeLegacyTree(treeRoot: string): Promise<void> {
  const epicDir = join(treeRoot, "auth-feature");
  await mkdir(epicDir, { recursive: true });
  await writeFile(
    join(epicDir, "index.md"),
    [
      "---",
      'id: "aaaaaaaa-0000-0000-0000-000000000000"',
      'title: "Auth Feature"',
      'level: "epic"',
      'status: "pending"',
      "---",
      "",
      "## Children",
      "",
      "| Title | Status |",
      "|-------|--------|",
      "| [Login Task](./login-task.md) | pending |",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    join(epicDir, "login-task.md"),
    [
      "---",
      'id: "bbbbbbbb-0000-0000-0000-000000000000"',
      'title: "Login Task"',
      'level: "task"',
      'status: "pending"',
      "---",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    join(treeRoot, "solo-epic.md"),
    [
      "---",
      'id: "cccccccc-0000-0000-0000-000000000000"',
      'title: "Solo Epic"',
      'level: "epic"',
      'status: "pending"',
      "---",
      "",
    ].join("\n"),
    "utf-8",
  );
}

async function listTree(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    out.push(rel);
    if (entry.isDirectory()) out.push(...(await listTree(join(dir, entry.name), rel)));
  }
  return out.sort();
}

describe("rex migrate-slugs", () => {
  let projectDir: string;
  let rexDir: string;
  let treeRoot: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "migrate-slugs-"));
    rexDir = join(projectDir, ".rex");
    treeRoot = join(rexDir, "prd_tree");
    await mkdir(treeRoot, { recursive: true });
    await writeLegacyTree(treeRoot);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("renames every entry to the title-only slug and the parser reads the result identically", async () => {
    const before = await new FolderTreeStore(rexDir).loadDocument();

    await cmdMigrateSlugs(projectDir, {});

    const entries = await listTree(treeRoot);
    // Titles unique among their siblings carry no id component.
    expect(entries).toContain("auth-feature");
    expect(entries).toContain("auth-feature/login-task.md");
    expect(entries).toContain("solo-epic.md");
    // No id-qualified leftovers.
    expect(entries).not.toContain("auth-feature-aaaaaa");
    expect(entries).not.toContain("solo-epic-cccccc.md");

    // The parsed document is unchanged by the rename: same items, same shape.
    const after = new FolderTreeStore(rexDir);
    const doc = await after.loadDocument();
    const flatten = (items: typeof doc.items): string[] =>
      items.flatMap((i) => [`${i.id}:${i.title}:${i.status}`, ...flatten(i.children ?? [])]).sort();
    expect(flatten(doc.items)).toEqual(flatten(before.items));
  });

  it("is idempotent — a second run changes nothing", async () => {
    await cmdMigrateSlugs(projectDir, {});
    const first = await listTree(treeRoot);

    await cmdMigrateSlugs(projectDir, {});
    const second = await listTree(treeRoot);

    expect(second).toEqual(first);
  });

  // This command is the only writer allowed to re-slug a tree, so it is also
  // the only one that may set the marker. Rename and marker land in the same
  // locked write: a marker recorded ahead of a rename that then failed would
  // disarm the guard on exactly the tree it was protecting.
  it("records the slug-rule marker in the same run that renames the tree", async () => {
    // The hand-written fixture predates the marker entirely.
    expect(await readSlugRuleMarker(rexDir)).toBeUndefined();

    await cmdMigrateSlugs(projectDir, {});

    expect(await readSlugRuleMarker(rexDir)).toBe(SLUG_RULE_VERSION);
    // And the migrated tree is now writable by an ordinary save.
    const store = new FolderTreeStore(rexDir);
    await expect(store.saveDocument(await store.loadDocument())).resolves.toBeUndefined();
  });

  it("migrates a tree whose marker names a superseded rule, which ordinary saves refuse", async () => {
    await writeFile(
      join(rexDir, TREE_META_FILENAME),
      JSON.stringify({ title: "Legacy", slugRule: SLUG_RULE_VERSION - 1 }),
      "utf-8",
    );

    // Precondition: an ordinary save is refused. Without this the test could
    // pass against a build that never armed the guard at all.
    const blocked = new FolderTreeStore(rexDir);
    await expect(blocked.saveDocument(await blocked.loadDocument())).rejects.toThrow(
      SlugRuleMismatchError,
    );

    await cmdMigrateSlugs(projectDir, {});

    expect(await readSlugRuleMarker(rexDir)).toBe(SLUG_RULE_VERSION);
    expect(await listTree(treeRoot)).toContain("auth-feature/login-task.md");
  });

  it("reports the rename as verified lossless", async () => {
    const lines: string[] = [];
    (console.log as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (...args: unknown[]) => void lines.push(args.join(" ")),
    );

    await cmdMigrateSlugs(projectDir, { format: "json" });

    const payload = JSON.parse(lines.join("\n"));
    // The fixture tree is already title-only, so nothing needs renaming — the
    // losslessness proof is reported either way, which is the contract here.
    expect(payload.lossless).toBe(true);
    expect(payload.itemsVerified).toBe(3);
    expect(payload.entriesRenamed).toBe(0);
  });

  it("refuses, naming the offenders, when siblings share a title and an id", async () => {
    // The suffix cannot separate these: same normalised title, same id, so the
    // same `-{id6}`. The serializer would fall back to position suffixes and
    // make those paths depend on array order.
    await writeFile(
      join(treeRoot, "solo-epic-twin.md"),
      [
        "---",
        'id: "cccccccc-0000-0000-0000-000000000000"',
        'title: "Solo Epic"',
        'level: "epic"',
        'status: "pending"',
        "---",
        "",
      ].join("\n"),
      "utf-8",
    );

    await expect(cmdMigrateSlugs(projectDir, {})).rejects.toThrow(
      /cannot be resolved by the slug rule/,
    );
  });

  it("leaves the tree untouched when it refuses", async () => {
    await writeFile(
      join(treeRoot, "solo-epic-twin.md"),
      [
        "---",
        'id: "cccccccc-0000-0000-0000-000000000000"',
        'title: "Solo Epic"',
        'level: "epic"',
        'status: "pending"',
        "---",
        "",
      ].join("\n"),
      "utf-8",
    );
    const before = await listTree(treeRoot);

    await expect(cmdMigrateSlugs(projectDir, {})).rejects.toThrow();

    // The guard runs before the snapshot and before the transaction.
    expect(await listTree(treeRoot)).toEqual(before);
  });

  it("does not refuse on same-titled siblings with distinct ids", async () => {
    // The ordinary collision the -{id6} suffix exists for. Refusing here would
    // block migration of any healthy tree.
    await writeFile(
      join(treeRoot, "solo-epic-other.md"),
      [
        "---",
        'id: "dddddddd-0000-0000-0000-000000000000"',
        'title: "Solo Epic"',
        'level: "epic"',
        'status: "pending"',
        "---",
        "",
      ].join("\n"),
      "utf-8",
    );

    await expect(cmdMigrateSlugs(projectDir, {})).resolves.toBeUndefined();

    const entries = await listTree(treeRoot);
    expect(entries).toContain("solo-epic-cccccc.md");
    expect(entries).toContain("solo-epic-dddddd.md");
  });
});
