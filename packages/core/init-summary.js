/**
 * The directory names `ndx init` prints, and how they line up in a column.
 *
 * Init has two recaps — the Ink one on a TTY and the static one everywhere
 * else — and both name the three tool directories. Which names those are is
 * not a constant: a new project is put on the `.ndx/` layout, so the
 * directories that exist are `.ndx/rex/`, `.ndx/hench/` and
 * `.ndx/sourcevision/`, while a legacy project re-initialised in place keeps
 * `.rex/`, `.hench/` and `.sourcevision/`. The static recap used to print the
 * legacy names unconditionally, so a fresh init reported three directories
 * that were not there — the created/reused *detection* already read the
 * resolved layout, only the labels were hard-coded.
 *
 * Two recaps mean two chances to get that wrong, so the answer lives here and
 * both ask for it. The padding belongs with the names for the same reason:
 * `.ndx/sourcevision/` is five characters wider than `.sourcevision/`, so a
 * fixed pad that lines up on one layout is ragged on the other.
 *
 * @module n-dx/init-summary
 * @see packages/core/layout.js — where the paths themselves come from
 */

import { relativeToRoot } from "./layout.js";

/**
 * The three tool directories as the init recap names them: root-relative, with
 * a trailing slash, in the layout this project is actually on.
 *
 * @param {import("./layout.js").Layout} layout
 * @returns {{sourcevision: string, rex: string, hench: string}}
 */
export function initDirLabels(layout) {
  return {
    sourcevision: `${relativeToRoot(layout, layout.sourcevisionDir)}/`,
    rex: `${relativeToRoot(layout, layout.rexDir)}/`,
    hench: `${relativeToRoot(layout, layout.henchDir)}/`,
  };
}

/**
 * One label padded to the width of the widest in its recap, so the status
 * column lines up on either layout.
 *
 * @param {string} label  This row's label, from {@link initDirLabels}.
 * @param {Record<string, string>} labels  Every row's label, for the width.
 * @returns {string}
 */
export function padInitDirLabel(label, labels) {
  const width = Math.max(...Object.values(labels).map((l) => l.length));
  return label.padEnd(width);
}
