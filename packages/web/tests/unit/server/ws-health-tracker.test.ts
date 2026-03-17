import { describe, it, expect, beforeEach } from "vitest";
import { WsHealthTracker } from "../../../src/server/websocket.js";

describe("WsHealthTracker", () => {
  let tracker: WsHealthTracker;

  beforeEach(() => {
    tracker = new WsHealthTracker();
  });

  // ── Connection tracking ─────────────────────────────────────────────

  it("tracks active connections on connect/disconnect", () => {
    const id1 = tracker.recordConnect();
    const id2 = tracker.recordConnect();

    const snap1 = tracker.getSnapshot();
    expect(snap1.activeConnections).toBe(2);
    expect(snap1.totalConnectionsAccepted).toBe(2);
    expect(snap1.peakConnections).toBe(2);

    tracker.recordDisconnect(id1, "close");

    const snap2 = tracker.getSnapshot();
    expect(snap2.activeConnections).toBe(1);
    expect(snap2.totalConnectionsRemoved).toBe(1);
    expect(snap2.peakConnections).toBe(2); // peak unchanged
  });

  it("records peak connections correctly", () => {
    const id1 = tracker.recordConnect();
    const id2 = tracker.recordConnect();
    const id3 = tracker.recordConnect();
    // Peak should be 3
    tracker.recordDisconnect(id2, "close");
    tracker.recordDisconnect(id3, "error");
    // Now 1 active, peak still 3
    const snap = tracker.getSnapshot();
    expect(snap.activeConnections).toBe(1);
    expect(snap.peakConnections).toBe(3);
  });

  it("does not go below zero on extra disconnects", () => {
    const id = tracker.recordConnect();
    tracker.recordDisconnect(id, "close");
    // Second disconnect with same ID should be ignored
    tracker.recordDisconnect(id, "close");

    const snap = tracker.getSnapshot();
    expect(snap.activeConnections).toBe(0);
    expect(snap.totalConnectionsRemoved).toBe(1);
  });

  // ── Cleanup tracking ───────────────────────────────────────────────

  it("tracks cleanups by reason", () => {
    const ids = Array.from({ length: 6 }, () => tracker.recordConnect());
    tracker.recordDisconnect(ids[0], "close");
    tracker.recordDisconnect(ids[1], "error");
    tracker.recordDisconnect(ids[2], "end");
    tracker.recordDisconnect(ids[3], "ping_timeout");
    tracker.recordDisconnect(ids[4], "prune");
    tracker.recordDisconnect(ids[5], "write_fail");

    const snap = tracker.getSnapshot();
    expect(snap.cleanupsByReason.close).toBe(1);
    expect(snap.cleanupsByReason.error).toBe(1);
    expect(snap.cleanupsByReason.end).toBe(1);
    expect(snap.cleanupsByReason.ping_timeout).toBe(1);
    expect(snap.cleanupsByReason.prune).toBe(1);
    expect(snap.cleanupsByReason.write_fail).toBe(1);
  });

  it("counts recent cleanups within the 60s window", () => {
    const id = tracker.recordConnect();
    tracker.recordDisconnect(id, "close");

    const snap = tracker.getSnapshot();
    expect(snap.recentCleanups).toBe(1);
  });

  // ── Cleanup success rate ───────────────────────────────────────────

  it("reports 100% success rate when all cleanups are event-driven", () => {
    const ids = Array.from({ length: 3 }, () => tracker.recordConnect());
    tracker.recordDisconnect(ids[0], "close");
    tracker.recordDisconnect(ids[1], "error");
    tracker.recordDisconnect(ids[2], "end");

    const snap = tracker.getSnapshot();
    expect(snap.cleanupSuccessRate).toBe(1);
  });

  it("reports reduced success rate with safety-net cleanups", () => {
    const ids = Array.from({ length: 4 }, () => tracker.recordConnect());
    tracker.recordDisconnect(ids[0], "close");
    tracker.recordDisconnect(ids[1], "close");
    tracker.recordDisconnect(ids[2], "ping_timeout"); // safety-net
    tracker.recordDisconnect(ids[3], "prune"); // safety-net

    const snap = tracker.getSnapshot();
    // 2 event-driven / 4 total = 0.5
    expect(snap.cleanupSuccessRate).toBe(0.5);
  });

  it("reports 1.0 success rate when no cleanups have occurred", () => {
    const snap = tracker.getSnapshot();
    expect(snap.cleanupSuccessRate).toBe(1);
  });

  // ── Broadcast tracking ─────────────────────────────────────────────

  it("tracks broadcast count and write failures", () => {
    tracker.recordBroadcast();
    tracker.recordBroadcast();
    tracker.recordBroadcast();
    tracker.recordBroadcastWriteFailure();

    const snap = tracker.getSnapshot();
    expect(snap.totalBroadcasts).toBe(3);
    expect(snap.totalBroadcastWriteFailures).toBe(1);
  });

  // ── Health level computation ───────────────────────────────────────

  it("reports healthy when all cleanups are event-driven", () => {
    const ids = Array.from({ length: 3 }, () => tracker.recordConnect());
    ids.forEach((id) => tracker.recordDisconnect(id, "close"));

    expect(tracker.getSnapshot().health).toBe("healthy");
  });

  it("reports degraded when cleanup success rate drops below 90%", () => {
    // 8 event-driven + 2 safety-net = 80% success rate
    const ids = Array.from({ length: 10 }, () => tracker.recordConnect());
    for (let i = 0; i < 8; i++) tracker.recordDisconnect(ids[i], "close");
    tracker.recordDisconnect(ids[8], "ping_timeout");
    tracker.recordDisconnect(ids[9], "prune");

    expect(tracker.getSnapshot().health).toBe("degraded");
  });

  it("reports unhealthy when cleanup success rate drops below 70%", () => {
    // 2 event-driven + 8 safety-net = 20% success rate
    const ids = Array.from({ length: 10 }, () => tracker.recordConnect());
    for (let i = 0; i < 2; i++) tracker.recordDisconnect(ids[i], "close");
    for (let i = 2; i < 10; i++) tracker.recordDisconnect(ids[i], "ping_timeout");

    expect(tracker.getSnapshot().health).toBe("unhealthy");
  });

  // ── Sync active count ──────────────────────────────────────────────

  it("syncs active count with actual client set", () => {
    tracker.recordConnect();
    tracker.recordConnect();
    expect(tracker.getSnapshot().activeConnections).toBe(2);

    // Simulate drift: actual set has 1 client
    tracker.syncActiveCount(1);
    expect(tracker.getSnapshot().activeConnections).toBe(1);
  });

  it("updates peak on sync if actual count exceeds peak", () => {
    tracker.syncActiveCount(10);
    expect(tracker.getSnapshot().peakConnections).toBe(10);
  });

  // ── Snapshot structure ─────────────────────────────────────────────

  it("returns a well-formed snapshot", () => {
    const id = tracker.recordConnect();
    tracker.recordBroadcast();
    tracker.recordDisconnect(id, "close");

    const snap = tracker.getSnapshot();
    expect(snap.timestamp).toBeTruthy();
    expect(snap.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof snap.activeConnections).toBe("number");
    expect(typeof snap.peakConnections).toBe("number");
    expect(typeof snap.totalConnectionsAccepted).toBe("number");
    expect(typeof snap.totalConnectionsRemoved).toBe("number");
    expect(typeof snap.cleanupsByReason).toBe("object");
    expect(typeof snap.recentCleanups).toBe("number");
    expect(typeof snap.avgConnectionDurationMs).toBe("number");
    expect(typeof snap.totalBroadcasts).toBe("number");
    expect(typeof snap.totalBroadcastWriteFailures).toBe("number");
    expect(typeof snap.cleanupSuccessRate).toBe("number");
    expect(typeof snap.avgCleanupLatencyMs).toBe("number");
    expect(["healthy", "degraded", "unhealthy"]).toContain(snap.health);
  });

  // ── Reset ──────────────────────────────────────────────────────────

  it("resets all counters", () => {
    const id = tracker.recordConnect();
    tracker.recordBroadcast();
    tracker.recordBroadcastWriteFailure();
    tracker.recordDisconnect(id, "close");

    tracker.reset();

    const snap = tracker.getSnapshot();
    expect(snap.activeConnections).toBe(0);
    expect(snap.peakConnections).toBe(0);
    expect(snap.totalConnectionsAccepted).toBe(0);
    expect(snap.totalConnectionsRemoved).toBe(0);
    expect(snap.totalBroadcasts).toBe(0);
    expect(snap.totalBroadcastWriteFailures).toBe(0);
    expect(snap.recentCleanups).toBe(0);
  });

  // ── Average connection duration ────────────────────────────────────

  it("computes average connection duration for recent cleanups", async () => {
    const id1 = tracker.recordConnect();
    // Small delay so duration > 0
    await new Promise((r) => setTimeout(r, 10));
    tracker.recordDisconnect(id1, "close");

    const snap = tracker.getSnapshot();
    expect(snap.avgConnectionDurationMs).toBeGreaterThan(0);
  });
});
