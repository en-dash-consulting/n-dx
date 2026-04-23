/**
 * Tests for the viewer-side `getTaskDuration` port.
 *
 * This file pins the semantics of the client copy of rex's
 * `getTaskDuration`. The two implementations must stay in sync —
 * if rex changes, update the port and these tests (and the parity
 * assertions in the rex unit suite should break first).
 *
 * @see packages/rex/src/core/durations.ts — canonical implementation
 */
import { describe, it, expect } from "vitest";
import { getTaskDuration } from "../../../src/viewer/components/prd-tree/durations.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

function makeItem(overrides: Partial<PRDItemData> = {}): PRDItemData {
  return {
    id: "id-1",
    title: "t",
    level: "task",
    status: "pending",
    ...overrides,
  };
}

describe("getTaskDuration (viewer port)", () => {
  it("returns {0, false, hasRecord:false} for never-started tasks", () => {
    const d = getTaskDuration(makeItem({ status: "pending" }), 1_700_000_000_000);
    expect(d).toEqual({ elapsedMs: 0, isRunning: false, hasRecord: false });
  });

  it("sums closed active intervals", () => {
    const d = getTaskDuration(makeItem({
      status: "completed",
      activeIntervals: [
        { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:00:05.000Z" },
        { start: "2026-01-01T00:00:10.000Z", end: "2026-01-01T00:00:15.000Z" },
      ],
    }), 2_000_000_000_000);
    expect(d.elapsedMs).toBe(10_000);
    expect(d.isRunning).toBe(false);
    expect(d.hasRecord).toBe(true);
  });

  it("treats an open interval's end as `now`", () => {
    const d = getTaskDuration(makeItem({
      status: "in_progress",
      activeIntervals: [
        { start: "2026-01-01T00:00:00.000Z" },
      ],
    }), Date.parse("2026-01-01T00:00:07.500Z"));
    expect(d.elapsedMs).toBe(7500);
    expect(d.isRunning).toBe(true);
    expect(d.hasRecord).toBe(true);
  });

  it("skips malformed intervals without throwing", () => {
    const d = getTaskDuration(makeItem({
      status: "completed",
      activeIntervals: [
        { start: "not-a-date", end: "also-not-a-date" },
        { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:00:00.000Z" }, // zero-length valid
        { start: "2026-01-01T00:00:10.000Z", end: "2026-01-01T00:00:00.000Z" }, // inverted, skipped
        { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:00:04.000Z" },
      ],
    }), 0);
    expect(d.elapsedMs).toBe(4000);
    expect(d.hasRecord).toBe(true);
  });

  it("falls back to startedAt/endedAt for legacy items", () => {
    const d = getTaskDuration(makeItem({
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:12.000Z",
    }), 0);
    expect(d.elapsedMs).toBe(12_000);
    expect(d.hasRecord).toBe(true);
  });

  it("falls back to startedAt/completedAt when endedAt absent", () => {
    const d = getTaskDuration(makeItem({
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:30.000Z",
    }), 0);
    expect(d.elapsedMs).toBe(90_000);
  });

  it("uses `now` as the virtual end for legacy running items", () => {
    const nowMs = Date.parse("2026-01-01T00:00:05.000Z");
    const d = getTaskDuration(makeItem({
      status: "in_progress",
      startedAt: "2026-01-01T00:00:00.000Z",
    }), nowMs);
    expect(d.elapsedMs).toBe(5000);
    expect(d.isRunning).toBe(true);
    expect(d.hasRecord).toBe(true);
  });
});
