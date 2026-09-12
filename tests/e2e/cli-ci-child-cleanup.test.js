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
 *   3. NO fixture child outlives the test file, whatever the assertions did —
 *      see the teardown. This file used to leak one `hang`-mode double per
 *      SIGINT run, because killing the in-flight step is what let `ndx ci`
 *      advance to the NEXT step while the parent was already exiting. The
 *      escalation the assertions check ran fine; the child it unblocked was the
 *      one that escaped. The production side of that is fixed in
 *      child-lifecycle.js (see createChildProcessTracker's register), and this
 *      teardown is the backstop that makes a recurrence fail loudly.
 *
 * It uses the same preload-interception pattern as cli-child-cleanup.test.js:
 * a NODE_OPTIONS=--import preload patches child_process.spawn so that any
 * node call to a sourcevision or rex CLI entry point is redirected to a
 * lightweight "double" script.  The double records its PID and behaves
 * according to NDX_TEST_CI_MODE.
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

// Mirror child-lifecycle.js defaults so the timing budget is consistent.
const CHILD_FORCE_KILL_TIMEOUT_MS = 5_000;
const SHUTDOWN_ASSERTION_BUFFER_MS = 1_500;

/** How long teardown waits for an already-killed child to leave the process table. */
const ORPHAN_REAP_GRACE_MS = 2_000;

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
 * Every PID record written so far, or [] when the file does not exist yet.
 *
 * Used by teardown rather than by the assertions: the tests only care about the
 * FIRST child, but every child the run spawned has to be accounted for or the
 * ones the assertions never mention leak.
 */
async function readPidRecords(pidFile) {
  let content;
  try {
    content = await readFile(pidFile, "utf8");
  } catch {
    return [];
  }

  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        // Torn final line — the double appends, so a partial write is possible.
        return [];
      }
    });
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

  throw new Error(`Timed out waiting for CI child PID record at ${pidFile}`);
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

/**
 * Runs started by the current test, so teardown can reap them whatever the
 * assertions did. Tracked explicitly rather than relying on process-group
 * semantics: the CLI spawns its children detached (they lead their OWN groups,
 * by design, so the tracker can tree-kill them), which is exactly what stops a
 * group kill aimed at the test's own child from reaching them.
 */
const activeRuns = [];

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
    },
  });

  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  const run = {
    child,
    pidFile,
    done: new Promise((resolve) => {
      child.on("close", (code, signal) => {
        resolve({ code, signal, stdout: stdout.join(""), stderr: stderr.join("") });
      });
    }),
  };

  activeRuns.push(run);
  return run;
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
    // 1. The CLI parent. A case that failed an assertion or timed out never
    //    awaited run.done, and a live parent goes on spawning pipeline steps.
    for (const run of activeRuns) {
      if (run.child.exitCode === null && run.child.signalCode === null) {
        try {
          run.child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }

    // 2. The fixture doubles, unconditionally and by PID. `hang` mode ignores
    //    SIGTERM by design, so this goes straight to SIGKILL. Without it a
    //    failing or timing-out case leaves a node process reparented to PID 1
    //    on every single run — a sweep of one dev machine found 31 of them
    //    holding 431 MB, the oldest alive for over 11 hours.
    const survivors = [];
    for (const run of activeRuns) {
      for (const record of await readPidRecords(run.pidFile)) {
        if (!isPidRunning(record.pid)) continue;

        // Bounded grace before calling it a survivor: a child SIGKILLed moments
        // before its parent exited can still answer signal 0 while it is a
        // zombie awaiting reparenting, and signal 0 cannot tell the two apart.
        try {
          await waitForPidExit(record.pid, ORPHAN_REAP_GRACE_MS);
          continue;
        } catch {
          // Genuinely still running.
        }

        survivors.push(`${record.pid} (${(record.argv ?? []).join(" ")})`);
        try {
          process.kill(record.pid, "SIGKILL");
        } catch {
          // Raced us to exit.
        }
      }
    }
    activeRuns.length = 0;

    // maxRetries/retryDelay: the CLI child is spawned with cwd: tmpDir, so on
    // Windows the directory can still be handle-locked when teardown runs and
    // rmdir fails with EBUSY. Under full-suite load this is the difference
    // between green and an intermittent red that has nothing to do with the
    // assertion under test.
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    // Loud, not silent. The processes above have already been reaped, so this
    // never leaks regardless — but a regression that reintroduces the leak has
    // to fail a test rather than accumulate quietly across suite runs.
    expect(survivors).toEqual([]);
  });

  it("terminates the ci subprocess after a successful run", async () => {
    const run = spawnCI(tmpDir, "success");
    // Wait for at least the first intercepted ci subprocess to be recorded.
    const pidRecord = await readFirstPidRecord(run.pidFile);
    const result = await run.done;

    // The parent may exit non-zero if other steps (e.g. docs build) fail in
    // the temp dir — that's fine.  We only care that the tracked subprocess exited.
    await waitForPidExit(pidRecord.pid, 500);
    expect(result.code).not.toBeNull(); // parent exited
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
