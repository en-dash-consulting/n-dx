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

/**
 * Label of the static root policy tests that read package sources and tests.
 * `root` includes them, so the two are never run together.
 */
export const ROOT_POLICY_LABEL = "root-policy";

/**
 * Label of the root tests that compare a package source against a checked-in
 * artifact generated from it. Also a subset of `root`.
 */
export const ROOT_DRIFT_LABEL = "root-drift";

/**
 * The root tests that police package sources and tests (spawn-only, gateways,
 * shell/wall-clock/layout inventories, obfuscation). About 2 s together. A
 * package-only change still has to run them: without them only CI catches a
 * violation. A unit test fails if a listed file is missing.
 */
export const ROOT_POLICY_TEST_FILES = [
  "tests/e2e/architecture-policy.test.js",
  "tests/e2e/domain-isolation.test.js",
  "tests/e2e/shell-spawn-inventory-policy.test.js",
  "tests/e2e/wall-clock-inventory-policy.test.js",
  "tests/e2e/layout-literal-policy.test.js",
  "tests/e2e/obfuscated-code-policy.test.js",
];

/**
 * The root tests that read a package source and fail when a checked-in artifact
 * generated from it has not been regenerated: the prompt census registry, the
 * bundled iso-map skill, the dashboard's hench-config gate against hench's own
 * schema, and the generated CLAUDE.md/AGENTS.md pair.
 *
 * They are a separate label from {@link ROOT_POLICY_TEST_FILES} rather than
 * more entries in it because they cost about 12 s against that set's 2 s —
 * six times the whole policy suite. Folding them in would have made
 * `root-policy` a twelve-second thing still documented as a two-second one, and
 * the cheap gate is worth being able to run on its own. Both are selected by
 * the same condition (a change under `packages/<dir>/src/`), so a source change
 * runs both; `root` supersedes both.
 *
 * Without them a change to a package source outside `src/cli/` never ran a
 * drift test at the gate: the gate went green, hench committed, and CI went red
 * after the run (#546 review finding F1).
 */
export const ROOT_DRIFT_TEST_FILES = [
  "tests/e2e/prompt-census.test.js",
  "tests/e2e/iso-skill-drift.test.js",
  "tests/e2e/hench-config-gate-contract.test.js",
  "tests/e2e/instruction-alignment.test.js",
];

/**
 * Every label that runs a subset of `root`'s files, mapped to those files, in
 * run order. `root` supersedes all of them, and `all` / `packages` leave them
 * out. A unit test fails if a listed file is missing or appears twice.
 */
export const ROOT_SUBSET_TEST_FILES = {
  [ROOT_POLICY_LABEL]: ROOT_POLICY_TEST_FILES,
  [ROOT_DRIFT_LABEL]: ROOT_DRIFT_TEST_FILES,
};

/** The root-subset labels, in run order. */
export const ROOT_SUBSET_LABELS = Object.keys(ROOT_SUBSET_TEST_FILES);

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

/**
 * Canonical labels, in run order: root, the root subsets, then packages in
 * manifest order. `all` and run-everything selections leave out the subsets,
 * which root already covers.
 */
export function validLabels(manifests) {
  return [ROOT_LABEL, ...ROOT_SUBSET_LABELS, ...manifests.filter((m) => m.hasTest).map((m) => m.dir)];
}

/**
 * Resolve CLI tokens (`rex,web`, `@n-dx/rex`, `packages`, …) to canonical labels.
 * @param {string[]} tokens
 * @param {Manifest[]} manifests
 * @returns {{ labels: string[] } | { unknown: string[], valid: string[] }}
 */
export function resolveLabels(tokens, manifests) {
  const valid = validLabels(manifests);
  const packageLabels = valid.filter((l) => l !== ROOT_LABEL && !ROOT_SUBSET_LABELS.includes(l));
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
  // root runs every subset's files already; never run them twice.
  if (wanted.has(ROOT_LABEL)) ROOT_SUBSET_LABELS.forEach((l) => wanted.delete(l));
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
    if (reasons.has(ROOT_LABEL)) ROOT_SUBSET_LABELS.forEach((l) => reasons.delete(l));
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
        // Policy only: a test file is policed (shell/wall-clock inventories),
        // but no checked-in artifact is generated from one, so not root-drift.
        mark(ROOT_POLICY_LABEL, file);
      } else if (rest.startsWith("docs/") || isMarkdown(rest)) {
        // docs only: nothing to test
      } else {
        markPackage(dir, file);
        if (rest.startsWith("src/")) {
          // A source change can violate a static policy and can leave a
          // generated artifact stale, so both root subsets run.
          mark(ROOT_POLICY_LABEL, file);
          mark(ROOT_DRIFT_LABEL, file);
        }
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
