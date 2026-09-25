/**
 * A timed-out test gate takes the whole test process tree with it (0.7.1 PR C2).
 *
 * Run 8dc53406 reported "`npm run test` did not finish within 15m 0s and was
 * killed (ran for 21m 45s)", which read as a kill that reached `npm` but not
 * its children for seven minutes. The tree kill was not the gap: llm-client's
 * `exec` (treeKill, on by default) already spawns the gate shell as a
 * process-group leader and kills group and descendants on timeout, on main
 * before this change. The overrun is attributed to a stalled hench process by
 * inference — no system sleep was logged, the host was heavily loaded — not by
 * evidence recorded in that run; the gate now records its own deadline so the
 * next occurrence says which it was.
 *
 * These tests hold the kill against real processes: a gate command shaped like
 * `npm run test` → run-all-tests → vitest → workers, including a worker that
 * ignores SIGTERM and a grandchild that leads its own process group. Every one
 * of them must be gone within a few seconds of the deadline, and the reported
 * duration must stay within the timeout plus the kill's grace period — a bound
 * that holds only on a host that is not stalled. A stalled hench cannot act on
 * its deadline at all; that case is reported, not bounded (describeTermination).
 *
 * POSIX only, by construction: node-spawns-node trees on Windows sit in a
 * libuv job object that reaps them regardless of what the gate does, so a
 * liveness assertion there would prove nothing (see
 * tests/helpers/real-process-tree.js). Windows' `taskkill /T /F` is a
 * best-effort tree walk, documented on runTestGate.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runTestGate, describeTermination } from "../../src/tools/test-runner.js";
import { RM_RETRY } from "../helpers/index.js";

const TIMEOUT_MS = 1_500;

/** terminateProcessTree's per-phase grace before SIGKILL (llm-client DEFAULT_FORCE_KILL_TIMEOUT_MS). */
const KILL_GRACE_MS = 5_000;

/*
 * Both duration bounds are DISCRIMINATING, in grace units, and deliberately not
 * scaled through NDX_TEST_TIME_MULTIPLIER — scaling would let both outcomes pass
 * (see tests/wall-clock-assertion-inventory.md). Measured on macOS, 2026-09-25:
 *
 * - Plain tree: clean 1,573-1,594ms (timeout + <0.1s). Injected regression, one
 *   SIGTERM-ignoring member that forces a grace: 6,558-6,598ms. Bound: half a grace.
 * - Stubborn tree: clean 6,558-6,598ms (timeout + one grace). Injected regression,
 *   a second SIGTERM-ignoring member outside the group, so the sweep waits a
 *   second grace: 11,559ms. Bound: one and a half graces.
 */
const PLAIN_TREE_BOUND_MS = TIMEOUT_MS + KILL_GRACE_MS / 2;
const STUBBORN_TREE_BOUND_MS = TIMEOUT_MS + KILL_GRACE_MS * 1.5;

/**
 * The tree. `mid` stands in for pnpm/vitest: it spawns workers into its own
 * group. One worker ignores SIGTERM (only the escalation to SIGKILL ends it);
 * one grandchild is spawned detached, so a group signal cannot reach it and
 * only the descendant sweep can. Every process appends its pid to `pids`.
 */
function treeScript(pidFile: string, { ignoreTerm }: { ignoreTerm: boolean }): string {
  const record = `require("fs").appendFileSync(${JSON.stringify(pidFile)}, process.pid + "\\n");`;
  const idle = "setInterval(() => {}, 1000);";
  const stubborn = `process.on("SIGTERM", () => {}); ${record} ${idle}`;
  const plain = `${record} ${idle}`;
  const mid = [
    'const { spawn } = require("child_process");',
    record,
    `spawn(process.execPath, ["-e", ${JSON.stringify(plain)}], { stdio: "inherit" });`,
    ignoreTerm ? `spawn(process.execPath, ["-e", ${JSON.stringify(stubborn)}], { stdio: "inherit" });` : "",
    `spawn(process.execPath, ["-e", ${JSON.stringify(plain)}], { stdio: "ignore", detached: true });`,
    'console.log("RUN  v4 workers started");',
    idle,
  ].join(" ");
  return [
    'const { spawn } = require("child_process");',
    record,
    `spawn(process.execPath, ["-e", ${JSON.stringify(mid)}], { stdio: "inherit" });`,
    idle,
  ].join("\n");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitAllDead(pids: number[], withinMs: number): Promise<number[]> {
  const deadline = Date.now() + withinMs;
  let alive = pids.filter(isAlive);
  while (alive.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
    alive = alive.filter(isAlive);
  }
  return alive;
}

describe.skipIf(process.platform === "win32")("test gate timeout kills the whole tree", () => {
  let dir: string;
  let pidFile: string;
  let pids: number[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-gate-kill-"));
    pidFile = join(dir, "pids");
    await writeFile(pidFile, "");
    pids = [];
  });

  afterEach(async () => {
    for (const pid of pids) {
      try { process.kill(pid, "SIGKILL"); } catch { /* gone, as asserted */ }
    }
    await rm(dir, { recursive: true, force: true, ...RM_RETRY });
  });

  async function runTree(ignoreTerm: boolean) {
    await writeFile(join(dir, "suite.cjs"), treeScript(pidFile, { ignoreTerm }));
    const gate = await runTestGate({
      projectDir: dir,
      filesChanged: ["src/a.ts"],
      testCommand: `node suite.cjs`,
      timeout: TIMEOUT_MS,
    });
    pids = (await readFile(pidFile, "utf-8")).trim().split("\n").filter(Boolean).map(Number);
    return gate;
  }

  it("terminates every process, detached grandchild included, within a few seconds of the timeout", async () => {
    const gate = await runTree(false);

    expect(gate.passed).toBe(false);
    // shell-launched node, mid, a worker, the detached grandchild
    expect(pids.length).toBeGreaterThanOrEqual(4);
    expect(await waitAllDead(pids, 1_000)).toEqual([]);
    expect(gate.totalDurationMs!).toBeLessThanOrEqual(PLAIN_TREE_BOUND_MS);
    expect(gate.error).toMatch(/did not finish within 2s and was killed; the whole process tree was gone \d+\.\ds after/);
  });

  it("escalates past a worker that ignores SIGTERM, within the kill's grace period", async () => {
    const gate = await runTree(true);

    expect(pids.length).toBeGreaterThanOrEqual(5);
    expect(await waitAllDead(pids, 1_000)).toEqual([]);
    // One grace on the group before SIGKILL — never a second.
    expect(gate.totalDurationMs!).toBeLessThanOrEqual(STUBBORN_TREE_BOUND_MS);
  }, 20_000);
});

describe("describeTermination", () => {
  const base = { command: "npm run test", timeout: 900_000, startMs: 0 };

  it("charges a late deadline to a stalled process, not to the kill (8dc53406)", () => {
    const message = describeTermination({
      ...base,
      error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
      deadlineSeenAt: 1_304_800,
      endMs: 1_305_181,
    });
    expect(message).toContain("did not finish within 15m 0s");
    expect(message).toContain("gone 0.4s after the kill began");
    expect(message).toMatch(/stalled for 6m 45s/);
  });

  it("says nothing about a stall when the deadline fired on time", () => {
    const message = describeTermination({
      ...base,
      error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
      deadlineSeenAt: 900_010,
      endMs: 900_400,
    });
    expect(message).toContain("gone 0.4s after the kill began (ran for 15m 0s in all)");
    expect(message).not.toContain("stalled");
  });

  it("does not call an outside signal a timeout", () => {
    const message = describeTermination({
      ...base,
      error: Object.assign(new Error("killed"), { killed: true, signal: "SIGKILL" }),
      deadlineSeenAt: undefined,
      endMs: 120_000,
    });
    expect(message).toContain("was killed by SIGKILL from outside hench after 2m 0s, before its 15m 0s limit");
    expect(message).not.toContain("did not finish within");
  });

  it("names runaway output as the cause when the buffer ceiling stopped the suite", () => {
    const message = describeTermination({
      ...base,
      error: Object.assign(new Error("stdout maxBuffer length exceeded"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }),
      deadlineSeenAt: undefined,
      endMs: 300_000,
    });
    expect(message).toMatch(/wrote more than 32 MB of output and was stopped after 5m 0s/);
  });
});
