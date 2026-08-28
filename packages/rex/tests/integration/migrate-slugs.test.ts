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

  it("renames every entry to an id-qualified slug and the parser reads the result identically", async () => {
    const before = await new FolderTreeStore(rexDir).loadDocument();

    await cmdMigrateSlugs(projectDir, {});

    const entries = await listTree(treeRoot);
    expect(entries).toContain("auth-feature-aaaaaa");
    expect(entries).toContain("auth-feature-aaaaaa/login-task-bbbbbb.md");
    expect(entries).toContain("solo-epic-cccccc.md");
    // No title-only leftovers.
    expect(entries).not.toContain("auth-feature");
    expect(entries).not.toContain("solo-epic.md");

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
});
