/**
 * Codex file edits must register as progress with the livelock detector.
 *
 * The defect (GH #370 review, finding 3): every command Codex runs reaches the
 * detector as one tool named `shell`, and `file_change` items were not mapped at
 * all. A patch-then-retest loop therefore looked like six identical
 * `shell({"command":"pnpm test"})` calls with nothing written in between, and
 * `spawnWithAdapter` SIGTERMed a child that was making progress every cycle.
 *
 * This exercises the real contract — `codexCliAdapter.parseEvent` feeding
 * `createLivelockDetector`, filtered exactly as `cli-loop.ts`'s `processLine`
 * filters — rather than hand-built observations, because the bug lived in the
 * seam between the two and either half passes its own unit tests.
 *
 * @see packages/hench/src/agent/lifecycle/adapters/codex-cli-adapter.ts
 * @see packages/hench/src/agent/analysis/livelock.ts
 */

import { describe, it, expect } from "vitest";
import { codexCliAdapter } from "../../src/agent/lifecycle/adapters/codex-cli-adapter.js";
import {
  createLivelockDetector,
  DEFAULT_LIVELOCK_THRESHOLD,
} from "../../src/agent/analysis/livelock.js";
import type { LivelockDetection } from "../../src/agent/analysis/livelock.js";
import { EventAccumulator } from "../../src/agent/lifecycle/event-accumulator.js";

const TEST_COMMAND = '/bin/zsh -lc "pnpm test"';

/** `codex exec --json` announces a command before running it. */
const SHELL_STARTED = JSON.stringify({
  type: "item.started",
  item: { type: "command_execution", command: TEST_COMMAND },
});

/** …and reports its output when it finishes. */
const SHELL_COMPLETED = JSON.stringify({
  type: "item.completed",
  item: { type: "command_execution", status: "completed", stdout: "1 test failed" },
});

/** A patch Codex applied after reading that output. */
const FILE_CHANGED = JSON.stringify({
  type: "item.completed",
  item: {
    type: "file_change",
    status: "completed",
    changes: [{ path: "src/thing.ts", kind: "update" }],
  },
});

/**
 * Replay JSONL lines the way `spawnWithAdapter` does: parse each through the
 * adapter, and show the detector only `tool_use` events.
 */
function replay(lines: string[]): LivelockDetection | null {
  const detector = createLivelockDetector({ threshold: DEFAULT_LIVELOCK_THRESHOLD });
  for (const line of lines) {
    const event = codexCliAdapter.parseEvent(line, 1, {});
    if (event?.type === "tool_use" && event.toolCall) {
      detector.record({ tool: event.toolCall.tool, input: event.toolCall.input });
    }
  }
  return detector.detected;
}

/** Eight iterations of the loop, with or without the patch in the middle. */
function cycles(count: number, withFileChange: boolean): string[] {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(SHELL_STARTED, SHELL_COMPLETED);
    if (withFileChange) lines.push(FILE_CHANGED);
  }
  return lines;
}

describe("Codex livelock progress crediting", () => {
  it("does not fire on an edit-then-retest loop", () => {
    // Eight iterations is comfortably past the default threshold of six; the
    // patch between them is what keeps the run alive.
    expect(replay(cycles(8, true))).toBeNull();
  });

  it("still fires when the same command repeats with no edit between", () => {
    const detection = replay(cycles(8, false));

    expect(detection).not.toBeNull();
    expect(detection!.tool).toBe("shell");
    expect(detection!.repeats).toBe(DEFAULT_LIVELOCK_THRESHOLD);
    expect(detection!.message).toContain("pnpm test");
  });

  it("does not credit a patch Codex failed to apply", () => {
    const failed = JSON.stringify({
      type: "item.completed",
      item: { type: "file_change", status: "failed", changes: [{ path: "src/thing.ts", kind: "update" }] },
    });

    const lines: string[] = [];
    for (let i = 0; i < 8; i++) lines.push(SHELL_STARTED, SHELL_COMPLETED, failed);

    expect(replay(lines)).not.toBeNull();
  });

  it("leaves the accumulator's tool_use/tool_result pairing intact", () => {
    // The synthesised `apply_patch` has no matching `tool_result`. The
    // accumulator must record it with an empty output rather than stealing the
    // shell call's, or dropping either record.
    const accumulator = new EventAccumulator();
    for (const line of cycles(1, true)) {
      const event = codexCliAdapter.parseEvent(line, 1, {});
      if (event) accumulator.push(event);
    }

    const calls = accumulator.toolCalls.calls;
    expect(calls.map((c) => c.tool)).toEqual(["shell", "apply_patch"]);
    expect(calls[0].output).toBe("1 test failed");
    expect(calls[1].output).toBe("");
  });
});
