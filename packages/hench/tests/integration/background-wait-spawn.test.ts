/**
 * The background-wait signal on a real spawn (PR BG).
 *
 * Unlike the plan-mode and livelock intercepts, recording a background wait
 * must not kill the child: an agent that backgrounds a dev server and then
 * finishes its work in the foreground is doing nothing wrong. Only a real
 * spawn shows that the session is left to run to its own end.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnWithAdapter } from "../../src/agent/lifecycle/cli-loop.js";
import { claudeCliAdapter } from "../../src/agent/lifecycle/adapters/claude-cli-adapter.js";

const FAKE_CLI = `
const say = (line) => process.stdout.write(JSON.stringify(line) + "\\n");
const session = "sess-spawn-1";
say({ type: "system", subtype: "init", session_id: session });
say({ type: "assistant", session_id: session, message: { content: [
  { type: "tool_use", name: "Bash", input: { command: "pnpm dev", run_in_background: true } },
] } });
say({ type: "assistant", session_id: session, message: { content: [
  { type: "tool_use", name: "Monitor", input: {} },
] } });
// Still running after the signal: a killed child would never print this.
setTimeout(() => {
  say({ type: "assistant", session_id: session, message: { content: [{ type: "text", text: "finished in the foreground" }] } });
  say({ type: "result", subtype: "success", session_id: session, result: "finished in the foreground", num_turns: 3 });
  process.exit(0);
}, 50);
`;

describe("background-wait signal in spawnWithAdapter", () => {
  let dir: string;
  let script: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-test-bg-spawn-"));
    script = join(dir, "fake-cli.mjs");
    await writeFile(script, FAKE_CLI, "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("records the most recent background call and lets the session finish on its own", async () => {
    const result = await spawnWithAdapter({
      adapter: claudeCliAdapter,
      spawnConfig: { binary: process.execPath, args: [script], env: process.env, stdinContent: null, cwd: dir },
      cliBinary: process.execPath,
      cwd: dir,
      tokenMetadata: { vendor: "claude", model: "sonnet" },
    });

    expect(result.backgroundWait).toEqual({ tool: "Monitor", detail: "" });
    expect(result.error).toBeUndefined();
    expect(result.summary).toBe("finished in the foreground");
    expect(result.sessionId).toBe("sess-spawn-1");
  }, 20_000);
});
