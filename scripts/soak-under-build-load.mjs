/**
 * Run the full test suite repeatedly while the machine carries a concurrent
 * TypeScript build, and report each run's verdict.
 *
 * WHY THIS EXISTS. A suite that is green on an idle machine and red on a busy
 * one teaches people to disbelieve red. The clock-bound assertions this repo
 * used to carry were each fixed individually; this script is the closing check
 * that the suite as a whole no longer reads the machine's load as a defect.
 *
 * WHY THE LOAD IS NOT A LITERAL `pnpm build`. Three packages — rex, hench and
 * llm-client — do not set `"incremental": true`, so every `pnpm build` truncates
 * and rewrites all of their `dist/` output. The root e2e suite spawns exactly
 * those files (`packages/rex/dist/cli/index.js`, `packages/hench/dist/...`)
 * dozens of times per run. A build running against the same tree would hand a
 * test a half-written entry point, and the resulting SyntaxError says nothing
 * about clock-bound assertions — it is mutation of the system under test
 * wearing the costume of load.
 *
 * So the load does the build's WORK without touching the build's OUTPUT: the
 * same `tsc` invocations the package builds use, with `--outDir` redirected
 * under `.test-logs/load-build/` (gitignored) and `--incremental false` so the
 * compilers never coast on a `.tsbuildinfo`. Parse, typecheck, emit, sourcemaps
 * and declarations all happen; `dist/` is not opened for writing.
 *
 * The load is reported, not assumed. Each run prints how many compilations
 * finished alongside it, so a cycle count of 0 — a load that never actually
 * ran — is visible rather than silently turning the exercise into a plain
 * three-times-in-a-row suite run.
 *
 * Usage:
 *   node scripts/soak-under-build-load.mjs             # 3 runs, 2 load workers
 *   node scripts/soak-under-build-load.mjs --runs=1
 *   node scripts/soak-under-build-load.mjs --workers=4
 *
 * Exits non-zero if any run failed.
 */

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCli } from "../packages/core/win-spawn.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Where the load build's output goes.
 *
 * Deliberately OUTSIDE the repository, not merely outside `dist/`. The
 * architecture policy's `child_process` scanner walks the whole tree and skips
 * a fixed set of directory names; compiled copies of `exec.ts`, `routes-hench.ts`
 * and friends landing anywhere it reaches are reported as violations of a rule
 * their sources already satisfy. A scratch directory in the OS temp dir is
 * invisible to every repo-walking check, which is the property that matters —
 * the alternative was widening a policy's skip list to accommodate a dev script.
 */
const LOAD_OUT = join(tmpdir(), "ndx-soak-load-build");

/**
 * Packages compiled by the load, in the order `pnpm -r run build` reaches them.
 * `@n-dx/core` is absent because its build script is an `echo` — it is plain
 * JavaScript and contributes no compile work to imitate.
 */
const PACKAGES = ["llm-client", "rex", "sourcevision", "hench", "web"];

/**
 * Resolved from a package rather than the root: pnpm's store is not flat, so
 * `<root>/node_modules/typescript` does not exist — typescript is a
 * devDependency of each compiled package, and all five resolve the same copy.
 */
const TSC = createRequire(join(ROOT, "packages", "rex", "package.json"))
  .resolve("typescript/bin/tsc");

function flag(name, fallback) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
}

const RUNS = flag("runs", 3);
const WORKERS = flag("workers", 2);

/** Wall time as `4m 07s`, because a run's cost is read in minutes. */
function human(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

/**
 * Compile one package with its output redirected away from `dist/`.
 *
 * Resolves with the child's exit code rather than rejecting on a non-zero one:
 * a compile error in the tree under test should not abort the soak, it should
 * show up in the run's summary as a load that was not doing the work it claimed.
 */
function compileOnce(pkg, state) {
  return new Promise((resolve) => {
    const child = spawnCli(
      process.execPath,
      [
        TSC,
        "-p", join(ROOT, "packages", pkg, "tsconfig.json"),
        "--outDir", join(LOAD_OUT, pkg),
        // sourcevision and web set `"incremental": true`; left on, the second
        // cycle onward would find everything up to date and do no work at all.
        "--incremental", "false",
      ],
      { cwd: ROOT, stdio: "ignore" },
    );
    state.children.add(child);
    child.on("close", (code) => {
      state.children.delete(child);
      resolve(code ?? 0);
    });
    child.on("error", () => {
      state.children.delete(child);
      resolve(-1);
    });
  });
}

/**
 * Keep compiling until `state.stop` is set.
 *
 * Each worker starts at a different package so two workers are not usually
 * compiling the same one at the same moment — the point is to occupy cores,
 * not to measure any single package.
 */
async function loadWorker(index, state) {
  let cursor = index % PACKAGES.length;
  while (!state.stop) {
    const code = await compileOnce(PACKAGES[cursor], state);
    if (state.stop) break;
    state.cycles += 1;
    if (code !== 0) state.failedCycles += 1;
    cursor = (cursor + 1) % PACKAGES.length;
  }
}

/**
 * Kill every in-flight compiler.
 *
 * On win32 `spawnCli` returns a cmd.exe wrapper, so `child.kill()` would reap
 * the shell and orphan the `node`/`tsc` underneath it — a stray compiler still
 * eating a core through the NEXT run would quietly corrupt this script's whole
 * premise. `taskkill /T` takes the tree.
 */
function stopLoad(state) {
  state.stop = true;
  for (const child of state.children) {
    if (process.platform === "win32" && child.pid) {
      spawnCli("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGKILL");
    }
  }
}

/** Run `pnpm test` to completion, streaming its output. */
function runSuite() {
  return new Promise((resolve) => {
    const child = spawnCli("pnpm", ["test"], { cwd: ROOT, stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

mkdirSync(LOAD_OUT, { recursive: true });

const results = [];

for (let run = 1; run <= RUNS; run++) {
  const state = { stop: false, cycles: 0, failedCycles: 0, children: new Set() };
  const workers = Array.from({ length: WORKERS }, (_, i) => loadWorker(i, state));

  console.log(`\n=== run ${run}/${RUNS} — suite under ${WORKERS} concurrent tsc workers ===\n`);
  const startedAt = Date.now();
  const exitCode = await runSuite();
  const elapsed = Date.now() - startedAt;

  stopLoad(state);
  await Promise.all(workers);

  results.push({ run, exitCode, elapsed, cycles: state.cycles, failedCycles: state.failedCycles });
  console.log(
    `\n=== run ${run}/${RUNS}: ${exitCode === 0 ? "PASS" : `FAIL (exit ${exitCode})`} ` +
      `in ${human(elapsed)} — ${state.cycles} compilations alongside it ` +
      `(${state.failedCycles} non-zero) ===\n`,
  );
}

console.log("\n──────── soak summary ────────");
for (const r of results) {
  console.log(
    `run ${r.run}: ${r.exitCode === 0 ? "PASS" : `FAIL (exit ${r.exitCode})`}  ` +
      `${human(r.elapsed)}  ${r.cycles} compile cycles (${r.failedCycles} non-zero)`,
  );
}

const failed = results.filter((r) => r.exitCode !== 0);
console.log(
  failed.length === 0
    ? `\nAll ${RUNS} runs passed under concurrent build load.`
    : `\n${failed.length}/${RUNS} runs failed. File a task for the failure — do not rerun until green.`,
);
process.exit(failed.length === 0 ? 0 : 1);
