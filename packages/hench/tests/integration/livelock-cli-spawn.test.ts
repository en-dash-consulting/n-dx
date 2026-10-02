/**
 * Livelock detection on the CLI-provider path (GH #362).
 *
 * The failing run was a spawned vendor CLI, so the part that matters is that
 * hench *kills the child* rather than waiting for a process that will never
 * finish. Only a real spawn proves that, so this drives `spawnWithAdapter`
 * against a stand-in CLI that emits Claude stream-json forever.
 *
 * The stand-in also stands in for the original failure mode: it never exits on
 * its own, exactly like an agent blocked on a background task whose process is
 * gone. If the intercept did not kill it, this test would hang.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnWithAdapter } from "../../src/agent/lifecycle/cli-loop.js";
import { claudeCliAdapter } from "../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { createLivelockDetector } from "../../src/agent/analysis/livelock.js";
import { createLiveSpawnProgress } from "../../src/agent/lifecycle/cli-loop.js";

/**
 * A fake vendor CLI emitting Claude stream-json tool calls.
 *
 * `same` repeats one call forever and only stops when signalled — the stuck
 * agent. `varied` changes its arguments every time and finishes on its own —
 * a poll that is getting somewhere.
 */
const FAKE_CLI = `
import { writeFileSync } from "node:fs";
const mode = process.argv[2];
if (process.env.HENCH_TEST_CHILD_PID) {
  writeFileSync(process.env.HENCH_TEST_CHILD_PID, String(process.pid));
}
let n = 0;
const timer = setInterval(() => {
  if (mode === "varied" && n >= 30) {
    clearInterval(timer);
    process.stdout.write(JSON.stringify({ type: "result", result: "done", num_turns: 30 }) + "\\n");
    process.exit(0);
  }
  if (mode === "plan") {
    process.stdout.write(JSON.stringify({
      type: "assistant",
      session_id: "session-1",
      message: { content: [{ type: "tool_use", name: "ExitPlanMode", input: { plan: "Implement it." } }] },
    }) + "\\n");
    return;
  }
  const input = mode === "same" ? { bash_id: "b1" } : { bash_id: "b" + n };
  n++;
  // A turn is a text assistant message followed by its tool call, which is the
  // shape hench counts turns from.
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "session-1",
    message: { content: [{ type: "text", text: "checking" }], usage: { input_tokens: 10, output_tokens: 2 } },
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "session-1",
    message: { content: [{ type: "tool_use", name: "BashOutput", input }] },
  }) + "\\n");
}, 5);
process.on("SIGTERM", () => { clearInterval(timer); process.exit(143); });
`;

/**
 * POSIX records the child's own pid. On win32 `spawnCli` goes through cmd.exe,
 * so the recorded pid is the wrapper's: it lives exactly as long as the CLI,
 * which is all liveness needs, but it differs from the child's self-reported pid.
 */
function expectVendorPid(vendorPid: number | undefined, childPid: string): void {
  if (process.platform !== "win32") {
    expect(vendorPid).toBe(Number(childPid));
    return;
  }
  expect(Number.isInteger(vendorPid)).toBe(true);
  expect(vendorPid).toBeGreaterThan(0);
  expect(() => process.kill(vendorPid as number, 0)).not.toThrow();
}

describe("livelock intercept in spawnWithAdapter", () => {
  let dir: string;
  let script: string;
  let pidFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-test-livelock-spawn-"));
    script = join(dir, "fake-cli.mjs");
    pidFile = join(dir, "child.pid");
    await writeFile(script, FAKE_CLI, "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function spawn(
    mode: "same" | "varied" | "plan",
    threshold: number,
    liveProgress = createLiveSpawnProgress(),
  ) {
    return spawnWithAdapter({
      adapter: claudeCliAdapter,
      spawnConfig: {
        binary: process.execPath,
        args: [script, mode],
        env: { ...process.env, HENCH_TEST_CHILD_PID: pidFile },
        stdinContent: null,
        cwd: dir,
      },
      cliBinary: process.execPath,
      cliEnv: { ...process.env, HENCH_TEST_CHILD_PID: pidFile },
      cwd: dir,
      tokenMetadata: { vendor: "claude", model: "sonnet" },
      livelock: createLivelockDetector({ threshold }),
      liveProgress,
    });
  }

  async function expectChildToBeGone(): Promise<void> {
    const pid = Number(await readFile(pidFile, "utf-8"));
    expect(Number.isInteger(pid)).toBe(true);
    expect(() => process.kill(pid, 0)).toThrow();
  }

  async function waitFor(condition: () => boolean, deadlineMs = 10_000): Promise<void> {
    const start = Date.now();
    while (!condition() && Date.now() - start < deadlineMs) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(condition()).toBe(true);
  }

  it("kills a child that keeps making the same call, and says which call", async () => {
    const result = await spawn("same", 4);

    expect(result.livelock).toBeDefined();
    expect(result.livelock!.tool).toBe("BashOutput");
    expect(result.livelock!.repeats).toBe(4);
    // The error the outer loop reports is the livelock, not "exited with 143" —
    // which would read as transient and buy the loop a retry.
    expect(result.error).toBe(result.livelock!.message);
    expect(result.error).toContain("BashOutput");
    await expectChildToBeGone();
  }, 20_000);

  it("terminates the real child after intercepting plan mode", async () => {
    const result = await spawn("plan", 4);

    expect(result.planModeIntercept).toEqual({ planText: "Implement it." });
    await expectChildToBeGone();
  }, 20_000);

  it("leaves a child alone while its calls keep differing", async () => {
    // Same tool, different arguments every time, thirty calls deep — well past
    // a threshold of four. It must run to its own completion.
    const result = await spawn("varied", 4);

    expect(result.livelock).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.toolCalls.length).toBeGreaterThan(4);
  }, 20_000);

  it("reports turns while the spawn is still running", async () => {
    // The second half of #362: the heartbeat kept saving 0 turns / 0 tokens for
    // a run that was forty turns deep, so the dashboard drew it as idle. These
    // are the counters the heartbeat folds onto the record mid-spawn.
    const progress = createLiveSpawnProgress();
    const spawned = spawn("varied", 0, progress);
    let completed = false;
    void spawned.then(
      () => { completed = true; },
      () => { completed = true; },
    );

    await waitFor(() => progress.turns > 0);
    expect(completed).toBe(false);

    const result = await spawned;
    expect(result.error).toBeUndefined();
    expect(result.toolCalls.length).toBeGreaterThan(0);
  }, 20_000);

  it("exposes the child's pid while it runs and clears it once it closes", async () => {
    // What the heartbeat reads to write `vendorPid` onto the run record.
    const progress = createLiveSpawnProgress();
    const spawned = spawn("varied", 0, progress);

    await waitFor(() => progress.turns > 0);
    expectVendorPid(progress.vendorPid, await readFile(pidFile, "utf-8"));

    await spawned;
    expect(progress.vendorPid).toBeUndefined();
  }, 20_000);

  it("records the pid in a pid-only holder without touching run counters (review, orientation)", async () => {
    // Review and orientation spawns are charged to the run another way, so they
    // pass a holder that must see the pid but never the turns or tokens.
    const holder: { vendorPid?: number } = {};
    const spawned = spawnWithAdapter({
      adapter: claudeCliAdapter,
      spawnConfig: {
        binary: process.execPath,
        args: [script, "varied"],
        env: { ...process.env, HENCH_TEST_CHILD_PID: pidFile },
        stdinContent: null,
        cwd: dir,
      },
      cliBinary: process.execPath,
      cliEnv: { ...process.env, HENCH_TEST_CHILD_PID: pidFile },
      cwd: dir,
      tokenMetadata: { vendor: "claude", model: "sonnet" },
      pidHolder: holder,
    });

    await waitFor(() => holder.vendorPid !== undefined);
    const livePid = holder.vendorPid;
    // The child writes its own pid on startup; wait for that before comparing.
    let childPid = "";
    for (let i = 0; i < 200 && childPid === ""; i++) {
      childPid = await readFile(pidFile, "utf-8").catch(() => "");
      if (childPid === "") await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expectVendorPid(livePid, childPid);

    await spawned;
    expect(holder.vendorPid).toBeUndefined();
  }, 20_000);
});
