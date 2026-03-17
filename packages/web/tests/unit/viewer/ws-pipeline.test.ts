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
