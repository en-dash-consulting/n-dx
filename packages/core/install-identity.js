/**
 * Install identity for the running n-dx CLI.
 *
 * The package version is identical across every checkout and every install, so
 * `ndx --version` alone cannot answer the question people actually have: *which
 * copy of n-dx is this terminal running?* A developer machine routinely has a
 * globally installed `ndx` alongside several worktrees, and a dashboard tab, a
 * run record and a shell can each be driven by a different one.
 *
 * This module answers that by describing the CLI entry point itself — where it
 * lives, how it got there, and (when it is a git working tree) what it is
 * checked out at.
 *
 * Everything here is pure apart from {@link readGitIdentity}, and even that
 * takes its git runner by injection, so the whole surface is unit-testable
 * without creating real installs.
 *
 * @module n-dx/install-identity
 */

import { existsSync as nodeExistsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

/** Marker that identifies a pnpm workspace root. */
const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/**
 * How this copy of n-dx was installed.
 *
 * `link` and `workspace` both run code straight out of a checkout — the
 * difference is only whether it was reached through a global bin shim. That
 * distinction matters because a global link is the copy a bare `ndx` runs,
 * which is exactly the copy people forget they have.
 */
export const INSTALL_KIND = {
  /** Unpacked into a `node_modules` tree by a package manager. */
  NPM: "npm",
  /** A checkout reached through a global bin shim (`pnpm link --global` et al). */
  LINK: "link",
  /** A checkout executed directly, e.g. `node packages/core/cli.js`. */
  WORKSPACE: "workspace",
  /** Outside `node_modules` with no workspace root above it. */
  UNKNOWN: "unknown",
};

/** Human-readable label per {@link INSTALL_KIND}. */
export const INSTALL_KIND_LABELS = {
  [INSTALL_KIND.NPM]: "npm registry install",
  [INSTALL_KIND.LINK]: "pnpm global link",
  [INSTALL_KIND.WORKSPACE]: "workspace checkout",
  [INSTALL_KIND.UNKNOWN]: "unknown",
};

/**
 * True when `p` has a `node_modules` path segment.
 *
 * Segment-wise rather than substring-wise on purpose: a checkout living at
 * `~/src/node_modules-experiments` is not an npm install.
 *
 * @param {string} p  Absolute path.
 * @returns {boolean}
 */
export function isUnderNodeModules(p) {
  return resolve(p).split(sep).includes("node_modules");
}

/**
 * Walk up from `startDir` looking for a pnpm workspace root.
 *
 * @param {string} startDir
 * @param {{ existsSync?: (p: string) => boolean }} [deps]
 * @returns {string|null} The workspace root, or null when there is none.
 */
export function findWorkspaceRoot(startDir, deps = {}) {
  const existsSync = deps.existsSync ?? nodeExistsSync;
  let cur = resolve(startDir);
  // Walk until the filesystem root; dirname(root) === root.
  for (;;) {
    if (existsSync(join(cur, WORKSPACE_MARKER))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/**
 * True when `child` is `parent` or sits underneath it.
 *
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
function isInside(parent, child) {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * Classify how the running CLI was installed.
 *
 * `cliPath` must be the *resolved* entry point (`fileURLToPath(import.meta.url)`),
 * which Node has already run through realpath. `argvPath` is `process.argv[1]`,
 * which Node deliberately leaves un-resolved — so when the two disagree, the CLI
 * was reached through a symlink, i.e. a global bin shim. That asymmetry is the
 * only reliable way to tell a globally linked checkout from one invoked directly,
 * since both execute the very same file.
 *
 * @param {{ cliPath: string, argvPath?: string|null }} input
 * @param {{ existsSync?: (p: string) => boolean }} [deps]
 * @returns {{ kind: string, label: string, root: string|null }}
 */
export function classifyInstall({ cliPath, argvPath = null }, deps = {}) {
  const describe = (kind, root = null) => ({
    kind,
    label: INSTALL_KIND_LABELS[kind],
    root,
  });

  if (isUnderNodeModules(cliPath)) return describe(INSTALL_KIND.NPM);

  const root = findWorkspaceRoot(dirname(cliPath), deps);
  if (!root) return describe(INSTALL_KIND.UNKNOWN);

  // Reached via a bin shim outside the checkout → a global link.
  if (argvPath && !isInside(root, argvPath)) {
    return describe(INSTALL_KIND.LINK, root);
  }
  return describe(INSTALL_KIND.WORKSPACE, root);
}

/**
 * Read the git identity of a working tree.
 *
 * Returns null whenever the answer is not knowable — `dir` is not a working
 * tree, git is not on PATH, or the repository has no commits yet. None of those
 * are errors: `ndx which` still has something useful to say without git, so a
 * missing git must never change its exit code.
 *
 * @param {string} dir
 * @param {{ runGit?: (args: string[], dir: string) => string }} [deps]
 * @returns {{ branch: string|null, sha: string, detached: boolean }|null}
 */
export function readGitIdentity(dir, deps = {}) {
  const runGit =
    deps.runGit ??
    ((args, cwd) =>
      execFileSync("git", args, {
        cwd,
        stdio: "pipe",
        timeout: 5_000,
        encoding: "utf-8",
      }).trim());

  let sha;
  try {
    sha = runGit(["rev-parse", "--short", "HEAD"], dir);
  } catch {
    return null;
  }
  if (!sha) return null;

  let ref = "";
  try {
    ref = runGit(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  } catch {
    // Leave `ref` empty — treated as detached below.
  }

  const detached = ref === "" || ref === "HEAD";
  return { branch: detached ? null : ref, sha, detached };
}

/**
 * Assemble the full identity record behind `ndx which`.
 *
 * @param {object} input
 * @param {string} input.version     Version from packages/core/package.json.
 * @param {string} input.cliPath     Resolved cli.js path.
 * @param {string} input.projectDir  Resolved project directory.
 * @param {string|null} [input.argvPath]  `process.argv[1]`, when available.
 * @param {object} [deps]  Injected `existsSync` / `runGit` for tests.
 * @returns {{
 *   version: string,
 *   cliPath: string,
 *   install: { kind: string, label: string, root: string|null },
 *   git: { branch: string|null, sha: string, detached: boolean }|null,
 *   projectDir: string,
 * }}
 */
export function collectInstallIdentity(
  { version, cliPath, projectDir, argvPath = null },
  deps = {},
) {
  const install = classifyInstall({ cliPath, argvPath }, deps);
  // Only a checkout can have a git identity worth reporting; an npm install is
  // unpacked files with no history, so skip the spawn entirely rather than
  // paying for a subprocess that we already know will fail.
  const gitDir = install.root ?? dirname(cliPath);
  const git =
    install.kind === INSTALL_KIND.NPM ? null : readGitIdentity(gitDir, deps);

  return {
    version,
    cliPath: resolve(cliPath),
    install,
    git,
    projectDir: resolve(projectDir),
  };
}

/**
 * Render a git identity as a single field value, e.g. `main @ a1b2c3d` or
 * `detached@a1b2c3d`.
 *
 * @param {{ branch: string|null, sha: string, detached: boolean }|null} git
 * @returns {string}
 */
export function formatGitIdentity(git) {
  if (!git) return "not a git working tree";
  return git.detached ? `detached@${git.sha}` : `${git.branch} @ ${git.sha}`;
}

/**
 * Render the identity record as human-readable lines.
 *
 * @param {ReturnType<typeof collectInstallIdentity>} info
 * @returns {string}
 */
export function formatInstallIdentity(info) {
  const install = info.install.root
    ? `${info.install.label} (${info.install.root})`
    : info.install.label;

  return [
    `n-dx ${info.version}`,
    `  cli      ${info.cliPath}`,
    `  install  ${install}`,
    `  git      ${formatGitIdentity(info.git)}`,
    `  project  ${info.projectDir}`,
  ].join("\n");
}
