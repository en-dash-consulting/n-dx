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
});
