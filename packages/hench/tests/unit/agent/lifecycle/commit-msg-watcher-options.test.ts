/**
 * The options cli-loop hands the timer-expiry watcher carry the run's
 * trailers, so the auto-commit gets an N-DX-Item. commit-msg-timer.test.ts
 * proves the watcher applies trailers it is given; this proves it is given them.
 */

import { describe, it, expect } from "vitest";
import { commitMsgWatcherOptions } from "../../../../src/agent/lifecycle/shared.js";
import type { RunRecord } from "../../../../src/schema/index.js";

const TASK = "cbd8c3bf-task";
const run = { id: "run-1", taskId: TASK, vendor: "claude", model: "opus" } as RunRecord;

describe("commitMsgWatcherOptions", () => {
  it("passes the task's N-DX-Item trailer to the watcher", () => {
    const opts = commitMsgWatcherOptions(run, TASK, {}, "/proj");
    expect(opts.trailers).toContain(`N-DX-Item: ${TASK}`);
    expect(opts.trailers).toContain("N-DX: claude/opus · run run-1");
  });

  it("wires the project, run origin and timeout", () => {
    const opts = commitMsgWatcherOptions(run, TASK, { commitMsgTimeoutMs: 5000 }, "/proj");
    expect(opts).toMatchObject({ projectDir: "/proj", timeoutMs: 5000, origin: run });
  });

  it("defaults the timer to off", () => {
    expect(commitMsgWatcherOptions(run, TASK, {}, "/proj").timeoutMs).toBe(0);
  });
});
