/**
 * The bounds `spawnWithAdapter` puts on a vendor CLI session: the operator's
 * abort signal, the wall-clock limit (`guard.sessionTimeout`), the turn cap
 * for a vendor without a turn flag, the Claude CLI's own `--max-turns` stop,
 * and the pre-spawn spend gate.
 *
 * Each stop has to kill a real child, so this drives a stand-in CLI that
 * emits Claude stream-json and never exits on its own. A bound that failed to
 * terminate it would hang the test.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnWithAdapter } from "../../src/agent/lifecycle/cli-loop.js";
import { claudeCliAdapter } from "../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import type { VendorAdapter } from "../../src/agent/lifecycle/vendor-adapter.js";
import { liveVendorProcessCount } from "../../src/process/run-interrupt.js";

/**
 * `forever` emits a text turn then a tool call every 10ms until signalled.
 * `max-turns` emits one turn then the Claude CLI's `error_max_turns` result.
 * `slow` prints nothing and waits to be killed.
 */
const FAKE_CLI = `
import { writeFileSync } from "node:fs";
const mode = process.argv[2];
if (process.env.HENCH_TEST_CHILD_PID) writeFileSync(process.env.HENCH_TEST_CHILD_PID, String(process.pid));
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
process.on("SIGTERM", () => process.exit(143));
if (mode === "tools") {
  out({ type: "assistant", session_id: "s", message: { content: [{ type: "tool_use", id: "tu-a", name: "Read", input: { file_path: "a.ts" } }] } });
  out({ type: "assistant", session_id: "s", message: { content: [{ type: "tool_use", id: "tu-b", name: "Bash", input: { command: "ls" } }] } });
  out({ type: "user", session_id: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-a", content: "contents of a" }] } });
  out({ type: "user", session_id: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-b", is_error: true, content: [{ type: "text", text: "x".repeat(5000) }] }] } });
  out({ type: "result", subtype: "success", result: "done", num_turns: 2, session_id: "s" });
  process.exit(0);
}
if (mode === "max-turns") {
  out({ type: "assistant", session_id: "s", message: { content: [{ type: "text", text: "working" }] } });
  out({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 3, session_id: "s" });
  process.exit(0);
}
let n = 0;
setInterval(() => {
  if (mode === "slow") return;
  n++;
  out({ type: "assistant", session_id: "s", message: { content: [{ type: "text", text: "step " + n }] } });
  out({ type: "assistant", session_id: "s", message: { content: [{ type: "tool_use", id: "tu" + n, name: "Read", input: { file_path: "f" + n } }] } });
}, 10);
`;

describe("spawnWithAdapter session bounds", () => {
  let dir: string;
  let script: string;
  let pidFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-test-session-bounds-"));
    script = join(dir, "fake-cli.mjs");
    pidFile = join(dir, "child.pid");
    await writeFile(script, FAKE_CLI, "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function spawn(
    mode: "forever" | "max-turns" | "slow" | "tools",
    extra: Partial<Parameters<typeof spawnWithAdapter>[0]> = {},
    adapter: VendorAdapter = claudeCliAdapter,
  ) {
    return spawnWithAdapter({
      adapter,
      spawnConfig: { binary: process.execPath, args: [script, mode], env: {}, stdinContent: null, cwd: dir },
      cliBinary: process.execPath,
      cliEnv: { ...process.env, HENCH_TEST_CHILD_PID: pidFile },
      cwd: dir,
      tokenMetadata: { vendor: "claude", model: "sonnet" },
      ...extra,
    });
  }

  async function expectChildGone(): Promise<void> {
    const pid = Number(await readFile(pidFile, "utf-8"));
    expect(Number.isInteger(pid)).toBe(true);
    expect(() => process.kill(pid, 0)).toThrow();
  }

  async function waitForPidFile(): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      try {
        await readFile(pidFile, "utf-8");
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    throw new Error("child never started");
  }

  it("an abort terminates the running CLI and reports the reason", async () => {
    const controller = new AbortController();
    const pending = spawn("forever", { abortSignal: controller.signal });
    await waitForPidFile();
    expect(liveVendorProcessCount()).toBeGreaterThan(0);
    controller.abort(new Error("Interrupted by SIGINT"));
    const result = await pending;

    expect(result.aborted).toEqual({ reason: "Interrupted by SIGINT" });
    expect(result.error).toBe("Interrupted by SIGINT");
    await expectChildGone();
    expect(liveVendorProcessCount()).toBe(0);
  });

  it("an already-aborted signal starts no process", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Interrupted by SIGTERM"));
    const result = await spawn("forever", { abortSignal: controller.signal });

    expect(result.aborted?.reason).toBe("Interrupted by SIGTERM");
    await expect(readFile(pidFile, "utf-8")).rejects.toThrow();
  });

  it("the session time limit terminates the tree and marks the result timed out", async () => {
    const result = await spawn("slow", { timeoutMs: 300 });

    expect(result.timedOut).toEqual({ timeoutMs: 300 });
    expect(result.error).toMatch(/exceeded guard\.sessionTimeout/);
    // Not the synthesized exit-code text, which the retry classifier reads as transient.
    expect(result.error).not.toMatch(/exited with code/);
    await expectChildGone();
  });

  it("a time limit of 0 sets no timer", async () => {
    const controller = new AbortController();
    const pending = spawn("slow", { timeoutMs: 0, abortSignal: controller.signal });
    await new Promise((r) => setTimeout(r, 400));
    controller.abort();
    const result = await pending;
    expect(result.timedOut).toBeUndefined();
    expect(result.aborted).toBeDefined();
  });

  it("caps turns for a vendor without a turn flag by counting agent steps", async () => {
    const noFlag: VendorAdapter = { ...claudeCliAdapter, enforcesTurnCap: false };
    const result = await spawn("forever", { maxTurns: 5 }, noFlag);

    expect(result.turnCapExceeded?.maxTurns).toBe(5);
    expect(result.turnCapExceeded?.turns).toBe(6);
    expect(result.error).toBe("Exceeded max turns (5)");
    await expectChildGone();
  });

  it("leaves the turn cap to a vendor that enforces it, and labels its max-turns stop", async () => {
    const result = await spawn("max-turns", { maxTurns: 3 });

    expect(result.turnCapExceeded).toEqual({ maxTurns: 3, turns: 3 });
    expect(result.error).toBe("Exceeded max turns (3)");
  });

  for (const useEventPipeline of [false, true]) {
    it(`records each tool result on the call it answers (${useEventPipeline ? "event pipeline" : "legacy"} path)`, async () => {
      const { EventAccumulator } = await import("../../src/agent/lifecycle/event-accumulator.js");
      const result = await spawn("tools", {
        useEventPipeline,
        ...(useEventPipeline ? { accumulator: new EventAccumulator() } : {}),
      });

      expect(result.error).toBeUndefined();
      expect(result.toolCalls.map((c) => c.tool)).toEqual(["Read", "Bash"]);
      // Paired by tool_use_id, not by "the last call": both results arrive
      // after both invocations.
      expect(result.toolCalls[0].output).toBe("contents of a");
      expect(result.toolCalls[1].output.startsWith("[error] xxx")).toBe(true);
      // Truncated to the CLI path's existing cap.
      expect(result.toolCalls[1].output.length).toBe(2000);
    });
  }

  it("a reached spend cap starts no process", async () => {
    const result = await spawn("forever", {
      spendGate: async () => ({
        cap: "maxCostUsdPerRun",
        limitUsd: 1,
        spentUsd: 1.5,
        message: "Spend cap reached: this run has spent $1.50 of its hench.maxCostUsdPerRun $1.00.",
      }),
    });

    expect(result.budgetExceeded?.cap).toBe("maxCostUsdPerRun");
    expect(result.error).toMatch(/maxCostUsdPerRun \$1\.00/);
    await expect(readFile(pidFile, "utf-8")).rejects.toThrow();
  });
});
