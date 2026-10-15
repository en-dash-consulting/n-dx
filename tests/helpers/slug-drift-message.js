/**
 * The failure message for a PRD tree whose paths have left the slug rule.
 *
 * Extracted from `tests/e2e/prd-slug-conformance.test.js` so both branches can
 * be driven by a unit test. In the e2e test neither branch runs while the tree
 * is conformant, which is almost always — so the branch that picks the wrong
 * diagnosis would never be exercised there.
 */

/**
 * Total items in a parsed folder tree, including every descendant.
 *
 * `parseFolderTree` returns the *roots*; children hang off them. Counting the
 * roots alone understates the tree by a factor of fifty on this repository
 * (46 roots, ~2,500 items), which would put the "a rule change moved
 * everything" threshold within reach of about two dozen drifted leaves.
 *
 * @param {Array<{children?: unknown[]}>} items
 * @returns {number}
 */
export function countItemsDeep(items) {
  let total = 0;
  for (const item of items ?? []) {
    total += 1;
    total += countItemsDeep(item.children ?? []);
  }
  return total;
}

/**
 * Build the conformance failure message.
 *
 * Two faults land here and they want different fixes, so the message names
 * which one the counts point at rather than reporting every failure as the
 * rarer of the two. A rule change moves *every* path, because the rule decides
 * all of them; a handful of paths is ordinary item drift. Reporting the latter
 * as "a different rex build wrote this tree" once sent a reader past
 * `rex migrate-slugs` — the command that fixes both — and into a hand-rename of
 * the file and its parent's Children row.
 *
 * @param {{ mismatchCount: number, itemCount: number, detail: string }} input
 * @returns {string}
 */
export function slugDriftMessage({ mismatchCount, itemCount, detail }) {
  const scale = `${mismatchCount} of ${itemCount} path(s) do not match the current slug rule`;

  // `migrate-slugs` refuses off the default branch, and drift is usually found
  // *on* a feature branch — that is where a title gets edited. Naming the flag
  // here saves the reader a second failure.
  const howToRun =
    "Run rex migrate-slugs on the default branch; on a feature branch pass " +
    "--allow-on-branch. Either way only drifted paths move.";

  return mismatchCount > itemCount / 2
    ? `${scale}. At that scale the rule itself differs: a rex build using a ` +
        `different slug rule wrote this tree. ${howToRun}\n${detail}`
    : `${scale}. At that scale this is item drift rather than a rule change. ` +
        `The usual cause is a title edited without renaming the item's file ` +
        `(and the parent's Children row that points at it). ${howToRun} ` +
        `migrate-slugs re-serialises the tree at the current rule and renames ` +
        `only what has drifted.\n${detail}`;
}
