/**
 * Regression test: worker/subprocess cleanup for `ndx ci`.
 *
 * Before the fix in packages/core/ci.js, the subprocesses spawned by
 * runCapture() (sourcevision analyze, sourcevision validate, rex validate,
 * rex health, rex status) were NOT registered with the global child-process
 * tracker.  Sending SIGINT to the parent while one of those steps was
 * running left the child process alive.
 *
 * This test suite verifies that:
 *   1. A ci subprocess that completes normally is reaped before the parent exits.
 *   2. A ci subprocess that is still running when SIGINT arrives is killed by
 *      the cleanup gate (SIGTERM → SIGKILL after timeout).
 *
 * It uses the same preload-interception pattern as cli-child-cleanup.test.js:
 * a NODE_OPTIONS=--import preload patches child_process.spawn so that any
 * node call to a sourcevision or rex CLI entry point is redirected to a
 * lightweight "double" script.  The double records its PID and behaves
 * according to NDX_TEST_CI_MODE.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY THE PRELOAD ALSO STUBS `pnpm docs:build`
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * This suite was observed failing with "Timed out waiting for CI child PID
 * record" — on origin/main as well as on the branch that reported it, so it was
 * not a regression in either.
 *
 * Root cause: `runCI` runs its phases in order, and the documentation phase
 * comes first (packages/core/ci.js — `runDocsPhase` before `runAnalysisPhase`).
 * That phase ends in a tracked `pnpm docs:build` spawn, which the *analysis*
 * phase's sourcevision spawn waits behind. So the whole of pnpm's startup is
 * charged against `readFirstPidRecord`'s deadline, even though nothing about
 * pnpm is under test here.
 *
 * Measured on an idle machine (probe against this exact fixture): 539ms to the
 * first PID record, of which ~490ms was the docs phase — pnpm booting in a temp
 * directory that has no package.json. The remaining phases took 366ms combined.
 * A 3s deadline therefore had roughly 5x headroom over pnpm's *best* case, on a
 * spawn whose cost is dominated by store-lock contention with the other pnpm
 * processes a full `pnpm test` run has in flight.
 *
 * The fix removes the irrelevant work rather than widening the deadline, which
 * TESTING.md forbids and which would not have helped anyway — the next busier
 * machine just fails at the new number. The docs-build spawn is redirected to a
 * stub that exits immediately, so it still exercises `spawnTracked` (the tracker
 * surface this suite is about) while taking pnpm out of the measurement.
 * Time-to-first-PID drops to ~50ms and the deadline is unchanged at 3s.
 *
 * @see ../fixtures/ci-child-cleanup/docs-build-stub.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");
const PRELOAD_PATH = join(
  import.meta.dirname,
  "../fixtures/ci-child-cleanup/ci-spawn-preload.mjs",
);
const CI_DOUBLE_PATH = join(
  import.meta.dirname,
  "../fixtures/ci-child-cleanup/ci-child-double.mjs",
);
const DOCS_BUILD_STUB_PATH = join(
  import.meta.dirname,
  "../fixtures/ci-child-cleanup/docs-build-stub.mjs",
);

// Mirror child-lifecycle.js defaults so the timing budget is consistent.
const CHILD_FORCE_KILL_TIMEOUT_MS = 5_000;
const SHUTDOWN_ASSERTION_BUFFER_MS = 1_500;

function isPidRunning(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    `CI child process ${pid} remained alive beyond ${timeoutMs}ms shutdown timeout.`,
  );
}

/**
 * Read the first PID record written by ci-child-double.mjs.
 * Polls until the record appears or the timeout elapses.
 */
async function readFirstPidRecord(pidFile, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(pidFile, "utf8");
      const line = content.trim().split("\n").find(Boolean);
      if (line) return JSON.parse(line);
    } catch {
      // File not yet written — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `Timed out waiting for CI child PID record at ${pidFile} after ${timeoutMs}ms. ` +
    `The tracked spawns this waits for are in ci.js's analysis phase, which runs ` +
    `after the documentation phase — so a phase added or reordered ahead of it, or ` +
    `a spawn there that the preload no longer intercepts, spends this whole window ` +
    `before the first PID can be written. Check the "docs build" line in the CI ` +
    `output: "✓" means the stub intercepted, "✗" means a real package manager ran.`,
  );
}

function withImportedNodeOptions(preloadPath) {
  // `--import` needs a file:// URL, not a bare path: on Windows Node rejects
  // `--import=C:\...` with ERR_UNSUPPORTED_ESM_URL_SCHEME ("Received
  // protocol 'c:'"), so the preload never loads, `spawn` is never patched, the
  // child double is never substituted, and every test here times out waiting
  // for a PID record that is never written. POSIX accepts the file:// form too,
  // so this is unconditional. The URL form also encodes spaces, which a bare
  // path in NODE_OPTIONS could not survive.
  const specifier = pathToFileURL(preloadPath).href;
  const segments = [process.env.NODE_OPTIONS, `--import=${specifier}`].filter(Boolean);
  return segments.join(" ");
}

/**
 * Populate a minimal project directory that satisfies ndx ci's pre-flight
 * checks (.rex and .sourcevision must exist).
 */
async function setupCiProject(dir) {
  await mkdir(join(dir, ".rex"), { recursive: true });
  await mkdir(join(dir, ".sourcevision"), { recursive: true });

  await writeFile(
    join(dir, ".rex", "config.json"),
    JSON.stringify({ schema: "rex/v1", project: "ci-cleanup-test", adapter: "file" }, null, 2) + "\n",
  );
  await writeFile(
    join(dir, ".rex", "prd.json"),
    JSON.stringify({ schema: "rex/v1", title: "CI Cleanup Test", items: [] }, null, 2) + "\n",
  );
  await writeFile(
    join(dir, ".sourcevision", "manifest.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: new Date().toISOString(),
      targetPath: dir,
      modules: {
        inventory: { status: "complete", lastRun: new Date().toISOString() },
        imports: { status: "complete", lastRun: new Date().toISOString() },
        zones: { status: "complete", lastRun: new Date().toISOString() },
        components: { status: "complete", lastRun: new Date().toISOString() },
      },
    }),
  );
}

function spawnCI(tmpDir, mode) {
  const pidFile = join(tmpDir, "ci-child-pids.jsonl");
  const child = spawn(process.execPath, [CLI_PATH, "ci", tmpDir], {
    cwd: tmpDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_OPTIONS: withImportedNodeOptions(PRELOAD_PATH),
      NDX_TEST_CI_MODE: mode,
      NDX_TEST_CI_PID_FILE: pidFile,
      NDX_TEST_CI_REDIRECT_SCRIPT: CI_DOUBLE_PATH,
      NDX_TEST_CI_DOCS_BUILD_SCRIPT: DOCS_BUILD_STUB_PATH,
    },
  });

  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  return {
    child,
    pidFile,
    done: new Promise((resolve) => {
      child.on("close", (code, signal) => {
        resolve({ code, signal, stdout: stdout.join(""), stderr: stderr.join("") });
      });
    }),
  };
}

// Runs on Windows as well as POSIX. Caveat for the SIGINT case: on Windows
// `process.kill(pid, "SIGINT")` is TerminateProcess, so the CLI's signal handler
// never runs and the subprocess dies because the host's Job Object reaps the
// tree — not because tracker cleanup ran. See the header of
// cli-orphan-cleanup.test.js for the full explanation.
describe("n-dx ci child-process cleanup regression coverage", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-ci-child-cleanup-"));
    await setupCiProject(tmpDir);
  });

  afterEach(async () => {
    // maxRetries/retryDelay: the CLI child is spawned with cwd: tmpDir, so on
    // Windows the directory can still be handle-locked when teardown runs and
    // rmdir fails with EBUSY. Under full-suite load this is the difference
    // between green and an intermittent red that has nothing to do with the
    // assertion under test.
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("terminates the ci subprocess after a successful run", async () => {
    const run = spawnCI(tmpDir, "success");
    // Wait for at least the first intercepted ci subprocess to be recorded.
    const pidRecord = await readFirstPidRecord(run.pidFile);
    const result = await run.done;

    // The parent may exit non-zero if other steps fail in the temp dir — that's
    // fine.  We only care that the tracked subprocess exited.
    await waitForPidExit(pidRecord.pid, 500);
    expect(result.code).not.toBeNull(); // parent exited

    // "A stub that fails is not a stub" (TESTING.md, Family 5). The docs-build
    // interception is what keeps pnpm's startup out of readFirstPidRecord's
    // window; if it silently stops matching — ci.js switching package manager,
    // renaming the script, or resolving an absolute path the preload's basename
    // check misses — this suite goes back to racing a real `pnpm docs:build` and
    // to flaking under load. A real pnpm run in this temp dir reports
    // "✗ docs build failed", so asserting the success line detects it.
    expect(
      result.stdout,
      "docs-build spawn was not intercepted by docs-build-stub.mjs — see the " +
      "preload's isDocsBuildSpawn matcher",
    ).toContain("✓ docs build");
  });

  it(
    "force-kills the ci subprocess after SIGINT interruption",
    { timeout: CHILD_FORCE_KILL_TIMEOUT_MS + SHUTDOWN_ASSERTION_BUFFER_MS + 5_000 },
    async () => {
      const run = spawnCI(tmpDir, "hang");
      const pidRecord = await readFirstPidRecord(run.pidFile);

      // Interrupt the parent process mid-run.
      process.kill(run.child.pid, "SIGINT");
      const result = await run.done;

      expect(result.code).not.toBe(0);
      await waitForPidExit(
        pidRecord.pid,
        CHILD_FORCE_KILL_TIMEOUT_MS + SHUTDOWN_ASSERTION_BUFFER_MS,
      );
    },
  );
});
