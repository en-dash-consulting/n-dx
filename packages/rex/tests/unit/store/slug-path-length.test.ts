/**
 * Guards the slug length cap against Windows' 260-character MAX_PATH.
 *
 * The cap partly existed to leave room for the `-{id6}` suffix every slug
 * used to carry. Dropping that suffix bought headroom rather than licence to
 * raise the cap: at 40 the worst relative path is 148 characters, at 80 it is
 * 218, which overruns MAX_PATH once a realistic checkout root is prepended.
 *
 * Acceptance criteria:
 *   - A deeply nested tree stays inside a Windows-safe path budget
 *   - The title-only rule is not longer than the id-qualified rule it replaced
 */

import { describe, it, expect } from "vitest";
import { resolveSiblingSlugs, slugifyTitle } from "../../../src/store/folder-tree-serializer.js";

/** Windows MAX_PATH, less the terminating NUL. */
const MAX_PATH = 259;

/**
 * Budget for a checkout root, e.g.
 * `C:\Users\firstname.lastname\Documents\projects\n-dx`.
 * Anything longer is the user's to solve with a shorter path or long-path
 * support; anything shorter should not be what makes the tree writable.
 */
const ASSUMED_ROOT = 52;

const LONG_TITLE =
  "Address relationship issues discovered during the deep architectural analysis pass";

describe("slug path length", () => {
  it("keeps a worst-case nested path inside the Windows budget", () => {
    // Deepest shape the schema allows: epic → feature → task → subtask.
    const slug = slugifyTitle(LONG_TITLE);
    const relative = [".rex", "prd_tree", slug, slug, slug, `${slug}.md`].join("/");

    expect(ASSUMED_ROOT + 1 + relative.length).toBeLessThanOrEqual(MAX_PATH);
  });

  it("caps a single slug at 40 characters", () => {
    expect(slugifyTitle(LONG_TITLE).length).toBeLessThanOrEqual(40);
  });

  it("is no longer than the id-qualified rule it replaced", () => {
    // The old rule truncated the title to 33 chars and appended `-{id6}`,
    // always landing on 40. Title-only uses the same 40-char budget for
    // title text alone, so a path can only get shorter, never longer.
    const unique = resolveSiblingSlugs([
      { id: "aaaaaaaa-0000-0000-0000-000000000000", title: LONG_TITLE, level: "task", status: "pending", children: [] },
    ] as never);
    const slug = [...unique.values()][0];

    expect(slug).not.toMatch(/-aaaaaa$/);
    expect(slug.length).toBeLessThanOrEqual(40);
  });

  it("stays within budget even when every level collides and takes a suffix", () => {
    // The worst case the collision rule can produce: a suffix at every level.
    const colliding = resolveSiblingSlugs([
      { id: "aaaaaaaa-0000-0000-0000-000000000000", title: LONG_TITLE, level: "task", status: "pending", children: [] },
      { id: "bbbbbbbb-0000-0000-0000-000000000000", title: LONG_TITLE, level: "task", status: "pending", children: [] },
    ] as never);
    const slug = [...colliding.values()][0];
    const relative = [".rex", "prd_tree", slug, slug, slug, `${slug}.md`].join("/");

    expect(slug).toMatch(/-[0-9a-f]{6}$/);
    expect(ASSUMED_ROOT + 1 + relative.length).toBeLessThanOrEqual(MAX_PATH);
  });
});
