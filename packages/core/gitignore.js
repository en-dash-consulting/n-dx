/**
 * Append-only `.gitignore` maintenance shared by the orchestration tier, and
 * the git question that governs it.
 *
 * `ndx init` and `ndx export` both need to make sure a path is ignored
 * without disturbing whatever else the user keeps in the file. Kept as its
 * own module so export.js does not have to import cli.js (which imports
 * export.js) to reach it.
 *
 * {@link isGitTracked} lives here rather than in ci.js because "is this path
 * already tracked?" is the question that decides whether ignoring it is
 * right at all: adding an ignore line for a directory whose files are
 * committed does not untrack them, it only hides everything written there
 * afterwards.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Is `relPath` tracked by git in `cwd`? False outside a repo or without git.
 *
 * A directory counts as tracked when git has any file under it — which is
 * the sense a caller asking "may I ignore this?" means.
 *
 * @param {string} relPath  Path relative to `cwd`
 * @param {string} cwd
 * @returns {boolean}
 */
export function isGitTracked(relPath, cwd) {
  try {
    const result = spawnSync("git", ["ls-files", "--error-unmatch", "--", relPath], {
      windowsHide: true,
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: "pipe",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Is `relPath` repository content, for a trust decision? Like
 * {@link isGitTracked}, except that a git failure other than its own "not in
 * the index" (exit 1) — dubious ownership, git missing, a corrupt index, the
 * timeout — counts as tracked while `cwd` sits inside a git work tree (a
 * `.git` entry walking up). A committed file must not read as the user's own
 * just because git could not answer. Outside a work tree it is false.
 *
 * Mirrors llm-client's `isLocalConfigTracked`; core spawns rather than
 * importing it.
 *
 * @param {string} relPath  Path relative to `cwd`
 * @param {string} cwd
 * @returns {boolean}
 */
export function isGitTrackedOrUnanswered(relPath, cwd) {
  const result = spawnSync("git", ["ls-files", "--error-unmatch", "--", relPath], {
    windowsHide: true,
    cwd,
    encoding: "utf-8",
    timeout: 5000,
    stdio: "pipe",
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return insideGitWorkTree(cwd);
}

/** Is `dir`, or a directory above it, the top of a git work tree (has a `.git` entry)? */
function insideGitWorkTree(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return true;
    if (dirname(d) === d) return false;
  }
}

/**
 * Append `entry` to `<dir>/.gitignore` unless an identical line is already
 * present. Creates the file when missing. Sync I/O, matching cli.js.
 *
 * Matches whole lines, not substrings: `ndx-export/` must not be satisfied by
 * a `!ndx-export/` negation or a `my-ndx-export/` sibling.
 *
 * @param {string} dir    Project root.
 * @param {string} entry  One ignore pattern, without a trailing newline.
 * @returns {boolean}     True when the entry was added, false when already present.
 */
export function ensureGitignoreEntry(dir, entry) {
  const gitignorePath = join(dir, ".gitignore");
  let content = "";
  try {
    content = readFileSync(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet
  }
  const present = content.split(/\r?\n/).some((line) => line.trim() === entry);
  if (present) return false;
  const suffix = (content.length > 0 && !content.endsWith("\n") ? "\n" : "") + entry + "\n";
  writeFileSync(gitignorePath, content + suffix, "utf-8");
  return true;
}
