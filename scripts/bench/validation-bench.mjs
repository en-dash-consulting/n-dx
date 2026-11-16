/**
 * Validation benchmark: replay the affected test gate under up to eight
 * settings on ONE commit, so only the worker cap, the host slot and the
 * concurrency differ.
 *
 *   node scripts/bench/validation-bench.mjs --out <dir> [--cases A,B,C,D (any of A–H)]
 *     [--fixtures hench,llm-client,web] [--repeat N] [--concurrency N]
 *     [--timeout-min N] [--dry-run] [--keep]
 *
 * Cases and fixtures are defined in ./lib/plan.mjs; TESTING.md ("Validation
 * benchmark") covers running it and reading the summary.
 *
 * Setup, outside the timed window: detached worktrees of HEAD under
 * `~/.cache/ndx-bench/<run id>/`, `pnpm install` and `pnpm build` once each.
 * Per fixture, each worktree gets one commit appending a comment to the
 * fixture's files, and the packages those files belong to are rebuilt, so no
 * measured run pays a stale-dist rebuild. Each measured run is
 * `node scripts/run-all-tests.mjs affected <HEAD>` in a bench worktree.
 *
 * A case whose `slot` flag is set (D, E, G, H) takes the host slot around
 * each run through hench's built slot module, the way a hench gate does, and
 * passes its token on; the runner finds the token and runs inside that slot
 * (nesting rule) instead of acquiring again. The other cases never touch the
 * slot and pass `--no-slot`, the pre-wave-1 behaviour (./lib/batch.mjs).
 *
 * The idle check runs once, at start: a run started later is not detected.
 *
 * Every worktree it created is removed on exit, on SIGINT/SIGTERM and on
 * error, unless `--keep`. A first Ctrl-C sends SIGTERM to the running suites
 * and SIGKILL 10 s later; a second sends SIGKILL at once. The batch running at
 * the time is not recorded.
 */

import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, homedir, loadavg, release, totalmem, version as osVersion } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { execFileSyncCli, spawnCli } from "../../packages/core/win-spawn.js";
import { readWorkspaceManifests } from "../lib/workspace-manifests.mjs";
import {
  BenchUsageError,
  CASES,
  COOLDOWN_MS,
  FIXTURES,
  IDLE_WARNING,
  USAGE,
  buildPlan,
  formatPlan,
  parseBenchArgs,
  runnerArgs,
  slotModuleMissingMessage,
} from "./lib/plan.mjs";
import { runBatch } from "./lib/batch.mjs";
import {
  ancestorPids,
  findBusyProcesses,
  parseProcMeminfo,
  parseProcVmstat,
  parsePs,
  parseSwapUsage,
  parseVmStat,
  treeRssBytes,
} from "./lib/samples.mjs";
import { createLineCollector, parseGateOutput } from "./lib/gate-output.mjs";
import { renderSummaryMarkdown, summarize } from "./lib/summary.mjs";
import { createSignalHandler, sleep, throwIfStopped } from "./lib/stop.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SAMPLE_INTERVAL_MS = 2_000;
const KILL_GRACE_MS = 10_000;
const HENCH_SLOT_MODULE = join(ROOT, "packages/hench/dist/process/validation-slot.js");
const HENCH_SLOT_DIR_MODULE = join(ROOT, "packages/hench/dist/process/validation-slot-dir.js");

function git(args, cwd = ROOT) {
  return execFileSyncCli("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** The worktree this script runs from and the main checkout: `--out` stays out of both. */
function repositoryRoots() {
  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return [...new Set([ROOT, dirname(commonDir)])];
}

// ---------------------------------------------------------------------------
// State shared with the signal handlers
// ---------------------------------------------------------------------------

/** Worktrees this run created, removed on any exit. */
const createdWorktrees = [];
/** Running children, each mapped to whether it leads its own process group (measured runs do). */
const activeChildren = new Map();
const abort = new AbortController();
let keepWorktrees = false;
let cleanedUp = false;

/** Signal a child, and its whole tree when it leads a process group. */
function killTree(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (activeChildren.get(child)) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (err) {
    // ESRCH: the group exited between the check and the kill.
    if (err.code !== "ESRCH") throw err;
  }
}

/** Remove every worktree this run created. Synchronous so the `exit` handler can run it. */
function removeWorktrees() {
  if (cleanedUp) return;
  cleanedUp = true;
  if (keepWorktrees) {
    if (createdWorktrees.length > 0) console.log(`Kept bench worktrees (--keep):\n  ${createdWorktrees.join("\n  ")}`);
    return;
  }
  for (const path of createdWorktrees) {
    try {
      git(["worktree", "remove", "--force", path]);
    } catch (err) {
      console.error(`Could not remove bench worktree ${path}: ${String(err.message).split("\n")[0]}`);
    }
  }
  try {
    git(["worktree", "prune"]);
  } catch (err) {
    console.error(`git worktree prune failed: ${String(err.message).split("\n")[0]}`);
  }
  if (createdWorktrees.length > 0) console.log(`Removed ${createdWorktrees.length} bench worktree(s).`);
}

const onSignal = createSignalHandler({ abort, children: () => activeChildren.keys(), killTree, graceMs: KILL_GRACE_MS });

// ---------------------------------------------------------------------------
// Child processes
// ---------------------------------------------------------------------------

/** Run a setup command, its output appended to `logPath`; rejects on a non-zero exit. */
function runLogged(binary, args, { cwd, logPath, env = process.env }) {
  appendFileSync(logPath, `\n$ ${binary} ${args.join(" ")}   (in ${cwd})\n`);
  return new Promise((resolvePromise, reject) => {
    const child = spawnCli(binary, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    activeChildren.set(child, false);
    child.stdout.on("data", (chunk) => appendFileSync(logPath, chunk));
    child.stderr.on("data", (chunk) => appendFileSync(logPath, chunk));
    child.on("error", (err) => {
      activeChildren.delete(child);
      reject(err);
    });
    child.on("close", (code, signal) => {
      activeChildren.delete(child);
      if (code === 0) resolvePromise();
      else reject(new Error(`${binary} ${args.join(" ")} exited ${code ?? signal} in ${cwd}; see ${logPath}`));
    });
  });
}

function throwIfAborted() {
  throwIfStopped(abort.signal);
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

/** A short command's stdout; rejects on a non-zero exit. */
function capture(binary, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnCli(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf-8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${binary} exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function processTable() {
  return parsePs(await capture("ps", ["-A", "-o", "pid=,ppid=,rss=,args="]));
}

/** Refuse to start beside other test load; returns the reasons, empty when clear. */
async function preflightProblems() {
  const problems = [];
  const rows = await processTable();
  for (const busy of findBusyProcesses(rows, ancestorPids(rows, process.pid))) {
    problems.push(`${busy.reason} is running (pid ${busy.pid}): ${busy.command.slice(0, 160)}`);
  }
  const load = loadavg()[0];
  const cores = cpus().length;
  if (load > cores) problems.push(`the 1-minute load average is ${load.toFixed(2)}, above the core count (${cores})`);
  return problems;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

async function readMemory() {
  if (process.platform === "darwin") {
    const [vm, swap] = await Promise.all([capture("vm_stat", []), capture("sysctl", ["vm.swapusage"])]);
    const parsed = parseVmStat(vm);
    return { freeBytes: parsed.freeBytes, swapUsedBytes: parseSwapUsage(swap), pageouts: parsed.pageouts };
  }
  if (process.platform === "linux") {
    const mem = parseProcMeminfo(readFileSync("/proc/meminfo", "utf-8"));
    return { freeBytes: mem.freeBytes, swapUsedBytes: mem.swapUsedBytes, pageouts: parseProcVmstat(readFileSync("/proc/vmstat", "utf-8")) };
  }
  return { freeBytes: null, swapUsedBytes: null, pageouts: null };
}

/** Samples every 2 s while a batch is active; each reading that fails is recorded as null. */
function startSampler(samplesPath) {
  let batchId = null;
  let busy = false;
  const tick = async () => {
    if (batchId === null || busy) return;
    busy = true;
    const sample = { t: Date.now(), batchId, load1: loadavg()[0], freeBytes: null, swapUsedBytes: null, pageouts: null, rssBytes: null };
    try {
      try {
        Object.assign(sample, await readMemory());
      } catch (err) {
        sample.error = `memory: ${err.message}`;
      }
      try {
        const roots = [...activeChildren.keys()].map((c) => c.pid).filter(Boolean);
        sample.rssBytes = treeRssBytes(await processTable(), roots);
      } catch (err) {
        sample.error = `${sample.error ? `${sample.error}; ` : ""}ps: ${err.message}`;
      }
      appendFileSync(samplesPath, `${JSON.stringify(sample)}\n`);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => {
    tick().catch((err) => console.error(`WARNING: could not record a sample: ${err.message}`));
  }, SAMPLE_INTERVAL_MS);
  return {
    begin(id) {
      batchId = id;
      return tick();
    },
    end() {
      batchId = null;
    },
    stop() {
      clearInterval(timer);
    },
  };
}

// ---------------------------------------------------------------------------
// Worktrees and fixtures
// ---------------------------------------------------------------------------

async function createWorktree(path, base, logPath) {
  mkdirSync(dirname(path), { recursive: true });
  await runLogged("git", ["worktree", "add", "--detach", path, base], { cwd: ROOT, logPath });
  createdWorktrees.push(path);
  try {
    await runLogged("pnpm", ["install", "--frozen-lockfile", "--offline"], { cwd: path, logPath });
  } catch (err) {
    throwIfAborted();
    appendFileSync(logPath, `Offline install failed (${err.message}); retrying online.\n`);
    await runLogged("pnpm", ["install", "--frozen-lockfile"], { cwd: path, logPath });
  }
  await runLogged("pnpm", ["build"], { cwd: path, logPath });
}

const COMMENT = "ndx validation benchmark fixture: this comment only changes the path set the gate selects from";

function commentFor(file) {
  if (/\.(?:md|html)$/.test(file)) return `\n<!-- ${COMMENT} -->\n`;
  if (/\.(?:css)$/.test(file)) return `\n/* ${COMMENT} */\n`;
  return `\n// ${COMMENT}\n`;
}

/** Reset a worktree to `base`, commit the fixture on top, and build the packages it touches. */
async function applyFixture(path, base, fixtureName, logPath) {
  await runLogged("git", ["reset", "--hard", "-q", base], { cwd: path, logPath });
  const { files } = FIXTURES[fixtureName];
  for (const file of files) appendFileSync(join(path, file), commentFor(file));
  await runLogged("git", ["add", "--", ...files], { cwd: path, logPath });
  await runLogged(
    "git",
    ["-c", "user.name=ndx-bench", "-c", "user.email=ndx-bench@localhost", "commit", "--no-verify", "-q", "-m", `bench fixture: ${fixtureName}`],
    { cwd: path, logPath },
  );
  const packages = [...new Set(files.map((f) => /^packages\/([^/]+)\/src\//.exec(f)?.[1]).filter(Boolean))];
  if (packages.length > 0) {
    await runLogged("pnpm", [...packages.flatMap((p) => ["--filter", `./packages/${p}`]), "run", "build"], { cwd: path, logPath });
  }
}

// ---------------------------------------------------------------------------
// Measured runs
// ---------------------------------------------------------------------------

/**
 * Spawn one measured gate run for `runBatch`. A slot case's `lease` is held
 * already; its token is in `env`, so the runner runs nested inside it.
 */
async function launchRun({ batch, worktree, runKey, env, lease, base, out, timeoutMs }) {
  const logPath = join(out, "logs", `${runKey}.log`);
  rmSync(join(worktree, ".test-logs"), { recursive: true, force: true });

  const collector = createLineCollector();
  const result = await new Promise((resolvePromise) => {
    const child = spawnCli(process.execPath, runnerArgs(batch.caseId, base), {
      cwd: worktree,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so a timeout or Ctrl-C stops the whole tree.
      detached: process.platform !== "win32",
    });
    activeChildren.set(child, process.platform !== "win32");
    if (lease && child.pid) {
      lease.recordChild(child.pid, { group: process.platform !== "win32" }).catch((err) => {
        console.error(`WARNING: could not record run ${runKey} in the validation slot: ${err.message}`);
      });
    }
    let timedOut = false;
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, "SIGTERM");
      killTimer = setTimeout(() => killTree(child, "SIGKILL"), KILL_GRACE_MS);
    }, timeoutMs);
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf-8");
      stream.on("data", (chunk) => {
        collector.push(chunk, Date.now());
        appendFileSync(logPath, chunk);
      });
    }
    child.on("error", (err) => {
      appendFileSync(logPath, `\nFailed to start the runner: ${err.message}\n`);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      activeChildren.delete(child);
      collector.flush(Date.now());
      resolvePromise({ exitCode: code, signal, timedOut });
    });
  });
  const gate = parseGateOutput(collector.lines);
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    selectedSuites: gate.selectedSuites,
    failedSuites: gate.failedSuites,
    staleDist: gate.staleDist,
    suites: gate.suites,
    testTimeouts: gate.testTimeouts,
    log: logPath,
  };
}

/** Copy a failed run's `.test-logs/` into `out`; done after the batch, outside the timed window and the slot. */
function keepTestLogs(record, worktree, out) {
  if (record.exitCode === 0 || !existsSync(join(worktree, ".test-logs"))) return;
  const kept = join(out, "logs", `${record.caseId}-${record.fixture}-r${record.repeat}-w${record.worker}-test-logs`);
  cpSync(join(worktree, ".test-logs"), kept, { recursive: true });
  record.testLogs = kept;
}

async function loadSlotApi(slotCases) {
  if (!existsSync(HENCH_SLOT_MODULE) || !existsSync(HENCH_SLOT_DIR_MODULE)) {
    throw new BenchUsageError(slotModuleMissingMessage(slotCases, HENCH_SLOT_MODULE));
  }
  const slot = await import(pathToFileURL(HENCH_SLOT_MODULE).href);
  const { resolveValidationSlotDir } = await import(pathToFileURL(HENCH_SLOT_DIR_MODULE).href);
  return { acquireValidationSlot: slot.acquireValidationSlot, slotDir: resolveValidationSlotDir(process.env) };
}

function machineDescription() {
  const cpu = cpus();
  return `${cpu.length} cores (${cpu[0]?.model ?? "unknown CPU"}), ${(totalmem() / 1024 ** 3).toFixed(0)} GiB RAM, ` +
    `${process.platform} ${release()} (${osVersion()}), node ${process.version}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseBenchArgs(process.argv.slice(2), { repoRoots: repositoryRoots() });
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const plan = buildPlan(options, {
    manifests: readWorkspaceManifests(ROOT),
    fileExists: (rel) => existsSync(join(ROOT, rel)),
  });
  if (options.dryRun) {
    console.log(formatPlan(plan, options));
    return 0;
  }
  if (process.platform === "win32") throw new BenchUsageError("The benchmark samples with ps and runs on macOS and Linux only.");

  const problems = await preflightProblems();
  if (problems.length > 0) {
    console.error(`Refusing to start: the benchmark needs an otherwise idle machine.\n  - ${problems.join("\n  - ")}`);
    return 1;
  }
  const out = options.out;
  if (existsSync(join(out, "runs.jsonl"))) throw new BenchUsageError(`${out} already holds a benchmark (runs.jsonl); choose another --out.`);
  const slotCases = options.cases.filter((c) => CASES[c].slot);
  const slotApi = slotCases.length > 0 ? await loadSlotApi(slotCases) : null;

  keepWorktrees = options.keep;
  mkdirSync(join(out, "logs"), { recursive: true });
  const base = git(["rev-parse", "HEAD"]);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const benchDir = join(homedir(), ".cache", "ndx-bench", runId);
  const setupLog = join(out, "setup.log");
  const paths = { runs: join(out, "runs.jsonl"), batches: join(out, "batches.jsonl"), samples: join(out, "samples.jsonl") };
  const meta = {
    commit: base,
    machine: machineDescription(),
    cases: options.cases,
    fixtures: options.fixtures,
    repeat: options.repeat,
    concurrency: options.concurrency,
    benchDir,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(formatPlan(plan, options).replace(/\nDry run: nothing was created\.$/, ""));
  console.log(`\nCommit ${base}; bench worktrees under ${benchDir}; setup output in ${setupLog}`);
  console.log(`\n${IDLE_WARNING}\n`);

  const worktrees = [];
  for (let i = 1; i <= plan.worktrees; i++) {
    throwIfAborted();
    const path = join(benchDir, `wt-${i}`);
    console.log(`Setup: worktree ${i}/${plan.worktrees} (install and build)…`);
    await createWorktree(path, base, setupLog);
    worktrees.push(path);
  }

  const sampler = startSampler(paths.samples);
  const runs = [];
  const batches = [];
  let batchNo = 0;
  try {
    for (let repeat = 1; repeat <= options.repeat; repeat++) {
      for (const fixture of plan.fixtures) {
        throwIfAborted();
        console.log(`\nSetup: fixture ${fixture.name} (repeat ${repeat}) in ${worktrees.length} worktree(s)…`);
        for (const path of worktrees) await applyFixture(path, base, fixture.name, setupLog);

        for (const batchPlan of plan.batches.filter((b) => b.repeat === repeat && b.fixture === fixture.name)) {
          throwIfAborted();
          const batch = { ...batchPlan, batchId: `${++batchNo}-${batchPlan.caseId}-${batchPlan.fixture}-r${repeat}` };
          console.log(`Batch ${batchNo}/${plan.batches.length}: case ${batch.caseId}, ${batch.fixture}, ${batch.worktrees} run(s)…`);
          batch.startMs = Date.now();
          await sampler.begin(batch.batchId);
          const records = await runBatch({
            batch,
            worktrees,
            slotApi,
            signal: abort.signal,
            baseEnv: process.env,
            launch: (run) => launchRun({ ...run, batch, base, out, timeoutMs: options.timeoutMs }),
          });
          sampler.end();
          batch.endMs = Date.now();
          for (const record of records) {
            keepTestLogs(record, worktrees[record.worker - 1], out);
            appendFileSync(paths.runs, `${JSON.stringify(record)}\n`);
            runs.push(record);
            const flag = record.timedOut ? " (timed out)" : record.exitCode !== 0 ? ` (exit ${record.exitCode ?? record.signal})` : "";
            console.log(`  w${record.worker}: ${(record.wallMs / 1000).toFixed(0)} s${record.queueMs ? `, queued ${(record.queueMs / 1000).toFixed(0)} s` : ""}${flag}`);
          }
          const batchRecord = { batchId: batch.batchId, caseId: batch.caseId, fixture: batch.fixture, repeat, worktrees: batch.worktrees, startMs: batch.startMs, endMs: batch.endMs };
          appendFileSync(paths.batches, `${JSON.stringify(batchRecord)}\n`);
          batches.push(batchRecord);
          await sleep(COOLDOWN_MS, abort.signal);
        }
      }
    }
  } finally {
    sampler.stop();
    meta.finishedAt = new Date().toISOString();
    meta.stoppedBy = abort.signal.aborted ? String(abort.signal.reason) : null;
    writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    if (batches.length > 0) {
      const samples = existsSync(paths.samples)
        ? readFileSync(paths.samples, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
        : [];
      writeFileSync(join(out, "summary.md"), renderSummaryMarkdown(summarize({ runs, batches, samples }), meta));
      console.log(`\nSummary: ${join(out, "summary.md")}`);
    }
  }
  throwIfAborted();
  return 0;
}

process.on("SIGINT", () => onSignal("SIGINT"));
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("uncaughtException", (err) => {
  // Kill the runs before the `exit` hook removes the worktrees they run in.
  for (const child of activeChildren.keys()) killTree(child, "SIGKILL");
  console.error(err?.stack ?? err);
  process.exit(1);
});
process.on("exit", removeWorktrees);

main().then(
  (code) => {
    removeWorktrees();
    process.exit(code);
  },
  (err) => {
    for (const child of activeChildren.keys()) killTree(child, "SIGTERM");
    removeWorktrees();
    if (abort.signal.aborted) {
      console.error(err.message);
      process.exit(abort.signal.reason === "SIGTERM" ? 143 : 130);
    }
    console.error(err instanceof BenchUsageError ? err.message : err?.stack ?? err);
    process.exit(err instanceof BenchUsageError ? 2 : 1);
  },
);
