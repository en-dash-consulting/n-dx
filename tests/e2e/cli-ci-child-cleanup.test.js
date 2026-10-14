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
 *   3. The shell-backed docs-build fixture starts a grandchild in hang mode;
 *      SIGINT must reap every recorded fixture PID, including that descendant.
 *   4. On headless Windows runners an IPC relay emits SIGINT through n-dx's
 *      production listener and acknowledges delivery before cleanup assertions.
 *   5. NO fixture child outlives the test file, whatever the assertions did —
 *      see the teardown. Under load, killing the in-flight step can let `ndx ci`
 *      advance to the NEXT step while the parent is already exiting, and that
 *      late child used to escape. On an idle machine the parent may exit before
 *      that next spawn, so this suite's teardown scan is a backstop rather than
 *      a deterministic reproducer. The production side is fixed in
 *      child-lifecycle.js (see createChildProcessTracker's register); the
 *      deterministic real-process regression lives in
 *      tests/integration/late-arrival-child-cleanup.test.js.
 *
 * It uses the same preload-interception pattern as cli-child-cleanup.test.js:
 * a NODE_OPTIONS=--import preload patches child_process.spawn so that any
 * node call to a sourcevision or rex CLI entry point, plus the initial docs
 * build, is redirected to a lightweight "double" script. The docs-build
 * double emits the first observable child-readiness signal, so the wait for a
 * tracked child never includes the unrelated VitePress build duration. The
 * double records its PID and behaves according to NDX_TEST_CI_MODE.
 *
 * ### Why there is no deadline on the record wait
 *
 * Waiting for a real process to reach a real spawn is the load-sensitive part
 * of this file, and it used to be a `while (Date.now() < deadline)` poll. That
 * deadline is what failed under full-suite load on 2026-09-28 — the product
 * worked, the machine was busy, and the suite said "Timed out waiting for
 * required CI child records". {@link waitForPidRecords} replaced it with a gate
 * whose only outcomes are events; see its header for what that buys and what it
 * leaves to the per-test timeout.
 *
 * The file is still flagged by tests/e2e/wall-clock-inventory-policy.test.js —
 * {@link waitForPidExit} is a deadline-bounded poll and is meant to be, because
 * what it bounds is the product's own force-kill timer. The inventory records
 * the distinction. Keep it that way: a new wait here either waits for an event
 * or explains itself in tests/wall-clock-assertion-inventory.md.
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

/**
 * The documented load allowance — TESTING.md, Family 3.
 *
 * Every wait below is a hang guardrail around a REAL spawned process: `ndx ci`
 * has to start Node, reach its first tracked spawn, and be reaped. None of them
 * decides a verdict — the assertions are about which PIDs are alive and what the
 * parent printed, and those read the same on an idle machine and a saturated
 * one. So widening them costs no detection and buys the whole documented 20x.
 *
 * Sized for the idle case, these timed out under `scripts/soak-under-build-load.mjs`:
 * the SIGINT case took 8678ms against the 3000ms first-record deadline and failed
 * with a suite that had nothing wrong with it. The file is 4.90s idle.
 */
const BUDGET_MULTIPLIER = Number(process.env["NDX_TEST_TIME_MULTIPLIER"] ?? 20);

/**
 * Mirror of child-lifecycle.js's force-kill default.
 *
 * NOT scaled, deliberately: this is the product's own timer, a real 5s that the
 * CLI waits between SIGTERM and SIGKILL. Multiplying it here would describe a
 * product that does not exist. The test's own allowance for observing that timer
 * complete under load is SHUTDOWN_ASSERTION_BUFFER_MS, which does scale.
 */
const CHILD_FORCE_KILL_TIMEOUT_MS = 5_000;

/** Test-side allowance on top of the product's force-kill timer. */
const SHUTDOWN_ASSERTION_BUFFER_MS = 1_500 * BUDGET_MULTIPLIER;

/**
 * How often {@link waitForPidRecords} re-reads the PID file.
 *
 * NOT a budget and deliberately unscaled: nothing ends because this elapses.
 * It is only how often a file another process appends to is sampled, and the
 * gate's two terminating conditions are both events.
 */
const RECORD_RECHECK_MS = 25;

/**
 * Hang ceiling for the SIGINT case's record gate — see
 * {@link FORCE_KILL_TEST_TIMEOUT_MS}, the only place it is used.
 *
 * Before the gate this was the record wait's own deadline, and expiring it was
 * the failure this file was rewritten for. It now bounds nothing but a true
 * hang: `ndx ci` alive, forever, having never reached its first tracked spawn.
 */
const CHILD_STARTUP_GRACE_MS = 3_000 * BUDGET_MULTIPLIER;

/** How long teardown waits for an already-killed child to leave the process table. */
const ORPHAN_REAP_GRACE_MS = 2_000 * BUDGET_MULTIPLIER;

/** How long a normally-completed ci child gets to exit once its parent has. */
const NORMAL_EXIT_GRACE_MS = 500 * BUDGET_MULTIPLIER;

/**
 * Per-test ceiling for the SIGINT case: the hang guardrail for the record gate,
 * which no longer carries a deadline of its own.
 *
 * TESTING.md prefers a hang to be reported by the helper that owns it, and the
 * gate still does that for every failure it can name — a parent that exits
 * without registering a child is reported with that parent's exit code and
 * stderr, which the old deadline could not distinguish from slowness. What is
 * left for a timeout is the case nothing can name: parent alive, records never
 * written, no event ever arriving. TESTING.md's Timeout Guardrails section is
 * explicit that a per-test timeout is the right instrument when a single test
 * owns the risky wait path.
 *
 * The sum is the file's worst sequential path: reach the first tracked spawn,
 * then let the product's force-kill timer complete. 100s at the default
 * multiplier, inside the root config's 120s testTimeout. The other case in this
 * file needs no override: its waits sum to 70s, already under that default.
 */
const FORCE_KILL_TEST_TIMEOUT_MS =
  CHILD_STARTUP_GRACE_MS + CHILD_FORCE_KILL_TIMEOUT_MS + SHUTDOWN_ASSERTION_BUFFER_MS + 5_000;

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
 * Gate: resolve with the PID records as soon as `predicate` accepts them, or
 * reject the moment the CLI parent exits without ever producing them.
 *
 * **No wall-clock deadline decides this.** The previous shape was
 * `while (Date.now() < deadline)` around the same read, and that deadline is
 * precisely what failed under full-suite load on 2026-09-28: "Timed out waiting
 * for required CI child records", at 9277ms, on a run where the product was
 * working and the machine was merely busy. Widening the deadline moves that
 * failure, it does not remove it — the verdict was still a function of
 * `(code, machine load)`.
 *
 * Both terminating conditions here are events, and load can reorder neither:
 *
 *   - the records arrive, however long `ndx ci` took to reach its first tracked
 *     spawn — a slow machine makes this later, never wrong;
 *   - the parent exits first, which is a real defect and is now reported as one,
 *     with the exit code and the parent's stderr. The old deadline could not
 *     tell that case from slowness and described both as a timeout.
 *
 * {@link RECORD_RECHECK_MS} is how a file another process appends to is
 * sampled, not a budget: the loop never ends because it elapsed. A genuine hang
 * — parent alive, records never written — has no event to wait for and is
 * caught by the per-test timeout. See {@link FORCE_KILL_TEST_TIMEOUT_MS}.
 */
async function waitForPidRecords(run, predicate, description) {
  let exit = null;
  run.exited.then((result) => {
    exit = result;
  });

  for (;;) {
    const records = await readPidRecords(run.pidFile);
    if (predicate(records)) return records;

    // Checked AFTER the read, so a parent that registered its child and exited
    // in the same breath is a pass rather than a race.
    if (exit) {
      throw new Error(
        `ndx ci exited (code ${exit.code}, signal ${exit.signal}) before ${description}.\n` +
          `PID records written: ${JSON.stringify(records)}\n` +
          `stderr:\n${run.stderr.join("")}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, RECORD_RECHECK_MS));
  }
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
  const isWindows = process.platform === "win32";
  const child = spawn(process.execPath, [CLI_PATH, "ci", tmpDir], {
    cwd: tmpDir,
    // Windows has no reliable console on headless GitHub Actions workers, so
    // the test uses a Node IPC channel there to emit SIGINT through the CLI's
    // real listener. POSIX keeps the ordinary OS signal route.
    stdio: isWindows ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_OPTIONS: withImportedNodeOptions(PRELOAD_PATH),
      // The asserted strategy line proves the console event reached ndx's
      // cleanup handler rather than merely terminating the parent process.
      NDX_DEBUG_LIFECYCLE: "1",
      NDX_TEST_CI_MODE: mode,
      NDX_TEST_CI_PID_FILE: pidFile,
      NDX_TEST_CI_REDIRECT_SCRIPT: CI_DOUBLE_PATH,
      ...(isWindows ? { NDX_TEST_INTERRUPT_IPC: "1" } : {}),
    },
  });

  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  const run = {
    child,
    pidFile,
    // Live buffers rather than only the joined strings on `done`: the record
    // gate reports what the parent printed before it died, and cannot await
    // `close` to get it without becoming the hang it is diagnosing.
    stdout,
    stderr,
    // `exit`, not `close`: the process leaving the table is the event that
    // matters to both callers — the gate's liveness check and teardown's
    // release of the cwd handle on tmpDir. `close` additionally waits for the
    // stdio pipes, which a detached descendant can hold open past the parent's
    // death, and waiting for that here would reintroduce an indefinite wait at
    // exactly the two points that must not have one.
    exited: new Promise((resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal }));
    }),
    done: new Promise((resolve) => {
      child.on("close", (code, signal) => {
        resolve({ code, signal, stdout: stdout.join(""), stderr: stderr.join("") });
      });
    }),
  };

  activeRuns.push(run);
  return run;
}

/**
 * Send a SIGINT that reaches the CLI's JavaScript signal handler.
 *
 * Node documents `process.kill(pid, "SIGINT")` as unconditional termination on
 * Windows. Headless GitHub Actions runners may not assign the CLI a console, so
 * AttachConsole cannot make a real Ctrl+C deterministic there. The Windows
 * branch instead sends an IPC test message that makes the CLI emit SIGINT; this
 * invokes the production listener installed by installTrackedChildProcessHandlers
 * and returns only after that listener has received the interruption.
 */
async function sendSIGINT(child) {
  if (process.platform !== "win32") {
    process.kill(child.pid, "SIGINT");
    return;
  }

  if (!Number.isInteger(child.pid)) {
    throw new Error("Cannot send SIGINT to a CI run without a PID.");
  }

  await new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message?.type !== "ndx-test-interrupt-received" || message.signal !== "SIGINT") return;
      finish(resolve);
    };
    const onClose = () => finish(reject, new Error("Windows CI run exited before receiving SIGINT."));
    const finish = (settle, value) => {
      child.removeListener("message", onMessage);
      child.removeListener("close", onClose);
      settle(value);
    };

    if (!child.connected) {
      finish(reject, new Error("Windows CI run has no IPC channel for deterministic SIGINT delivery."));
      return;
    }

    child.on("message", onMessage);
    child.once("close", onClose);
    child.send({ type: "ndx-test-interrupt", signal: "SIGINT" }, (error) => {
      if (error) finish(reject, error);
    });
  });
}

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
    const candidates = [];
    for (const run of activeRuns) {
      for (const record of await readPidRecords(run.pidFile)) {
        if (isPidRunning(record.pid)) candidates.push(record);
      }
    }

    // Bounded grace before calling one a survivor: a child SIGKILLed moments
    // before its parent exited can still answer signal 0 while it is a zombie
    // awaiting reparenting, and signal 0 cannot tell the two apart.
    //
    // Concurrently, because the grace now scales with BUDGET_MULTIPLIER. Run in
    // series these would sum, and a handful of survivors would outrun the hook
    // timeout — turning a loud, named survivor list into an opaque "hook timed
    // out". The waits are independent, so one grace period covers all of them.
    // Nothing is paid in the green case: a reaped PID never becomes a candidate.
    const stillAlive = await Promise.all(
      candidates.map((record) =>
        waitForPidExit(record.pid, ORPHAN_REAP_GRACE_MS).then(() => null, () => record),
      ),
    );

    const survivors = [];
    for (const record of stillAlive) {
      if (!record) continue;

      survivors.push(`${record.pid} (${(record.argv ?? []).join(" ")})`);
      try {
        process.kill(record.pid, "SIGKILL");
      } catch {
        // Raced us to exit.
      }
    }

    // 3. Only now is tmpDir removable. The CLI parent is spawned with
    //    `cwd: tmpDir` and every double inherits it, and on Windows a live
    //    process's working directory is an open handle: rmdir fails EBUSY
    //    while any of them is still exiting.
    //    That is the second error in the 2026-09-28 failure — `EBUSY: resource
    //    busy or locked, rmdir` immediately after the record timeout, teardown
    //    racing a process tree that had not finished going away.
    //
    //    Waiting on `exited` removes the race rather than retrying through it.
    //    It cannot hang on a parent that is already gone (the promise is
    //    resolved) nor on one still running (it was SIGKILLed in step 1), and
    //    the fixture children were awaited in step 2.
    await Promise.all(activeRuns.map((run) => run.exited));
    activeRuns.length = 0;

    // The retries stay as a backstop for the handles this test does not own:
    // on Windows an antivirus or indexer scanning a just-written temp file
    // holds it briefly, and that is nobody's process to wait for.
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    // Loud, not silent. The processes above have already been reaped, so this
    // never leaks regardless — but a regression that reintroduces the leak has
    // to fail a test rather than accumulate quietly across suite runs.
    expect(survivors).toEqual([]);
  });

  it("terminates the ci subprocess after a successful run", async () => {
    const run = spawnCI(tmpDir, "success");
    // The docs-build double is the first tracked CI child, so one record is
    // enough to know the pipeline reached a spawn the tracker owns.
    const [pidRecord] = await waitForPidRecords(
      run,
      (records) => records.length > 0,
      "registering its first tracked child",
    );
    expect(pidRecord.kind).toBe("docs-build");
    const result = await run.done;

    // The parent may exit non-zero if other steps (e.g. docs build) fail in
    // the temp dir — that's fine.  We only care that the tracked subprocess exited.
    await waitForPidExit(pidRecord.pid, NORMAL_EXIT_GRACE_MS);
    expect(result.code).not.toBeNull(); // parent exited
  });

  it(
    "force-kills the ci subprocess after SIGINT interruption",
    { timeout: FORCE_KILL_TEST_TIMEOUT_MS },
    async () => {
      const run = spawnCI(tmpDir, "hang");
      const records = await waitForPidRecords(
        run,
        (candidate) => candidate.some((record) => record.kind === "docs-build") &&
          candidate.some((record) => record.kind === "docs-build-grandchild"),
        "registering both the docs-build child and its grandchild",
      );
      const docsBuild = records.find((record) => record.kind === "docs-build");
      const docsBuildGrandchild = records.find((record) => record.kind === "docs-build-grandchild");
      expect(docsBuild).toBeDefined();
      expect(docsBuildGrandchild).toBeDefined();

      // Interrupt the parent process mid-run through its real SIGINT handler.
      await sendSIGINT(run.child);
      const result = await run.done;

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        process.platform === "win32"
          ? "[child-lifecycle] taskkill /PID"
          : "[child-lifecycle] process group kill",
      );
      await Promise.all(
        records.map((record) => waitForPidExit(
          record.pid,
          CHILD_FORCE_KILL_TIMEOUT_MS + SHUTDOWN_ASSERTION_BUFFER_MS,
        )),
      );
    },
  );
});
