/**
 * Regression: this repository's own `.rex/prd_tree/` must match the slug
 * rule the current rex build writes, and the tree must say so in
 * `tree-meta.json`. On 2026-09-17 a pull request merged 1,570 files
 * re-slugged by a foreign rex build, and CI let it through because `rex
 * validate`'s "tree slug convention" check ran at warning severity — see
 * packages/rex/src/cli/commands/validate.ts. That check is now an error
 * (exit 1), but only for someone who runs `rex validate` locally or in CI.
 * This test asserts the invariant directly through `pnpm test`, so a
 * re-slug shows up the moment it lands, not just on the next `rex validate`
 * run.
 *
 * Imports the rule from `packages/rex/src`, not `packages/rex/dist`: a
 * stale build's `dist/` can lag behind the source that produced it, in
 * which case importing `dist/public.js` would validate this tree against
 * whatever rule the *last build* implemented rather than the one on this
 * branch, and a re-slug matching the stale dist would pass here while
 * failing `rex validate` (which runs the source-built CLI). Importing
 * source makes the two checks agree by construction.
 *
 * The second `describe` block below is a regression guard for the checks
 * above: it proves `findNonConformingSlugs` and the marker check actually
 * fail on a bad tree, on fixtures built fresh each run, rather than passing
 * only because this repository's real tree happens to already be
 * conformant.
 *
 * @see packages/rex/tests/integration/slug-conformance-check.test.ts — unit
 *   coverage of findNonConformingSlugs itself, on synthetic fixtures.
 * @see packages/rex/tests/unit/cli/commands/validate.test.ts — cmdValidate's
 *   exit-1 behavior on a non-conformant tree.
 * @see packages/rex/src/store/slug-rule-guard.ts — readSlugRuleMarker and the
 *   write-time guard built on it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SLUG_RULE_VERSION,
  findNonConformingSlugs,
  serializeFolderTree,
} from "../../packages/rex/src/store/folder-tree-serializer.ts";
import { parseFolderTree } from "../../packages/rex/src/store/folder-tree-parser.ts";
import { readSlugRuleMarker } from "../../packages/rex/src/store/slug-rule-guard.ts";

const REPO_ROOT = process.cwd();
const REX_DIR = join(REPO_ROOT, ".rex");
const PRD_TREE_ROOT = join(REX_DIR, "prd_tree");

describe("this repository's PRD tree matches the current slug rule", () => {
  it("findNonConformingSlugs reports no mismatches", async () => {
    const { items } = await parseFolderTree(PRD_TREE_ROOT);
    expect(items.length).toBeGreaterThan(0);

    const mismatches = await findNonConformingSlugs(items, PRD_TREE_ROOT);

    if (mismatches.length > 0) {
      const detail = mismatches
        .slice(0, 10)
        .map((m) => `  "${m.found}" should be "${m.expected}" in ${m.parentDir} (${m.title})`)
        .join("\n");
      throw new Error(
        `${mismatches.length} path(s) do not match the current slug rule — ` +
          `a rex build using a different slug rule wrote this tree. ` +
          `Run rex migrate-slugs on the default branch.\n${detail}`,
      );
    }

    expect(mismatches).toEqual([]);
  });

  it("tree-meta.json's slugRule marker equals the build's SLUG_RULE_VERSION", async () => {
    const found = await readSlugRuleMarker(REX_DIR);

    if (found !== SLUG_RULE_VERSION) {
      const detail =
        found === undefined
          ? `.rex/tree-meta.json carries no slugRule marker`
          : `.rex/tree-meta.json's slugRule is ${found}`;
      throw new Error(
        `${detail}, but this build implements slug rule ${SLUG_RULE_VERSION} — ` +
          `a rex build using a different slug rule wrote or last saved this tree. ` +
          `Run rex migrate-slugs on the default branch.`,
      );
    }

    expect(found).toBe(SLUG_RULE_VERSION);
  });
});

describe("a tree with a foreign or missing slug-rule marker fails the checks above", () => {
  const FIXTURE_ITEMS = [
    {
      id: "epic-abc123",
      title: "Fixture Epic",
      level: "epic",
      status: "pending",
      children: [{ id: "task-def456", title: "Fixture Task", level: "task", status: "pending" }],
    },
  ];

  let projectDir;
  let rexDir;
  let treeRoot;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-slug-marker-fixture-"));
    rexDir = join(projectDir, ".rex");
    treeRoot = join(rexDir, "prd_tree");
    await mkdir(rexDir, { recursive: true });
    // Paths alone conform — only tree-meta.json is wrong in each case below,
    // isolating the marker check from findNonConformingSlugs' path scan.
    await serializeFolderTree(FIXTURE_ITEMS, treeRoot);
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("readSlugRuleMarker disagrees with SLUG_RULE_VERSION when the marker names another rule", async () => {
    await writeFile(
      join(rexDir, "tree-meta.json"),
      JSON.stringify({ title: "Fixture", schema: "rex/v1", slugRule: SLUG_RULE_VERSION + 1 }),
      "utf-8",
    );

    const found = await readSlugRuleMarker(rexDir);

    expect(found).toBe(SLUG_RULE_VERSION + 1);
    expect(found).not.toBe(SLUG_RULE_VERSION);
  });

  it("readSlugRuleMarker disagrees with SLUG_RULE_VERSION when the marker is missing entirely", async () => {
    await writeFile(
      join(rexDir, "tree-meta.json"),
      JSON.stringify({ title: "Fixture", schema: "rex/v1" }),
      "utf-8",
    );

    const found = await readSlugRuleMarker(rexDir);

    expect(found).toBeUndefined();
    expect(found).not.toBe(SLUG_RULE_VERSION);
  });

  it("findNonConformingSlugs still reports a re-slugged path regardless of the marker", async () => {
    // Belt-and-suspenders: confirms the fixture tree built above is one
    // findNonConformingSlugs can actually flag, using the same rename shape
    // packages/rex/tests/integration/slug-conformance-check.test.ts uses.
    const { items } = await parseFolderTree(treeRoot);
    const { readdir, rename } = await import("node:fs/promises");
    const entries = (await readdir(treeRoot)).filter((e) => e !== "tree-meta.json");
    await rename(join(treeRoot, entries[0]), join(treeRoot, "renamed-by-a-foreign-build"));

    const mismatches = await findNonConformingSlugs(items, treeRoot);

    expect(mismatches.length).toBeGreaterThan(0);
  });
});
