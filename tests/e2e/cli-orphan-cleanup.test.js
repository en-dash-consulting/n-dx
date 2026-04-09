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
 * directly.
 *
 * On Windows this test is skipped — process groups are not supported there and
 * the orphan-cleanup layer degrades gracefully to direct-child kill.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  const segments = [process.env.NODE_OPTIONS, `--import=${preloadPath}`].filter(Boolean);
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

describe.skipIf(process.platform === "win32")(
  "n-dx orphan process cleanup (process-group-aware)",
  () => {
    let tmpDir;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "ndx-orphan-cleanup-"));
      await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
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
