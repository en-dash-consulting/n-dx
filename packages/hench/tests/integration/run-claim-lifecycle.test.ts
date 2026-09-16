/**
 * A run's claim, from the real `hench run` CLI.
 *
 * The unit tests exercise the ledger directly. What they cannot show is that
 * `cmdRun` actually takes a claim before it starts and hands it back when it
 * stops — which is the part that, if it regresses, silently blocks a task for
 * every worktree in the repository until the claim expires.
 *
 * These spawn the built CLI, so they need `pnpm build` first, like every other
 * CLI-level suite here.
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openClaimsStore } from "../../src/prd/rex-gateway.js";

const henchCli = join(fileURLToPath(import.meta.url), "..", "..", "..", "dist", "cli", "index.js");
const henchRunModule = join(fileURLToPath(import.meta.url), "..", "..", "..", "dist", "cli", "commands", "run.js");
const rexCli = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "rex", "dist", "cli", "index.js");

/** A live PID that is not this process, so its claims read as someone else's. */
const LIVE_FOREIGN_PID = process.ppid;

/**
 * A minimal Claude CLI protocol fixture.  Tests configure it explicitly so
 * their claim assertions are reached on CI machines without a vendor CLI or
 * credentials. In blocking mode it only returns once the parent test has
 * sent SIGINT, keeping the run alive long enough to exercise that path.
 */
const TEST_VENDOR_SOURCE = `#!/usr/bin/env node
const { existsSync } = require("node:fs");

if (process.env.HENCH_CLAIM_TEST_MODE === "block") {
  const releaseFile = process.env.HENCH_CLAIM_TEST_RELEASE_FILE;
  if (!releaseFile) process.exit(2);
  const timer = setInterval(() => {
    if (!existsSync(releaseFile)) return;
    clearInterval(timer);
    console.log(JSON.stringify({ type: "result", is_error: true, result: "controlled test vendor failure" }));
  }, 20);
} else {
  console.log(JSON.stringify({ type: "result", is_error: true, result: "controlled test vendor failure" }));
}
`;

/**
 * Windows cannot reliably turn child.kill("SIGINT") into a console Ctrl-C for
 * a detached test child. This driver retains the real cmdRun lifecycle while
 * giving the parent an IPC seam to emit the same process-level SIGINT event.
 */
const TEST_SIGNAL_DRIVER_SOURCE = `
const runModule = process.env.HENCH_CLAIM_TEST_RUN_MODULE;
const taskId = process.env.HENCH_CLAIM_TEST_TASK_ID;
if (!runModule || !taskId) throw new Error("Missing claim-lifecycle test driver configuration");

const { cmdRun } = await import(runModule);
process.on("message", (message) => {
  if (message === "emit-sigint") process.emit("SIGINT");
});

try {
  await cmdRun(process.cwd(), { task: taskId, loop: "true" });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect();
}
`;

function node(cli: string, args: string[], cwd: string): string {
  return nodeResult(cli, args, cwd).output;
}

function nodeResult(cli: string, args: string[], cwd: string): { output: string; status: number } {
  try {
    return { output: execFileSync("node", [cli, ...args], { cwd, encoding: "utf-8", timeout: 60_000 }), status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { output: (e.stdout ?? "") + (e.stderr ?? ""), status: e.status ?? 1 };
  }
}

function extractId(output: string): string {
  const match = output.match(/ID: (.+)/);
  if (!match?.[1]) throw new Error(`No ID in output: ${output}`);
  return match[1].trim();
}

/** Live claim records in a repository, as the file has them. */
async function claimsIn(repo: string): Promise<Array<{ taskId: string; worktreeRoot: string }>> {
  try {
    const raw = await readFile(join(repo, ".git", "ndx", "claims.json"), "utf-8");
    return JSON.parse(raw).claims ?? [];
  } catch {
    return [];
  }
}

describe("hench run task claims", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  /** A git repo with rex + hench initialised and one actionable task. */
  async function makeProject(): Promise<{ repo: string; taskId: string }> {
    const repo = await mkdtemp(join(tmpdir(), "hench-run-claims-"));
    tmpDirs.push(repo);
    execFileSync("git", ["init", "--quiet"], { cwd: repo, stdio: "ignore" });

    node(rexCli, ["init", repo], repo);
    const epic = extractId(node(rexCli, ["add", "epic", "--title=Epic", repo], repo));
    const taskId = extractId(node(rexCli, ["add", "task", "--title=Task", `--parent=${epic}`, repo], repo));
    node(henchCli, ["init", repo], repo);
    const vendorPath = await installTestVendor(repo);
    const signalDriverPath = await installTestSignalDriver(repo);
    execFileSync(
      "git",
      [
        "add", "--force", ".gitignore", ".n-dx.json", ".hench/claim-lifecycle-vendor.js",
        vendorPath, signalDriverPath, ".hench/config.json", ".rex",
      ],
      { cwd: repo },
    );
    execFileSync("git", ["-c", "user.name=Hench Test", "-c", "user.email=hench-test@example.test", "commit", "--quiet", "-m", "init"], { cwd: repo });

    return { repo, taskId };
  }

  it("releases the claim when the pre-run gate stops the run", async () => {
    const { repo, taskId } = await makeProject();
    // The run takes its explicit-task claim before this gate, then must
    // release it when the non-interactive gate declines to proceed.
    await writeFile(join(repo, "uncommitted-fixture.txt"), "fixture dirt\n");

    node(henchCli, ["run", `--task=${taskId}`, "--auto", repo], repo);

    expect(await claimsIn(repo)).toEqual([]);
  }, 90_000);

  it("refuses a task another worktree is holding, and names it", async () => {
    const { repo, taskId } = await makeProject();
    await openClaimsStore(repo).claim(taskId, {
      pid: LIVE_FOREIGN_PID,
      worktreeRoot: "/elsewhere/checkout",
    });

    const result = nodeResult(henchCli, ["run", `--task=${taskId}`, "--auto", repo], repo);

    expect(result.output).toContain("another worktree");
    expect(result.output).toContain("/elsewhere/checkout");
    expect(result.status).not.toBe(0);
    // And it left the holder's claim exactly as it found it.
    expect(await claimsIn(repo)).toHaveLength(1);
  }, 90_000);

  it("releases the claim when the run is interrupted with SIGINT", async () => {
    const { repo, taskId } = await makeProject();
    const releaseFile = join(repo, ".hench", "claim-lifecycle-release");

    const windowsSignalDriver = join(repo, ".hench", "claim-lifecycle-signal-driver.mjs");
    // Keep the actual CLI process on platforms where Node can deliver SIGINT.
    // On Windows the driver runs the same cmdRun command and receives an IPC
    // request to emit SIGINT locally, which is the portable signal seam.
    const child = spawn(
      process.execPath,
      process.platform === "win32"
        ? [windowsSignalDriver]
        : [henchCli, "run", `--task=${taskId}`, "--loop", repo],
      {
        cwd: repo,
        stdio: process.platform === "win32" ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          HENCH_CLAIM_TEST_MODE: "block",
          HENCH_CLAIM_TEST_RELEASE_FILE: releaseFile,
          HENCH_CLAIM_TEST_RUN_MODULE: pathToFileURL(henchRunModule).href,
          HENCH_CLAIM_TEST_TASK_ID: taskId,
        },
      },
    );
    let childOutput = "";
    child.stdout.on("data", (chunk: Buffer) => { childOutput += chunk; });
    child.stderr.on("data", (chunk: Buffer) => { childOutput += chunk; });

    // Wait for the claim to appear, then interrupt mid-run.
    await waitFor(async () => {
      const claimed = (await claimsIn(repo)).length > 0;
      return (claimed && childOutput.includes("Loop mode: running continuously")) || child.exitCode !== null;
    }, 30_000);
    const claimed = (await claimsIn(repo)).length > 0;
    // A run that fell over before it could claim proves nothing either way.
    if (!claimed) throw new Error(`Run never took a claim:\n${childOutput}`);

    // A run that had already exited on its own would prove nothing about the
    // interrupt path, so assert we are interrupting something still running.
    expect(child.exitCode, "run exited before it could be interrupted").toBeNull();
    if (process.platform === "win32") {
      if (!child.send) throw new Error("Windows signal test child has no IPC channel");
      child.send("emit-sigint");
    } else {
      child.kill("SIGINT");
    }
    const interrupted = await waitFor(
      async () => childOutput.includes("Received interrupt — finishing current task then stopping…"),
      5_000,
    );
    if (!interrupted) throw new Error(`Run did not acknowledge SIGINT:\n${childOutput}`);
    // The protocol fixture remains blocked until after the signal is sent.
    // It then reports a controlled error, allowing the graceful loop shutdown
    // to unwind through cmdRun's claim-release finally block.
    await writeFile(releaseFile, "release");
    if (child.exitCode === null) {
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }

    expect(await claimsIn(repo)).toEqual([]);
  }, 90_000);
});

async function installTestVendor(repo: string): Promise<string> {
  const vendorSourcePath = join(repo, ".hench", "claim-lifecycle-vendor.js");
  await writeFile(vendorSourcePath, TEST_VENDOR_SOURCE, { mode: 0o755 });

  // `spawnCli` invokes an explicit path through cmd.exe on Windows. A bare
  // Unix shebang script is not executable there, so use a tiny .cmd adapter
  // that forwards the vendor protocol arguments to the Node fixture.
  const vendorPath = process.platform === "win32"
    ? join(repo, ".hench", "claim-lifecycle-vendor.cmd")
    : join(repo, ".hench", "claim-lifecycle-vendor");
  if (process.platform === "win32") {
    await writeFile(
      vendorPath,
      `@echo off\r\n"${process.execPath}" "%~dp0claim-lifecycle-vendor.js" %*\r\n`,
    );
  } else {
    await writeFile(vendorPath, TEST_VENDOR_SOURCE, { mode: 0o755 });
    await chmod(vendorPath, 0o755);
  }
  await writeFile(
    join(repo, ".n-dx.json"),
    JSON.stringify({
      llm: {
        vendor: "claude",
        claude: { cli_path: vendorPath },
      },
    }),
  );
  return vendorPath;
}

async function installTestSignalDriver(repo: string): Promise<string> {
  const driverPath = join(repo, ".hench", "claim-lifecycle-signal-driver.mjs");
  await writeFile(driverPath, TEST_SIGNAL_DRIVER_SOURCE, { mode: 0o755 });
  return driverPath;
}

/** Poll `check` until it is true or the deadline passes. */
async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
