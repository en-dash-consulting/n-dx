/**
 * Orphan process cleanup test.
 *
 * Verifies that the process-group-aware cleanup in child-lifecycle.js
 * reaches grandchildren — processes spawned by a CLI subprocess — after a
 * mid-run SIGINT.
 *
 * The test uses a NODE_OPTIONS preload to redirect the sourcevision CLI
 * invocation to orphan-child-double.mjs, which:
 *   1. Spawns a grandchild (orphan-grandchild.mjs) that ignores SIGTERM.
 *   2. Writes a JSONL record with both PIDs to a temp file.
 *   3. Hangs indefinitely.
 *
 * Because cli.js spawns subprocesses with `detached: true` on POSIX, each
 * child becomes the leader of a new process group.  The tracker's cleanup
 * path sends SIGTERM / SIGKILL to the entire group (-pgid), which reaches the
 * grandchild even though the grandchild was never registered with the tracker
 * directly.  On POSIX, a pass here genuinely exercises that path.
 *
 * WINDOWS: this runs but proves LESS than it appears to, so do not read a green
 * Windows result as "ndx reaps grandchildren on Windows":
 *   - `process.kill(pid, "SIGINT")` is TerminateProcess on Windows, so the
 *     CLI's SIGINT handler never executes — the parent dies with exit code 1
 *     rather than the handler's 128+2=130, and tracker cleanup never runs.
 *   - The tree nonetheless dies, because Windows hosts commonly place spawned
 *     processes in a Job Object whose children inherit kill-on-close. Verified
 *     independently of ndx: killing a middle process reaps a plain
 *     non-detached grandchild with no n-dx code in the picture.
 * So on Windows the assertion is satisfied by the OS/host, not by
 * child-lifecycle.js. It is still worth running — it would catch ndx actively
 * keeping a process alive — but the real Windows tree-kill contract needs a
 * different probe (assert the chosen termination strategy was invoked), and a
 * host without Job Object containment may legitimately show this red.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");
const PRELOAD_PATH = join(
  import.meta.dirname,
  "../fixtures/orphan-child-cleanup/orphan-spawn-preload.mjs",
);
const ORPHAN_DOUBLE_PATH = join(
  import.meta.dirname,
  "../fixtures/orphan-child-cleanup/orphan-child-double.mjs",
);

// Must be ≥ child-lifecycle.js DEFAULT_FORCE_KILL_TIMEOUT_MS (5 000 ms)
// to give the tracker time to escalate to SIGKILL.
const CHILD_FORCE_KILL_TIMEOUT_MS = 5_000;
const ORPHAN_POLL_TIMEOUT_MS = CHILD_FORCE_KILL_TIMEOUT_MS + 1_500;

function isPidRunning(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Poll until `pid` is no longer alive or `timeoutMs` elapses.
 * Throws if the process is still alive at the deadline.
 */
async function waitForPidExit(pid, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    `${label} (pid ${pid}) remained alive beyond ${timeoutMs}ms shutdown timeout.`,
  );
}

/**
 * Poll the JSONL PID file written by orphan-child-double.mjs until a record
 * appears or the timeout elapses.
 */
async function readPidRecord(pidFile, timeoutMs = 3_000) {
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

  throw new Error(`Timed out waiting for orphan PID record at ${pidFile}`);
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

function spawnAnalyze(tmpDir) {
  const pidFile = join(tmpDir, "orphan-pids.jsonl");
  const child = spawn(process.execPath, [CLI_PATH, "analyze", tmpDir], {
    cwd: tmpDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_OPTIONS: withImportedNodeOptions(PRELOAD_PATH),
      NDX_TEST_ORPHAN_REDIRECT_SCRIPT: ORPHAN_DOUBLE_PATH,
      NDX_TEST_ORPHAN_PID_FILE: pidFile,
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

describe(
  "n-dx orphan process cleanup (process-group-aware)",
  () => {
    let tmpDir;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "ndx-orphan-cleanup-"));
      await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    });

    afterEach(async () => {
      // maxRetries/retryDelay: the CLI child is spawned with cwd: tmpDir, so on
      // Windows the directory can still be handle-locked when teardown runs and
      // rmdir fails with EBUSY. Under full-suite load this is the difference
      // between green and an intermittent red that has nothing to do with the
      // assertion under test.
      await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    it(
      "reaps grandchild processes after SIGINT interruption within 5 seconds",
      { timeout: ORPHAN_POLL_TIMEOUT_MS + 5_000 },
      async () => {
        const run = spawnAnalyze(tmpDir);

        // Wait for the double to write the PID record before interrupting.
        const pidRecord = await readPidRecord(run.pidFile);
        expect(pidRecord.pid).toBeTypeOf("number");
        expect(pidRecord.grandchildPid).toBeTypeOf("number");

        // Interrupt the parent CLI process.
        process.kill(run.child.pid, "SIGINT");
        const result = await run.done;

        // Parent should exit non-zero (interrupted).
        expect(result.code).not.toBe(0);

        // Both the direct child and the grandchild must be gone within the budget.
        await waitForPidExit(pidRecord.pid, "child double", ORPHAN_POLL_TIMEOUT_MS);
        await waitForPidExit(pidRecord.grandchildPid, "orphan grandchild", ORPHAN_POLL_TIMEOUT_MS);
      },
    );
  },
);
