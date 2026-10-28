/**
 * Claude tool results on hench's CLI run loop.
 *
 * Claude's stream-json answers tool calls on a `user` line, one tool_result
 * block per call, each naming its call's `tool_use_id`. This drives
 * `spawnWithAdapter` against a stand-in CLI replaying a recorded turn — two
 * parallel calls answered on one line — and checks that both results are
 * recorded on their own calls, while turns, completion and token totals match
 * the same turn with the result line removed.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnWithAdapter } from "../../src/agent/lifecycle/cli-loop.js";
import type { SpawnResult } from "../../src/agent/lifecycle/cli-loop.js";
import { claudeCliAdapter } from "../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { EventAccumulator } from "../../src/agent/lifecycle/event-accumulator.js";

const SESSION = "5f0c2a64-0d55-4c1e-9b7e-1f3f1f9c2b11";

/** A recorded Claude CLI stream-json turn: two parallel Reads, answered on one `user` line. */
const TURN: object[] = [
  { type: "system", subtype: "init", session_id: SESSION, tools: ["Read"], model: "claude-sonnet-4-5" },
  {
    type: "assistant", session_id: SESSION, parent_tool_use_id: null,
    message: {
      id: "msg_01", type: "message", role: "assistant", model: "claude-sonnet-4-5",
      content: [{ type: "text", text: "Reading both files." }],
      usage: { input_tokens: 120, output_tokens: 9 },
    },
  },
  {
    type: "assistant", session_id: SESSION, parent_tool_use_id: null,
    message: {
      id: "msg_01", type: "message", role: "assistant", model: "claude-sonnet-4-5",
      content: [{ type: "tool_use", id: "toolu_01A", name: "Read", input: { file_path: "/repo/a.ts" } }],
      usage: { input_tokens: 120, output_tokens: 9 },
    },
  },
  {
    type: "assistant", session_id: SESSION, parent_tool_use_id: null,
    message: {
      id: "msg_01", type: "message", role: "assistant", model: "claude-sonnet-4-5",
      content: [{ type: "tool_use", id: "toolu_01B", name: "Read", input: { file_path: "/repo/b.ts" } }],
      usage: { input_tokens: 120, output_tokens: 9 },
    },
  },
  {
    type: "user", session_id: SESSION, parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        { tool_use_id: "toolu_01A", type: "tool_result", content: "     1\texport const a = 1;" },
        { tool_use_id: "toolu_01B", type: "tool_result", content: [{ type: "text", text: "     1\texport const b = 2;" }] },
      ],
    },
    tool_use_result: { type: "text", file: { filePath: "/repo/b.ts", numLines: 1 } },
  },
  {
    type: "assistant", session_id: SESSION, parent_tool_use_id: null,
    message: {
      id: "msg_02", type: "message", role: "assistant", model: "claude-sonnet-4-5",
      content: [{ type: "text", text: "Both files export one constant." }],
      usage: { input_tokens: 180, output_tokens: 11 },
    },
  },
  { type: "result", subtype: "success", is_error: false, num_turns: 2, result: "Both files export one constant.", session_id: SESSION },
];

const FAKE_CLI = `
import { readFileSync } from "node:fs";
for (const line of readFileSync(process.argv[2], "utf-8").split("\\n")) {
  if (line) process.stdout.write(line + "\\n");
}
`;

describe("Claude tool results in spawnWithAdapter", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-test-claude-tool-results-"));
    await writeFile(join(dir, "fake-cli.mjs"), FAKE_CLI, "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function replay(lines: object[], accumulator?: EventAccumulator): Promise<SpawnResult> {
    const file = join(dir, `turn-${lines.length}.jsonl`);
    await writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8");
    return spawnWithAdapter({
      adapter: claudeCliAdapter,
      spawnConfig: { binary: process.execPath, args: [join(dir, "fake-cli.mjs"), file], env: process.env, stdinContent: null, cwd: dir },
      cliBinary: process.execPath,
      cliEnv: process.env,
      cwd: dir,
      tokenMetadata: { vendor: "claude", model: "claude-sonnet-4-5" },
      ...(accumulator ? { useEventPipeline: true, accumulator } : {}),
    });
  }

  const withoutResults = TURN.filter((l) => (l as { type: string }).type !== "user");

  it("records each result on the call it names, leaving turns, completion and tokens unchanged", async () => {
    const result = await replay(TURN);
    const baseline = await replay(withoutResults);

    expect(result.toolCalls.map((c) => [c.input.file_path, c.output])).toEqual([
      ["/repo/a.ts", "     1\texport const a = 1;"],
      ["/repo/b.ts", "     1\texport const b = 2;"],
    ]);
    expect(baseline.toolCalls.map((c) => c.output)).toEqual(["", ""]);
    expect(result.turns).toBe(baseline.turns);
    expect(result.summary).toBe(baseline.summary);
    expect(result.error).toBeUndefined();
    expect(result.tokenUsage).toEqual(baseline.tokenUsage);
    expect(result.turnTokenUsage).toEqual(baseline.turnTokenUsage);
  }, 20_000);

  it("pushes one tool_result event per block onto the event pipeline", async () => {
    const acc = new EventAccumulator();
    const baselineAcc = new EventAccumulator();
    const result = await replay(TURN, acc);
    const baseline = await replay(withoutResults, baselineAcc);

    expect(acc.events.filter((e) => e.type === "tool_result").map((e) => e.toolResult?.callId))
      .toEqual(["toolu_01A", "toolu_01B"]);
    expect(acc.events.filter((e) => e.type === "tool_use").map((e) => e.toolCall?.id))
      .toEqual(["toolu_01A", "toolu_01B"]);
    expect(acc.toolCalls.calls.map((c) => c.output))
      .toEqual(["     1\texport const a = 1;", "     1\texport const b = 2;"]);
    expect(acc.maxTurn).toBe(baselineAcc.maxTurn);
    expect(acc.completionSummary).toBe(baselineAcc.completionSummary);
    expect(acc.tokenUsage.total).toEqual(baselineAcc.tokenUsage.total);
    expect(result.turns).toBe(baseline.turns);
  }, 20_000);
});
