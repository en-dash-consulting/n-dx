import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");
const PRELOAD_PATH = join(
  import.meta.dirname,
  "../fixtures/sourcevision-child-cleanup/sourcevision-spawn-preload.mjs",
);
const SOURCEVISION_DOUBLE_PATH = join(
  import.meta.dirname,
  "../fixtures/sourcevision-child-cleanup/sourcevision-child-double.mjs",
);
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
    `SourceVision-related child process ${pid} remained alive beyond ${timeoutMs}ms shutdown timeout.`,
  );
}

async function readPidRecord(pidFile, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(pidFile, "utf8");
      const line = content.trim().split("\n").find(Boolean);
      if (line) return JSON.parse(line);
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for SourceVision child PID record at ${pidFile}`);
}

function withImportedNodeOptions(preloadPath) {
  const segments = [process.env.NODE_OPTIONS, `--import=${preloadPath}`].filter(Boolean);
  return segments.join(" ");
}

function spawnAnalyze(tmpDir, mode) {
  const pidFile = join(tmpDir, "sourcevision-child-pids.jsonl");
  const child = spawn(process.execPath, [CLI_PATH, "analyze", tmpDir], {
    cwd: tmpDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_OPTIONS: withImportedNodeOptions(PRELOAD_PATH),
      NDX_TEST_SOURCEVISION_MODE: mode,
      NDX_TEST_SOURCEVISION_PID_FILE: pidFile,
      NDX_TEST_SOURCEVISION_REDIRECT_SCRIPT: SOURCEVISION_DOUBLE_PATH,
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
        resolve({
          code,
          signal,
          stdout: stdout.join(""),
          stderr: stderr.join(""),
        });
      });
    }),
  };
}

describe("n-dx child-process cleanup regression coverage", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-child-cleanup-"));
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("terminates the SourceVision child after a successful run", async () => {
    const run = spawnAnalyze(tmpDir, "success");
    const pidRecord = await readPidRecord(run.pidFile);
    const result = await run.done;

    expect(result.code).toBe(0);
    await waitForPidExit(pidRecord.pid, 500);
  });

  it("terminates the SourceVision child after an erroring run", async () => {
    const run = spawnAnalyze(tmpDir, "failure");
    const pidRecord = await readPidRecord(run.pidFile);
    const result = await run.done;

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("sourcevision child double failed");
    await waitForPidExit(pidRecord.pid, 500);
  });

  it(
    "force-kills the SourceVision child after SIGINT interruption",
    { timeout: CHILD_FORCE_KILL_TIMEOUT_MS + SHUTDOWN_ASSERTION_BUFFER_MS + 5_000 },
    async () => {
      const run = spawnAnalyze(tmpDir, "hang");
      const pidRecord = await readPidRecord(run.pidFile);

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
