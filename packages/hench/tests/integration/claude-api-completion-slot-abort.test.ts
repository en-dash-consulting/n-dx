/**
 * The Claude API loop's completion check runs the project test command inside
 * the host validation slot. When another holder has the slot, the first Ctrl-C
 * (run.ts aborting the run's signal) must end that wait: the test command must
 * never start after cancellation.
 *
 * The local-provider gate test (local-tool-loop.test.ts) covers the finalize
 * gate; this covers the completion check the Claude API loop runs before it.
 *
 * @see packages/hench/src/agent/lifecycle/loop.ts — rejectUnvalidatedCompletion
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
    models = { list: vi.fn() };
  },
}));

import { commitGitFixtureBaseline, disableMemoryGuard } from "../helpers/index.js";
import { initConfig } from "../../src/store/config.js";

/** One scripted Messages API response. */
function toolTurn(id: string, name: string, input: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `msg-${id}`, type: "message", role: "assistant", model: "claude-sonnet-4-6",
    content: [{ type: "tool_use", id, name, input }],
    stop_reason: "tool_use", stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}

const writeAndComplete = [
  toolTurn("call-1", "write_file", { path: "api-output.ts", content: "export const source = 'api';\n" }),
  toolTurn("call-2", "git", { subcommand: "add", args: "api-output.ts" }),
  toolTurn("call-3", "write_file", { path: ".hench-commit-msg.txt", content: "feat: write api output\n" }),
  {
    id: "msg-done", type: "message", role: "assistant", model: "claude-sonnet-4-6",
    content: [{ type: "text", text: "Done — the file is written." }],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  },
];

describe("Claude API completion check inside the validation slot", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-api-slot-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await disableMemoryGuard(henchDir);

    const rexDir = join(projectDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    // `test` is the project test command the completion check runs.
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({
        schema: "rex/v1", project: "test", adapter: "file",
        test: `node -e "require('fs').writeFileSync('completion-test-ran', '')"`,
      }),
      "utf-8",
    );
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "Test",
        items: [{ id: "task-1", title: "Write the output file", status: "pending", level: "task", priority: "high" }],
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude", claude: { api_key: "sk-ant-test" } } }),
      "utf-8",
    );
    commitGitFixtureBaseline(projectDir);

    let call = 0;
    create.mockReset();
    create.mockImplementation(async () => writeAndComplete[Math.min(call++, writeAndComplete.length - 1)]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("ends a completion check queued behind another holder when the run's signal aborts, without running the test", async () => {
    const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { acquireValidationSlot } = await import("../../src/process/validation-slot.js");
    const { resolveValidationSlotDir } = await import("../../src/process/validation-slot-dir.js");

    const config = await loadConfig(henchDir);
    config.provider = "api";
    // Isolate the completion check: the finalize gate has its own test.
    config.skipFullTestGate = true;
    config.testGate = { ...config.testGate, hostSlot: true };
    // The API loop judges plan-only from the final turn alone; this script
    // writes in earlier turns, so its re-prompt would only add turns.
    config.planOnlyMaxRetries = 0;
    const store = createStore("file", join(projectDir, ".rex"));

    // The slot directory is the per-worker temp ndx home (tests/setup-ndx-home.js).
    const lease = await acquireValidationSlot({ slotDir: await resolveValidationSlotDir(), projectDir: "/elsewhere", env: {} });
    const controller = new AbortController();
    let waits = 0;
    let releaseTimer: NodeJS.Timeout | undefined;
    const log = console.log;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes("Waiting for the validation slot")) {
        waits++;
        // The first Ctrl-C. Nothing else interrupts the wait; if the signal
        // does not reach it, the holder leaves shortly after and the test
        // command starts — which the assertions below catch.
        controller.abort(new Error("interrupted"));
        releaseTimer ??= setTimeout(() => void lease.release(), 2_000);
      }
      log(...args);
    });
    try {
      const { run } = await agentLoop({
        config, store, projectDir, henchDir,
        model: "claude-sonnet-4-6", yes: true, autonomous: true,
        abortSignal: controller.signal,
      });
      expect(waits).toBeGreaterThan(0);
      expect(existsSync(join(projectDir, "completion-test-ran"))).toBe(false);
      expect(run.status).toBe("failed");
      expect(run.error).toMatch(/^Tests did not run/);
    } finally {
      if (releaseTimer) clearTimeout(releaseTimer);
      await lease.release();
    }
  });
});
