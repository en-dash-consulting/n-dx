/**
 * Git repository preflight for `ndx init`.
 *
 * n-dx's autonomous workflows (hench task execution, auto-commit, pair
 * programming) record progress as git commits. When `ndx init` runs against
 * a directory that is not inside a git working tree, the user is offered the
 * option to initialize one. Declining is allowed — init still completes —
 * but a persistent warning surfaces in the recap that auto-commit features
 * are disabled.
 *
 * The detection is a pure filesystem walk (no `git rev-parse` spawn) so it
 * stays fast and works even when git is missing from PATH.
 *
 * @module n-dx/git-preflight
 */
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { execFileSync } from "child_process";
import { createInterface } from "readline/promises";

const PREFLIGHT_MESSAGE = [
  "",
  "This directory is not inside a git repository.",
  "n-dx workflows record progress with automatic commits — autonomous task",
  "execution, pair programming, and the hench run loop all assume a git",
  "working tree. Without one, those features are disabled.",
  "",
].join("\n");

/**
 * Walk up parent directories looking for a `.git` entry (file or directory).
 * Submodules use a `.git` file pointing at the parent worktree; both forms
 * count as "inside a git working tree".
 *
 * @param {string} dir
 * @returns {boolean}
 */
export function isInsideGitRepo(dir) {
  let cur = resolve(dir);
  // Walk until we reach the filesystem root; dirname(root) === root.
  while (true) {
    if (existsSync(join(cur, ".git"))) return true;
    const parent = dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}

function isInteractive() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Prompt for a yes/no answer, defaulting to "yes" on an empty Enter press.
 * Returns null when the input is not a TTY.
 *
 * @param {string} question
 * @returns {Promise<boolean|null>}
 */
async function promptYesNo(question) {
  if (!isInteractive()) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes") return true;
    return false;
  } finally {
    rl.close();
  }
}

/**
 * Run `git init` in the target directory. Captures stderr so a missing git
 * binary or write failure does not abort the surrounding init flow.
 *
 * @param {string} dir
 * @returns {{ ok: boolean, error?: string }}
 */
export function runGitInit(dir) {
  try {
    execFileSync("git", ["init"], { cwd: dir, stdio: "pipe", timeout: 15_000 });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * @typedef {Object} GitPreflightResult
 * @property {"inside"|"initialized"|"declined"|"non-interactive"|"init-failed"} status
 *   - `inside`          → target directory already inside a git repo; no action.
 *   - `initialized`     → user consented and `git init` succeeded.
 *   - `declined`        → user answered "no"; auto-commit features disabled.
 *   - `non-interactive` → no TTY (or `quiet`); treated as decline, warning persists.
 *   - `init-failed`     → user consented but `git init` failed (e.g. git missing).
 * @property {string} [error]  Error detail when status === "init-failed".
 */

/**
 * Detect whether `dir` is inside a git working tree; when it is not, prompt
 * the user to run `git init`. The prompt is skipped for non-TTY or `quiet`
 * runs — those resolve to `non-interactive` so the caller can still surface
 * the persistent warning in the recap.
 *
 * @param {string} dir
 * @param {{ quiet?: boolean }} [opts]
 * @returns {Promise<GitPreflightResult>}
 */
export async function runGitPreflight(dir, { quiet = false } = {}) {
  if (isInsideGitRepo(dir)) return { status: "inside" };

  const interactive = isInteractive() && !quiet;

  if (interactive) {
    process.stdout.write(PREFLIGHT_MESSAGE);
    const consent = await promptYesNo("Initialize git in this directory now? [Y/n] ");
    if (consent === false) return { status: "declined" };

    const result = runGitInit(dir);
    if (!result.ok) return { status: "init-failed", error: result.error };
    process.stdout.write(`Initialized empty Git repository in ${resolve(dir)}\n`);
    return { status: "initialized" };
  }

  return { status: "non-interactive" };
}

/**
 * Format the persistent warning lines emitted in the init summary when the
 * project is not a git repository. Returns an empty array for the `inside`
 * and `initialized` states.
 *
 * @param {GitPreflightResult | null | undefined} result
 * @returns {string[]}
 */
export function formatGitWarningLines(result) {
  if (!result) return [];
  if (result.status === "inside" || result.status === "initialized") return [];
  if (result.status === "init-failed") {
    return [
      "  Warning: `git init` failed — n-dx auto-commit features are disabled.",
      `  Detail: ${result.error || "unknown error"}`,
      "  Initialize git manually and re-run `ndx init` to enable automatic commits.",
    ];
  }
  // declined or non-interactive
  return [
    "  Warning: this project is not a git repository — n-dx auto-commit features are disabled.",
    "  Run `git init` in this directory and re-run `ndx init` to enable automatic commits.",
  ];
}
