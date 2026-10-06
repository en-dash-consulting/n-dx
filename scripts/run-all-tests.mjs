/**
 * Run every suite in the monorepo and report ALL of their results.
 *
 * WHY THIS EXISTS. `pnpm test` used to be:
 *
 *     node scripts/run-vitest-bind-aware.mjs root && pnpm -r run test
 *
 * which masks failures twice over. `&&` means a failing root suite skips every
 * package. And `pnpm -r run` bails on the first failing package, so with rex's
 * load-sensitive tests failing, hench and web — which depend on rex and are
 * therefore ordered after it — never executed at all. Their result lines were
 * simply absent from the output, which reads as "nothing to report" rather than
 * "never ran". That hid 32 failing hench tests and 7 failing web tests.
 *
 * `pnpm -r --no-bail run test` is NOT the fix: pnpm documents --no-bail as
 * exiting 0 even when a script fails, which would turn a red suite green. That
 * is worse than the masking, because today's exit code is at least honest.
 *
 * So this runner executes each suite independently, never short-circuits, prints
 * a per-suite summary, and exits non-zero if ANY suite failed.
 *
 * It also keeps every suite's output in `.test-logs/`. That is the other half
 * of the same problem: a result line tells you rex failed, and by the time
 * anyone looks the assertion that failed is gone with the scrollback. See
 * {@link runSuite}.
 *
 * Usage:
 *   node scripts/run-all-tests.mjs            # root + every package
 *   node scripts/run-all-tests.mjs root       # root suites only
 *   node scripts/run-all-tests.mjs packages   # workspace packages only
 *   node scripts/run-all-tests.mjs root-policy # the six static root policy tests (~2 s)
 *   node scripts/run-all-tests.mjs rex,web   # named suites (root, or a package dir name)
 *   node scripts/run-all-tests.mjs affected <baseRef>   # only suites the change touches
 *   add --list to print the selection and exit without running anything
 *
 * Selection rules live in scripts/lib/select-suites.mjs. Besides the human
 * summary, the run prints `test-gate: …` lines (selected, reasons, failed) for
 * hench to parse.
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, createWriteStream } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSyncCli, spawnCli } from "../packages/core/win-spawn.js";
import { ROOT_LABEL, ROOT_POLICY_LABEL, ROOT_POLICY_TEST_FILES, parsePorcelainZ, resolveLabels, selectAffected, validLabels } from "./lib/select-suites.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Where each suite's output is kept.
 *
 * Gitignored, and deliberately not `.run-logs/` — hench already owns that for
 * per-run agent logs, and two unrelated things in one directory is how you end
 * up unable to tell which produced a file.
 */
const LOG_DIR = join(ROOT, ".test-logs");

/** `@n-dx/rex` -> `n-dx-rex`, `root (tests/**)` -> `root-tests`. */
function logFileFor(label) {
  const slug = label.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return join(LOG_DIR, `${slug}.log`);
}

/**
 * Run one suite, streaming its output to the terminal and to a file at once.
 *
 * WHY THE FILE. An intermittently failing suite is only diagnosable if its
 * output outlives the terminal. The rex suite has failed four times under this
 * runner and passed standalone every time afterwards, and the failing assertion
 * has never once been seen — each time it was lost to scrollback, because the
 * only copy went to a terminal nobody was redirecting. Asking the operator to
 * remember `> run.log 2>&1` has now failed four times, so the runner keeps it.
 *
 * WHY STREAMED RATHER THAN BUFFERED. Suites run for 25s and up. Collecting the
 * output and printing it at exit would make every run look hung, so each chunk
 * is written through as it arrives and copied to the log on the way past.
 *
 * WHY stdin IS INHERITED. So Ctrl-C still reaches the child the way it did
 * under `stdio: "inherit"`, and anything that prompts still can.
 *
 * @returns {Promise<boolean>} true when the suite passed.
 */
function runSuite(label, binary, args) {
  return new Promise((resolvePromise) => {
    const logPath = logFileFor(label);
    const log = createWriteStream(logPath);
    const child = spawnCli(binary, args, {
      cwd: ROOT,
      stdio: ["inherit", "pipe", "pipe"],
    });

    for (const [stream, sink] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      stream?.on("data", (chunk) => {
        sink.write(chunk);
        log.write(chunk);
      });
    }

    // A spawn that never starts is a failed suite, not an absent one — the
    // behaviour `execFileSyncCli` gives us by throwing.
    child.on("error", (err) => {
      const message = `\nFailed to start ${label}: ${err.message}\n`;
      process.stderr.write(message);
      log.end(message);
      resolvePromise(false);
    });

    child.on("close", (code) => {
      log.end();
      resolvePromise(code === 0);
    });
  });
}

/** Every workspace package manifest, in a stable order, with its directory name. */
function readManifests() {
  const packagesDir = join(ROOT, "packages");
  if (!existsSync(packagesDir)) return [];

  const manifests = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      continue;
    }
    if (!manifest?.name) continue;
    manifests.push({
      dir: entry.name,
      name: manifest.name,
      hasTest: Boolean(manifest.scripts?.test),
      dependencies: manifest.dependencies,
      devDependencies: manifest.devDependencies,
    });
  }
  return manifests;
}

/** The runnable suite for a canonical short label. */
function suiteFor(label, manifests) {
  if (label === ROOT_LABEL) {
    // The root-level tests/** suites, which live outside any package.
    return {
      short: label,
      label: "root (tests/**)",
      // process.execPath avoids the shim question entirely for this one.
      binary: process.execPath,
      args: [resolve(ROOT, "scripts/run-vitest-bind-aware.mjs"), "root"],
    };
  }
  if (label === ROOT_POLICY_LABEL) {
    // Same runner and root vitest config as `root`, restricted to the policy files.
    return {
      short: label,
      label: "root policy (static)",
      binary: process.execPath,
      args: [resolve(ROOT, "scripts/run-vitest-bind-aware.mjs"), "root", ...ROOT_POLICY_TEST_FILES],
    };
  }
  const { name } = manifests.find((m) => m.dir === label);
  return {
    short: label,
    label: name,
    // Delegated to pnpm so each package keeps its own test script semantics
    // (web and sourcevision wrap vitest in the bind-aware runner). pnpm is a
    // .cmd shim on Windows, hence spawnCli rather than a raw spawn.
    binary: "pnpm",
    args: ["--filter", name, "run", "test"],
  };
}

function git(gitArgs) {
  return execFileSyncCli("git", gitArgs, { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Files changed since `baseRef`, plus uncommitted and untracked ones; null if git cannot say. */
function changedFilesSince(baseRef) {
  try {
    git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
    const committed = git(["diff", "--name-only", `${baseRef}...HEAD`]).split("\n").filter(Boolean);
    const working = parsePorcelainZ(git(["status", "--porcelain", "-z", "--untracked-files=all"]));
    return [...new Set([...committed, ...working])];
  } catch (err) {
    console.warn(`Cannot compute changes since "${baseRef}": ${String(err.message).split("\n")[0]}`);
    return null;
  }
}

const manifests = readManifests();
const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const positional = args.filter((a) => a !== "--list");

/** @type {string[]} */
let labels;
/** @type {Record<string, string> | null} */
let reasons = null;

if (positional[0] === "affected") {
  const baseRef = positional[1];
  if (!baseRef) {
    console.error("Usage: run-all-tests.mjs affected <baseRef>");
    process.exit(2);
  }
  const changed = changedFilesSince(baseRef);
  if (changed === null) {
    // Never select nothing by mistake: an unknown change set means everything.
    console.warn("WARNING: falling back to running ALL suites.");
    labels = validLabels(manifests).filter((l) => l !== ROOT_POLICY_LABEL);
  } else {
    ({ suites: labels, reasons } = selectAffected(changed, manifests));
  }
} else {
  const resolved = resolveLabels(positional.length > 0 ? positional : ["all"], manifests);
  if (resolved.unknown) {
    console.error(
      `Unknown suite "${resolved.unknown.join('", "')}". ` +
      `Valid: all | packages | ${resolved.valid.join(" | ")} ` +
      `(comma- or space-separated; @n-dx/<name> also accepted), or: affected <baseRef>`,
    );
    process.exit(2);
  }
  labels = resolved.labels;
}

// Machine-readable protocol lines: hench parses these.
console.log(`test-gate: selected-suites=${labels.join(",")}`);
for (const label of labels) {
  if (reasons?.[label]) console.log(`test-gate: reason ${label}: ${reasons[label]}`);
}

if (listOnly) process.exit(0);

const suites = labels.map((label) => suiteFor(label, manifests));
if (suites.length === 0) console.log("No suites affected by this change — nothing to run.");

mkdirSync(LOG_DIR, { recursive: true });

const results = [];
for (const suite of suites) {
  console.log(`\n──────── ${suite.label} ────────\n`);
  // Keep going even when one fails: the whole point is that one red suite must
  // not hide the rest.
  const ok = await runSuite(suite.label, suite.binary, suite.args);
  results.push({ label: suite.label, short: suite.short, ok, logPath: logFileFor(suite.label) });
}

const failed = results.filter((r) => !r.ok);
const width = Math.max(...results.map((r) => r.label.length), 0);

console.log(`\n──────── summary ────────\n`);
for (const { label, ok, logPath } of results) {
  // The path only earns its line on a failure — that is when someone needs it,
  // and printing six of them on a green run is noise that trains people to
  // skip the summary.
  const where = ok ? "" : `  → ${relative(ROOT, logPath)}`;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(width)}${where}`);
}
console.log(
  `\n${results.length - failed.length}/${results.length} suites passed` +
  (failed.length > 0 ? ` — failed: ${failed.map((f) => f.label).join(", ")}` : ""),
);
console.log(`test-gate: failed-suites=${failed.map((f) => f.short).join(",")}`);

process.exit(failed.length > 0 ? 1 : 0);
