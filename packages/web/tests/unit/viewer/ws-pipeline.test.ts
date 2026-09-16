/**
 * Tests for the composed WebSocket pipeline (throttle → coalescer).
 *
 * Verifies that createWSPipeline correctly composes per-type throttling
 * with message coalescing, provides flush/dispose lifecycle, and supports
 * immediate per-message callbacks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createWSPipeline,
  frameIsForWorkspace,
  type WSPipeline,
  type CoalescedBatch,
  type ParsedWSMessage,
} from "../../../src/viewer/messaging/index.js";

function msg(type: string, extra: Record<string, unknown> = {}): ParsedWSMessage {
  return { type, ...extra };
}

describe("createWSPipeline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("batches messages and flushes through onFlush", () => {
    const onFlush = vi.fn();
    const pipeline = createWSPipeline({
      onFlush,
      throttledTypes: ["update"],
      delays: { update: 100 },
    });

    pipeline.push(msg("update", { id: "1" }));
    pipeline.push(msg("update", { id: "2" }));

    // Throttle hasn't fired yet
    expect(onFlush).not.toHaveBeenCalled();

    // Advance past throttle delay
    vi.advanceTimersByTime(100);

    // Throttle forwards to coalescer, but coalescer has its own window
    vi.advanceTimersByTime(200);

    expect(onFlush).toHaveBeenCalled();
    const batch: CoalescedBatch = onFlush.mock.calls[0][0];
    expect(batch.types.has("update")).toBe(true);
    expect(batch.size).toBeGreaterThanOrEqual(1);

    pipeline.dispose();
  });

  it("calls onMessage immediately for each message", () => {
    const onMessage = vi.fn();
    const onFlush = vi.fn();
    const pipeline = createWSPipeline({
      onMessage,
      onFlush,
      throttledTypes: [],
    });

    pipeline.push(msg("info", { x: 1 }));
    pipeline.push(msg("info", { x: 2 }));

    // onMessage fires immediately (not throttled, passes through)
    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage.mock.calls[0][0].type).toBe("info");

    pipeline.dispose();
  });

  it("passes unthrottled types through immediately to coalescer", () => {
    const onFlush = vi.fn();
    const pipeline = createWSPipeline({
      onFlush,
      throttledTypes: ["slow"],
      coalescerWindowMs: 50,
    });

    // "fast" is not in throttledTypes — passes through throttle immediately
    pipeline.push(msg("fast"));

    // Advance past coalescer window
    vi.advanceTimersByTime(60);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].types.has("fast")).toBe(true);

    pipeline.dispose();
  });

  it("flush() forces both throttle and coalescer to flush", () => {
    const onFlush = vi.fn();
    const pipeline = createWSPipeline({
      onFlush,
      throttledTypes: ["update"],
      delays: { update: 5000 },
      coalescerWindowMs: 5000,
    });

    pipeline.push(msg("update"));

    expect(onFlush).not.toHaveBeenCalled();

    pipeline.flush();

    expect(onFlush).toHaveBeenCalledTimes(1);

    pipeline.dispose();
  });

  it("dispose() prevents further pushes", () => {
    const onFlush = vi.fn();
    const onMessage = vi.fn();
    const pipeline = createWSPipeline({
      onFlush,
      onMessage,
      throttledTypes: [],
    });

    pipeline.dispose();
    pipeline.push(msg("test"));

    vi.advanceTimersByTime(1000);

    // Nothing should have been called after dispose
    expect(onMessage).not.toHaveBeenCalled();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("dispose() is safe to call multiple times", () => {
    const pipeline = createWSPipeline({
      onFlush: vi.fn(),
    });

    expect(() => {
      pipeline.dispose();
      pipeline.dispose();
    }).not.toThrow();
  });
});

describe("frameIsForWorkspace", () => {
  it("untagged frames belong to the anchor only", () => {
    expect(frameIsForWorkspace({ type: "x" }, null)).toBe(true);
    expect(frameIsForWorkspace({ type: "x" }, "feature")).toBe(false);
  });

  it("tagged frames match their workspace; '*' matches every viewer", () => {
    expect(frameIsForWorkspace({ type: "x", workspace: "feature" }, "feature")).toBe(true);
    expect(frameIsForWorkspace({ type: "x", workspace: "feature" }, "other")).toBe(false);
    expect(frameIsForWorkspace({ type: "x", workspace: "feature" }, null)).toBe(false);
    expect(frameIsForWorkspace({ type: "x", workspace: "*" }, null)).toBe(true);
    expect(frameIsForWorkspace({ type: "x", workspace: "*" }, "feature")).toBe(true);
  });
});

describe("createWSPipeline workspace filtering", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("drops frames tagged for another workspace before throttling and batching", () => {
    const onMessage = vi.fn();
    const onFlush = vi.fn();
    const pipeline = createWSPipeline({ onMessage, onFlush, workspace: "feature", throttledTypes: [] });

    pipeline.push(msg("rex:prd-changed", { workspace: "feature" }));
    pipeline.push(msg("rex:prd-changed", { workspace: "main" }));
    pipeline.push(msg("rex:prd-changed"));               // untagged → anchor's, not ours
    pipeline.push(msg("ws:health-status", { workspace: "*" }));
    vi.runAllTimers();

    expect(onMessage).toHaveBeenCalledTimes(2);
    const flushed = onFlush.mock.calls.flatMap((c) => (c[0] as CoalescedBatch).messages.map((m) => m.workspace));
    expect(flushed.sort()).toEqual(["*", "feature"]);
    pipeline.dispose();
  });

  it("an anchor viewer accepts untagged and anchor-tagged frames but not another worktree's", () => {
    const onFlush = vi.fn();
    const pipeline = createWSPipeline({ onFlush, workspace: null, throttledTypes: [] });
    pipeline.push(msg("rex:prd-changed"));
    pipeline.push(msg("rex:prd-changed", { workspace: "feature" }));
    vi.runAllTimers();
    const flushed = onFlush.mock.calls.flatMap((c) => (c[0] as CoalescedBatch).messages);
    expect(flushed).toHaveLength(1);
    expect(flushed[0].workspace).toBeUndefined();
    pipeline.dispose();
  });

  it("accepts everything when no workspace is configured (older consumers)", () => {
    const onFlush = vi.fn();
    const pipeline = createWSPipeline({ onFlush, throttledTypes: [] });
    pipeline.push(msg("a", { workspace: "x" }));
    pipeline.push(msg("b"));
    vi.runAllTimers();
    expect(onFlush.mock.calls.flatMap((c) => (c[0] as CoalescedBatch).messages)).toHaveLength(2);
    pipeline.dispose();
  });
});
