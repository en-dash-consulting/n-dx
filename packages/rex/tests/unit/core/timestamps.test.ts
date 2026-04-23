import { describe, it, expect, vi, afterEach } from "vitest";
import { computeTimestampUpdates } from "../../../src/core/timestamps.js";

describe("computeTimestampUpdates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets startedAt and opens an interval when moving pending → in_progress", () => {
    const now = "2025-01-15T10:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("pending", "in_progress");
    expect(result).toEqual({
      startedAt: now,
      endedAt: undefined,
      activeIntervals: [{ start: now }],
    });
  });

  it("sets completedAt/endedAt and closes the open interval on in_progress → completed", () => {
    const now = "2025-01-15T12:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("in_progress", "completed", {
      startedAt: "2025-01-15T10:00:00.000Z",
      activeIntervals: [{ start: "2025-01-15T10:00:00.000Z" }],
    });
    expect(result).toEqual({
      completedAt: now,
      endedAt: now,
      activeIntervals: [
        { start: "2025-01-15T10:00:00.000Z", end: now },
      ],
    });
  });

  it("stamps all fields when in_progress → completed with no existing interval (legacy)", () => {
    const now = "2025-01-15T12:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("in_progress", "completed");
    // No existing intervals means there's nothing to close. We still record
    // startedAt/completedAt/endedAt so duration fallback works.
    expect(result).toEqual({
      startedAt: now,
      completedAt: now,
      endedAt: now,
    });
  });

  it("records an instant interval when skipping pending → completed", () => {
    const now = "2025-01-15T12:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("pending", "completed");
    expect(result).toEqual({
      startedAt: now,
      completedAt: now,
      endedAt: now,
      activeIntervals: [{ start: now, end: now }],
    });
  });

  it("appends a new interval when re-opening a completed task", () => {
    const now = "2025-01-15T14:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const priorInterval = {
      start: "2025-01-15T10:00:00.000Z",
      end: "2025-01-15T11:00:00.000Z",
    };
    const result = computeTimestampUpdates("completed", "in_progress", {
      startedAt: "2025-01-15T10:00:00.000Z",
      completedAt: "2025-01-15T11:00:00.000Z",
      endedAt: "2025-01-15T11:00:00.000Z",
      activeIntervals: [priorInterval],
    });
    expect(result).toEqual({
      completedAt: undefined,
      endedAt: undefined,
      activeIntervals: [priorInterval, { start: now }],
    });
  });

  it("preserves startedAt across re-opens", () => {
    const now = "2025-01-15T14:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("completed", "in_progress", {
      startedAt: "2025-01-15T10:00:00.000Z",
    });
    expect(result.startedAt).toBeUndefined();
  });

  it("does not overwrite startedAt when already set and transitioning in", () => {
    const now = "2025-01-15T14:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("blocked", "in_progress", {
      startedAt: "2025-01-10T08:00:00.000Z",
    });
    // startedAt preserved; only the new open interval is pushed.
    expect(result).toEqual({
      endedAt: undefined,
      activeIntervals: [{ start: now }],
    });
  });

  it("clears completedAt and endedAt when forced back to pending", () => {
    const result = computeTimestampUpdates("completed", "pending");
    expect(result).toEqual({
      completedAt: undefined,
      endedAt: undefined,
    });
  });

  it("closes the open interval when in_progress → blocked (without touching endedAt)", () => {
    const now = "2025-01-15T11:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("in_progress", "blocked", {
      activeIntervals: [{ start: "2025-01-15T10:00:00.000Z" }],
    });
    // endedAt only flips on completed entry/exit; pausing to blocked is
    // reflected purely in the interval end.
    expect(result).toEqual({
      activeIntervals: [
        { start: "2025-01-15T10:00:00.000Z", end: now },
      ],
    });
  });

  it("is a no-op for same-status transitions", () => {
    expect(computeTimestampUpdates("pending", "pending")).toEqual({});
    expect(computeTimestampUpdates("in_progress", "in_progress")).toEqual({});
  });

  it("returns empty object for transitions that do not affect timing (pending → deferred)", () => {
    const result = computeTimestampUpdates("pending", "deferred");
    expect(result).toEqual({});
  });

  it("opens an interval when resuming from blocked", () => {
    const now = "2025-01-15T14:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("blocked", "in_progress");
    expect(result).toEqual({
      startedAt: now,
      endedAt: undefined,
      activeIntervals: [{ start: now }],
    });
  });

  it("opens an interval when resuming from deferred", () => {
    const now = "2025-01-15T14:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    const result = computeTimestampUpdates("deferred", "in_progress");
    expect(result).toEqual({
      startedAt: now,
      endedAt: undefined,
      activeIntervals: [{ start: now }],
    });
  });

  it("does not duplicate an open interval if one is already open (defensive)", () => {
    const now = "2025-01-15T14:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);

    // Inconsistent state: entering in_progress when an interval is already
    // open. The helper should not fabricate a second open entry.
    const result = computeTimestampUpdates("blocked", "in_progress", {
      startedAt: "2025-01-15T08:00:00.000Z",
      activeIntervals: [{ start: "2025-01-15T08:00:00.000Z" }],
    });
    expect(result).toEqual({
      endedAt: undefined,
    });
  });

  it("does not emit an interval update when leaving in_progress with no open interval", () => {
    // Legacy item: status=in_progress, no intervals recorded.
    const result = computeTimestampUpdates("in_progress", "blocked", {
      startedAt: "2025-01-15T08:00:00.000Z",
    });
    expect(result).toEqual({});
  });
});
