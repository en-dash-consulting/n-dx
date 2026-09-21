/**
 * Regression: this repository's own `.rex/prd_tree/` must match the slug
 * rule the current rex build writes. On 2026-09-17 a pull request merged
 * 1,570 files re-slugged by a foreign rex build, and CI let it through
 * because `rex validate`'s "tree slug convention" check ran at warning
 * severity — see packages/rex/src/cli/commands/validate.ts. That check is
 * now an error (exit 1), but only for someone who runs `rex validate`
 * locally or in CI. This test asserts the invariant directly through
 * `pnpm test`, so a re-slug shows up the moment it lands, not just on the
 * next `rex validate` run.
 *
 * @see packages/rex/tests/integration/slug-conformance-check.test.ts — unit
 *   coverage of findNonConformingSlugs itself, on synthetic fixtures.
 * @see packages/rex/tests/unit/cli/commands/validate.test.ts — cmdValidate's
 *   exit-1 behavior on a non-conformant tree.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const REX_DIR = join(REPO_ROOT, ".rex");
const PRD_TREE_ROOT = join(REX_DIR, "prd_tree");

describe("this repository's PRD tree matches the current slug rule", () => {
  it("findNonConformingSlugs reports no mismatches", async () => {
    const { parseFolderTree, findNonConformingSlugs } = await import(
      "../../packages/rex/dist/public.js"
    );

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
});
