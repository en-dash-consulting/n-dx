/**
 * Pure suite selection for scripts/run-all-tests.mjs.
 *
 * No git, no fs: callers pass the changed-file list and the workspace manifests
 * and get back which suites to run and why. Keeping it pure is what makes the
 * rules testable without running a suite.
 *
 * Suites are named by short label: `root`, plus each package's directory name.
 */

export const ROOT_LABEL = "root";

/** A change to any of these can alter every suite, so every suite runs. */
export const RUN_EVERYTHING_FILES = [
  "pnpm-lock.yaml",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "vitest.config.js",
  "scripts/run-all-tests.mjs",
  "scripts/run-vitest-bind-aware.mjs",
];

/** Instruction surfaces the root e2e tests assert on (drift, parity). */
const INSTRUCTION_EXACT = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  ".mcp.json",
  ".rex/workflow.md",
  ".rex/n-dx_workflow.md",
]);
const INSTRUCTION_PREFIXES = [".claude/", ".agents/", ".codex/", "packages/core/assistant-assets/"];

/** Machine-written state: never selects anything. */
const STATE_PREFIXES = [".rex/prd_tree/", ".hench/", ".sourcevision/"];

/** Directories whose changes always run the root suite. */
const ROOT_PREFIXES = ["scripts/", "tests/", ".github/"];

const isMarkdown = (file) => file.endsWith(".md");

function isInstructionSurface(file) {
  return INSTRUCTION_EXACT.has(file) || INSTRUCTION_PREFIXES.some((p) => file.startsWith(p));
}

/**
 * @typedef {object} Manifest
 * @property {string} dir  directory name under packages/
 * @property {string} name package name (`@n-dx/rex`)
 * @property {boolean} hasTest whether it defines a `test` script
 * @property {Record<string, string>} [dependencies]
 * @property {Record<string, string>} [devDependencies]
 */

/** Canonical labels, in run order: root first, then packages in manifest order. */
export function validLabels(manifests) {
  return [ROOT_LABEL, ...manifests.filter((m) => m.hasTest).map((m) => m.dir)];
}

/**
 * Resolve CLI tokens (`rex,web`, `@n-dx/rex`, `packages`, …) to canonical labels.
 * @param {string[]} tokens
 * @param {Manifest[]} manifests
 * @returns {{ labels: string[] } | { unknown: string[], valid: string[] }}
 */
export function resolveLabels(tokens, manifests) {
  const valid = validLabels(manifests);
  const packageLabels = valid.filter((l) => l !== ROOT_LABEL);
  const byName = new Map(manifests.filter((m) => m.hasTest).map((m) => [m.name, m.dir]));
  const wanted = new Set();
  const unknown = [];

  for (const raw of tokens.flatMap((t) => t.split(","))) {
    const token = raw.trim();
    if (!token) continue;
    if (token === "all") valid.forEach((l) => wanted.add(l));
    else if (token === "packages") packageLabels.forEach((l) => wanted.add(l));
    else if (valid.includes(token)) wanted.add(token);
    else if (byName.has(token)) wanted.add(byName.get(token));
    else unknown.push(token);
  }
  if (unknown.length > 0) return { unknown, valid };
  return { labels: valid.filter((l) => wanted.has(l)) };
}

/** Package dirs that depend on `dir`, transitively, via manifest dependencies. */
function dependentsOf(dir, manifests) {
  const nameOf = new Map(manifests.map((m) => [m.dir, m.name]));
  const found = [];
  const queue = [dir];
  const seen = new Set([dir]);
  while (queue.length > 0) {
    const targetName = nameOf.get(queue.shift());
    for (const m of manifests) {
      if (seen.has(m.dir)) continue;
      if (m.dependencies?.[targetName] !== undefined || m.devDependencies?.[targetName] !== undefined) {
        seen.add(m.dir);
        found.push(m.dir);
        queue.push(m.dir);
      }
    }
  }
  return found;
}

/**
 * @param {string[]} changedFiles repo-relative, forward slashes
 * @param {Manifest[]} manifests every workspace package, including those with no
 *   test script (core)
 * @returns {{ suites: string[], reasons: Record<string, string> }} suites in run order
 */
export function selectAffected(changedFiles, manifests) {
  const reasons = new Map();
  const mark = (label, why) => {
    if (!reasons.has(label)) reasons.set(label, why);
  };
  const dirs = new Set(manifests.map((m) => m.dir));
  const testable = validLabels(manifests);
  const finish = () => {
    const suites = testable.filter((l) => reasons.has(l));
    return { suites, reasons: Object.fromEntries(suites.map((l) => [l, reasons.get(l)])) };
  };

  const everything = changedFiles.find((f) => RUN_EVERYTHING_FILES.includes(f));
  if (everything) {
    testable.forEach((l) => mark(l, `${everything} changed (runs every suite)`));
    return finish();
  }

  /** A change to a package's own sources: its suite and every dependent's. */
  const markPackage = (dir, file) => {
    mark(dir, file);
    for (const dependent of dependentsOf(dir, manifests)) mark(dependent, `dependent of ${dir}`);
  };

  for (const file of changedFiles) {
    if (isInstructionSurface(file)) {
      mark(ROOT_LABEL, file);
      continue;
    }
    if (STATE_PREFIXES.some((p) => file.startsWith(p))) continue;

    const match = /^packages\/([^/]+)\/(.*)$/.exec(file);
    if (match && dirs.has(match[1])) {
      const [, dir, rest] = match;
      if (dir === "core") {
        // core has no suite of its own; its tests are the root suite.
        if (!isMarkdown(file)) mark(ROOT_LABEL, file);
      } else if (rest === "package.json") {
        markPackage(dir, file);
        mark(ROOT_LABEL, file);
      } else if (rest.startsWith("tests/")) {
        mark(dir, file);
      } else if (rest.startsWith("docs/") || isMarkdown(rest)) {
        // docs only: nothing to test
      } else {
        markPackage(dir, file);
        if (rest.startsWith("src/cli/")) mark(ROOT_LABEL, file);
      }
      continue;
    }

    if (isMarkdown(file) || file.startsWith("docs/")) continue;
    if (ROOT_PREFIXES.some((p) => file.startsWith(p)) || !file.includes("/")) mark(ROOT_LABEL, file);
  }
  return finish();
}

/**
 * Paths from `git status --porcelain -z --untracked-files=all`. A rename or copy
 * entry is followed by its source path as a separate NUL field; both count.
 */
export function parsePorcelainZ(output) {
  const fields = output.split("\0");
  const files = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) {
      const source = fields[++i];
      if (source) files.push(source);
    }
  }
  return files;
}
