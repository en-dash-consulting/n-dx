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
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { platform, tmpdir } from "node:os";

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

  throw new Error(`Timed out waiting for CI child PID record at ${pidFile}`);
}

function withImportedNodeOptions(preloadPath) {
  const segments = [process.env.NODE_OPTIONS, `--import=${preloadPath}`].filter(Boolean);
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

describe.skipIf(platform() === "win32")("n-dx ci child-process cleanup regression coverage", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-ci-child-cleanup-"));
    await setupCiProject(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
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
