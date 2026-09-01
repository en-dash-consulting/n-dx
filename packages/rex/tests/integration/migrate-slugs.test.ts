/**
 * `rex migrate-slugs` — one-shot rename of an existing tree to the current rule.
 *
 * Slugs are title-only; the id lives in front matter. A tree written by an
 * older build carries a `-{id6}` suffix on every path, and this command brings
 * it onto the current rule in one deliberate pass rather than letting the next
 * ordinary save produce a surprise mass diff.
 *
 * The fixture below is deliberately id-qualified. An earlier revision of this
 * file used a title-only fixture after the rule flipped, which meant the
 * migration had nothing to do and the assertions passed without exercising it.
 *
 * @see packages/rex/src/cli/commands/migrate-slugs.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdMigrateSlugs } from "../../src/cli/commands/migrate-slugs.js";
import { FolderTreeStore } from "../../src/store/folder-tree-store.js";
import type { CLIError } from "../../src/cli/errors.js";

/** Write a superseded id-qualified tree by hand: one branch epic, one leaf task, one leaf epic. */
async function writeLegacyTree(treeRoot: string): Promise<void> {
  const epicDir = join(treeRoot, "auth-feature-aaaaaa");
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
      "| [Login Task](./login-task-bbbbbb.md) | pending |",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    join(epicDir, "login-task-bbbbbb.md"),
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
    join(treeRoot, "solo-epic-cccccc.md"),
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

  it("renames every entry to the current title-only rule and the parser reads the result identically", async () => {
    const before = await new FolderTreeStore(rexDir).loadDocument();

    await cmdMigrateSlugs(projectDir, {});

    const entries = await listTree(treeRoot);
    expect(entries).toContain("auth-feature");
    expect(entries).toContain("auth-feature/login-task.md");
    expect(entries).toContain("solo-epic.md");
    // No id-qualified leftovers from the superseded rule.
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
});

describe("rex migrate-slugs: pure-rename guarantee", () => {
  let projectDir: string;
  let rexDir: string;
  let treeRoot: string;

  /** Run git in the temp repo, returning stdout. */
  function git(...args: string[]): string {
    return execFileSync("git", args, { cwd: projectDir, encoding: "utf-8" });
  }

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "migrate-slugs-git-"));
    rexDir = join(projectDir, ".rex");
    treeRoot = join(rexDir, "prd_tree");
    await mkdir(treeRoot, { recursive: true });
    await writeLegacyTree(treeRoot);
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("add", "-A");
    git("commit", "-q", "-m", "id-qualified tree");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("git sees the migration as renames, with leaf files byte-identical", async () => {
    await cmdMigrateSlugs(projectDir, {});
    git("add", "-A");

    const status = git("diff", "--cached", "-M", "--name-status", "--", ".rex/prd_tree")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t"));

    expect(status.length, "the migration renamed nothing — the fixture may already be canonical")
      .toBeGreaterThan(0);

    // Nothing may be added or deleted outright: every path must pair up.
    const unpaired = status.filter(([code]) => code === "A" || code === "D");
    expect(unpaired, `paths appeared or vanished instead of being renamed: ${JSON.stringify(unpaired)}`)
      .toEqual([]);

    // Leaf files carry only item data, so their rename must be byte-identical.
    // `index.md` legitimately changes: it embeds a children table of sibling
    // slugs, which is exactly what the rename alters. Asserting R100 across the
    // board would be asserting something false.
    const leafRenames = status.filter(([, from]) => from && !from.endsWith("/index.md"));
    expect(leafRenames.length).toBeGreaterThan(0);
    for (const [code, from, to] of leafRenames) {
      expect(code, `${from} -> ${to} was not a byte-identical rename`).toBe("R100");
    }
  });

  it("changes nothing but children-table links inside index.md", async () => {
    const before = git("show", "HEAD:.rex/prd_tree/auth-feature-aaaaaa/index.md");
    await cmdMigrateSlugs(projectDir, {});
    const after = await readFile(join(treeRoot, "auth-feature", "index.md"), "utf-8");

    const meaningful = (text: string) =>
      text
        .split("\n")
        // Drop the children table's link rows — the only part a rename touches.
        .filter((l) => !/^\|\s*\[/.test(l.trim()))
        .join("\n")
        .trim();

    expect(meaningful(after), "item data changed during what should be a rename")
      .toBe(meaningful(before));
    // And the link itself did move to the new slug.
    expect(after).toContain("./login-task.md");
    expect(after).not.toContain("login-task-bbbbbb.md");
  });
});

describe("rex migrate-slugs: refuses on unresolved sibling collisions", () => {
  let projectDir: string;
  let treeRoot: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "migrate-slugs-collide-"));
    treeRoot = join(projectDir, ".rex", "prd_tree");
    await mkdir(treeRoot, { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("names the colliding titles instead of silently suffixing them", async () => {
    // Two siblings whose titles normalise to the same slug. Ordinary writes
    // disambiguate these to avoid losing an item, but a *migration* should not
    // quietly bake a suffix into a tree it is supposed to be making readable —
    // the human should consolidate them first.
    for (const [file, id, title] of [
      ["rex-aaaaaa.md", "aaaaaaaa-0000-0000-0000-000000000000", "Rex"],
      ["rex-bbbbbb.md", "bbbbbbbb-0000-0000-0000-000000000000", "Rex!"],
    ]) {
      await writeFile(
        join(treeRoot, file),
        `---\nid: "${id}"\ntitle: "${title}"\nlevel: "epic"\nstatus: "pending"\n---\n`,
        "utf-8",
      );
    }

    await expect(cmdMigrateSlugs(projectDir, {})).rejects.toThrow(/collision/i);

    // The offending titles must be named — "there is a collision" is not
    // actionable in a tree of 1300 files.
    const err = await cmdMigrateSlugs(projectDir, {}).catch((e: Error) => e);
    expect(err.message + (err as CLIError).hint).toMatch(/rex/i);

    // And nothing was renamed on the way out.
    const entries = await readdir(treeRoot);
    expect(entries.sort()).toEqual(["rex-aaaaaa.md", "rex-bbbbbb.md"]);
  });

  it("proceeds once the collision is gone", async () => {
    await writeFile(
      join(treeRoot, "rex-aaaaaa.md"),
      '---\nid: "aaaaaaaa-0000-0000-0000-000000000000"\ntitle: "Rex"\nlevel: "epic"\nstatus: "pending"\n---\n',
      "utf-8",
    );

    await cmdMigrateSlugs(projectDir, {});

    expect((await readdir(treeRoot)).filter((e) => e.endsWith(".md"))).toEqual(["rex.md"]);
  });
});
