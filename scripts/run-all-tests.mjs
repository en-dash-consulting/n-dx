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
 * Usage:
 *   node scripts/run-all-tests.mjs            # root + every package
 *   node scripts/run-all-tests.mjs root       # root suites only
 *   node scripts/run-all-tests.mjs packages   # workspace packages only
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSyncCli } from "../packages/core/win-spawn.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

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
      // .cmd shim on Windows, hence execFileSyncCli rather than a raw spawn.
      run: () => execFileSyncCli("pnpm", ["--filter", manifest.name, "run", "test"], {
        cwd: ROOT,
        stdio: "inherit",
      }),
    });
  }
  return suites;
}

/** The root-level tests/** suites, which live outside any package. */
function rootSuite() {
  return {
    label: "root (tests/**)",
    // process.execPath avoids the shim question entirely for this one.
    run: () => execFileSyncCli(process.execPath, [resolve(ROOT, "scripts/run-vitest-bind-aware.mjs"), "root"], {
      cwd: ROOT,
      stdio: "inherit",
    }),
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

const results = [];
for (const suite of suites) {
  console.log(`\n──────── ${suite.label} ────────\n`);
  try {
    suite.run();
    results.push({ label: suite.label, ok: true });
  } catch {
    // Keep going: the whole point is that one red suite must not hide the rest.
    results.push({ label: suite.label, ok: false });
  }
}

const failed = results.filter((r) => !r.ok);
const width = Math.max(...results.map((r) => r.label.length), 0);

console.log(`\n──────── summary ────────\n`);
for (const { label, ok } of results) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(width)}`);
}
console.log(
  `\n${results.length - failed.length}/${results.length} suites passed` +
  (failed.length > 0 ? ` — failed: ${failed.map((f) => f.label).join(", ")}` : ""),
);

process.exit(failed.length > 0 ? 1 : 0);
