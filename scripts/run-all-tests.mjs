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
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, createWriteStream } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCli } from "../packages/core/win-spawn.js";

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
    // behaviour `execFileSync` used to give us by throwing.
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

/** Workspace packages that define a `test` script, in a stable order. */
function discoverPackageSuites() {
  const packagesDir = join(ROOT, "packages");
  if (!existsSync(packagesDir)) return [];

  const suites = [];
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
    if (!manifest?.scripts?.test || !manifest.name) continue;

    suites.push({
      label: manifest.name,
      // Delegated to pnpm so each package keeps its own test script semantics
      // (web and sourcevision wrap vitest in the bind-aware runner). pnpm is a
      // .cmd shim on Windows, hence spawnCli rather than a raw spawn.
      binary: "pnpm",
      args: ["--filter", manifest.name, "run", "test"],
    });
  }
  return suites;
}

/** The root-level tests/** suites, which live outside any package. */
function rootSuite() {
  return {
    label: "root (tests/**)",
    // process.execPath avoids the shim question entirely for this one.
    binary: process.execPath,
    args: [resolve(ROOT, "scripts/run-vitest-bind-aware.mjs"), "root"],
  };
}

const scope = process.argv[2] ?? "all";
if (!["all", "root", "packages"].includes(scope)) {
  console.error(`Unknown scope "${scope}". Expected: all | root | packages`);
  process.exit(2);
}

const suites = [
  ...(scope === "packages" ? [] : [rootSuite()]),
  ...(scope === "root" ? [] : discoverPackageSuites()),
];

mkdirSync(LOG_DIR, { recursive: true });

const results = [];
for (const suite of suites) {
  console.log(`\n──────── ${suite.label} ────────\n`);
  // Keep going even when one fails: the whole point is that one red suite must
  // not hide the rest.
  const ok = await runSuite(suite.label, suite.binary, suite.args);
  results.push({ label: suite.label, ok, logPath: logFileFor(suite.label) });
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

process.exit(failed.length > 0 ? 1 : 0);
