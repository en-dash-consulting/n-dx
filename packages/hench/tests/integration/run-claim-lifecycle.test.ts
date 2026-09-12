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
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { openClaimsStore } from "../../src/prd/rex-gateway.js";

const henchCli = join(fileURLToPath(import.meta.url), "..", "..", "..", "dist", "cli", "index.js");
const rexCli = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "rex", "dist", "cli", "index.js");

/** A live PID that is not this process, so its claims read as someone else's. */
const LIVE_FOREIGN_PID = process.ppid;

function node(cli: string, args: string[], cwd: string): string {
  try {
    return execFileSync("node", [cli, ...args], { cwd, encoding: "utf-8", timeout: 60_000 });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return (e.stdout ?? "") + (e.stderr ?? "");
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

    return { repo, taskId };
  }

  it("leaves no claim behind when the run fails", async () => {
    // No LLM vendor is configured in a bare temp project, so the run fails
    // early — which is exactly the path that must still release.
    const { repo, taskId } = await makeProject();

    node(henchCli, ["run", `--task=${taskId}`, "--auto", repo], repo);

    expect(await claimsIn(repo)).toEqual([]);
  }, 90_000);

  it("refuses a task another worktree is holding, and names it", async () => {
    const { repo, taskId } = await makeProject();
    await openClaimsStore(repo).claim(taskId, {
      pid: LIVE_FOREIGN_PID,
      worktreeRoot: "/elsewhere/checkout",
    });

    const out = node(henchCli, ["run", `--task=${taskId}`, "--auto", repo], repo);

    expect(out).toContain("another worktree");
    expect(out).toContain("/elsewhere/checkout");
    // And it left the holder's claim exactly as it found it.
    expect(await claimsIn(repo)).toHaveLength(1);
  }, 90_000);

  it("releases the claim when the run is interrupted with SIGINT", async () => {
    const { repo, taskId } = await makeProject();

    const child = spawn("node", [henchCli, "run", `--task=${taskId}`, "--loop", repo], {
      cwd: repo,
      stdio: "ignore",
    });

    // Wait for the claim to appear, then interrupt mid-run.
    const claimed = await waitFor(async () => (await claimsIn(repo)).length > 0, 30_000);
    // A run that fell over before it could claim proves nothing either way.
    expect(claimed, "run never took a claim").toBe(true);

    // A run that had already exited on its own would prove nothing about the
    // interrupt path, so assert we are interrupting something still running.
    expect(child.exitCode, "run exited before it could be interrupted").toBeNull();
    child.kill("SIGINT");
    await new Promise<void>((resolve) => child.on("exit", () => resolve()));

    expect(await claimsIn(repo)).toEqual([]);
  }, 90_000);
});

/** Poll `check` until it is true or the deadline passes. */
async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
