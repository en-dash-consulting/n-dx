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

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { codexCliAdapter } from "../../src/agent/lifecycle/adapters/codex-cli-adapter.js";
import {
  createLivelockDetector,
  DEFAULT_LIVELOCK_THRESHOLD,
  isProgressTool,
} from "../../src/agent/analysis/livelock.js";
import { EventAccumulator } from "../../src/agent/lifecycle/event-accumulator.js";

/**
 * Captured from a real `codex exec --json` run that writes `capture.txt` and
 * then reads it. Its matching version file records the CLI version. Keep this
 * test tied to the JSONL rather than recreating its event objects here: this
 * seam is exactly where an unverified vendor field would silently disarm
 * livelock progress crediting.
 */
const CAPTURED_LINES = readFileSync(
  new URL("../fixtures/codex-file-change-real.jsonl", import.meta.url),
  "utf8",
).trimEnd().split(/\r?\n/);

/**
 * Replay JSONL lines the way `spawnWithAdapter` does: parse each through the
 * adapter, and show the detector only `tool_use` events.
 */
function replay(lines: readonly string[]) {
  const detector = createLivelockDetector({ threshold: DEFAULT_LIVELOCK_THRESHOLD });
  for (const line of lines) {
    const event = codexCliAdapter.parseEvent(line, 1, {});
    if (event?.type === "tool_use" && event.toolCall) {
      detector.record({ tool: event.toolCall.tool, input: event.toolCall.input });
    }
  }
  return detector.detected;
}

describe("Codex livelock progress crediting", () => {
  it("maps the real file-change stream and credits its edit as progress", () => {
    // Every captured JSONL line must pass through the adapter. In particular,
    // the `item.completed` file_change must become a progress tool rather than
    // being silently dropped as an unmapped vendor event.
    const events = CAPTURED_LINES.map((line) => codexCliAdapter.parseEvent(line, 1, {}));
    const progressEvent = events.find(
      (event) => event?.type === "tool_use" && event.toolCall && isProgressTool(event.toolCall.tool),
    );

    expect(progressEvent?.toolCall).toEqual({
      tool: "apply_patch",
      input: {
        changes: [expect.objectContaining({ kind: "add" })],
      },
    });

    // The capture settles the field names that this adapter relies on.
    const rawEvents = CAPTURED_LINES.map((line) => JSON.parse(line) as {
      type: string;
      item?: { type?: string; status?: string; changes?: unknown; aggregated_output?: string };
    });
    const fileChange = rawEvents.find((event) => event.type === "item.completed" && event.item?.type === "file_change");
    const command = rawEvents.find((event) => event.type === "item.completed" && event.item?.type === "command_execution");

    expect(fileChange?.item).toMatchObject({ type: "file_change", status: "completed" });
    expect(fileChange?.item?.changes).toEqual([expect.objectContaining({ kind: "add" })]);
    expect(command?.item?.aggregated_output).toBe("capture-ok\n");
  });

  it("does not fire when the captured edit-and-command cycle repeats", () => {
    // Repeat the one real cycle past the livelock threshold. A one-pass replay
    // would be vacuous because it cannot reach six duplicate shell calls.
    expect(replay(Array.from({ length: 8 }, () => CAPTURED_LINES).flat())).toBeNull();
  });

  it("still fires when the captured command repeats with no edit between", () => {
    const commandStarted = CAPTURED_LINES.find((line) => {
      const event = JSON.parse(line) as { type?: string; item?: { type?: string } };
      return event.type === "item.started" && event.item?.type === "command_execution";
    });
    expect(commandStarted).toBeDefined();

    const detection = replay(Array.from({ length: 8 }, () => commandStarted!));
    expect(detection).toMatchObject({ tool: "shell", repeats: DEFAULT_LIVELOCK_THRESHOLD });
  });

  it("does not credit a failed captured file change as progress", () => {
    // Preserve the failure-path guarantee while deriving every other field from
    // the real vendor capture. A failed patch must not keep an edit-then-retest
    // loop alive indefinitely.
    const failedCycle = CAPTURED_LINES.map((line) => {
      const event = JSON.parse(line) as {
        type?: string;
        item?: { type?: string; status?: string };
      };
      if (event.type !== "item.completed" || event.item?.type !== "file_change") {
        return line;
      }
      return JSON.stringify({ ...event, item: { ...event.item, status: "failed" } });
    });

    const detection = replay(Array.from({ length: 8 }, () => failedCycle).flat());
    expect(detection).toMatchObject({ tool: "shell", repeats: DEFAULT_LIVELOCK_THRESHOLD });
  });

  it("records the captured command output on its shell call", () => {
    // This capture has no interleaving: its file_change completes before the
    // command starts. If a future capture establishes the opposite ordering,
    // add the corresponding legacy applyRuntimeEvent regression before changing
    // the pairing logic.
    const fileChangeCompleted = CAPTURED_LINES.findIndex((line) => line.includes('"type":"item.completed","item":{"id":"item_1"'));
    const commandStarted = CAPTURED_LINES.findIndex((line) => line.includes('"type":"item.started","item":{"id":"item_2"'));
    expect(fileChangeCompleted).toBeGreaterThanOrEqual(0);
    expect(commandStarted).toBeGreaterThan(fileChangeCompleted);

    const accumulator = new EventAccumulator();
    for (const line of CAPTURED_LINES) {
      const event = codexCliAdapter.parseEvent(line, 1, {});
      if (event) accumulator.push(event);
    }

    const calls = accumulator.toolCalls.calls;
    expect(calls.map((c) => c.tool)).toEqual(["apply_patch", "shell"]);
    expect(calls[0].output).toBe("");
    expect(calls[1].output).toBe("capture-ok\n");
  });
});
