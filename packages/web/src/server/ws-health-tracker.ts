/**
 * WebSocket connection health tracker — records connection lifecycle events,
 * cleanup metrics, and resource usage for dashboard monitoring.
 *
 * Instruments the WebSocket manager to collect:
 * - Active vs total (historical peak) connection counts
 * - Cleanup events: successful removals, reasons, timing
 * - Broadcast statistics: total broadcasts, failed writes
 * - Connection duration tracking
 *
 * Designed as a singleton that accumulates metrics over the server lifetime.
 * Provides a snapshot API consumed by the REST endpoint and WS broadcast.
 */

/** Reason a client was removed from the connection set. */
export type CleanupReason =
  | "close"     // Socket close event (clean disconnect)
  | "error"     // Socket error event
  | "end"       // Socket end event (half-close)
  | "ping_timeout" // Missed keepalive ping response
  | "prune"     // Pre-broadcast pruning (destroyed/non-writable socket)
  | "shutdown"  // Server shutdown
  | "write_fail"; // Failed write during broadcast

/** A single cleanup event record. */
interface CleanupEvent {
  reason: CleanupReason;
  timestamp: number; // Date.now()
  connectionDurationMs: number; // How long the client was connected
}

/** Health level derived from cleanup failure rate and connection trends. */
export type WsHealthLevel = "healthy" | "degraded" | "unhealthy";

/** Snapshot of WebSocket health metrics for API/broadcast consumption. */
export interface WsHealthSnapshot {
  /** Current number of active connections. */
  activeConnections: number;
  /** Peak concurrent connections seen since server start. */
  peakConnections: number;
  /** Total connections accepted since server start. */
  totalConnectionsAccepted: number;
  /** Total connections removed (for any reason) since server start. */
  totalConnectionsRemoved: number;
  /** Cleanup metrics broken down by reason. */
  cleanupsByReason: Record<CleanupReason, number>;
  /** Number of cleanups in the last 60 seconds. */
  recentCleanups: number;
  /** Average connection duration (ms) for connections closed in the last 5 minutes. */
  avgConnectionDurationMs: number;
  /** Total broadcasts sent since server start. */
  totalBroadcasts: number;
  /** Total failed writes during broadcasts. */
  totalBroadcastWriteFailures: number;
  /** Cleanup success rate (0–1): successful cleanups / total cleanups. */
  cleanupSuccessRate: number;
  /** Average cleanup timing (ms): how quickly dead connections are detected. */
  avgCleanupLatencyMs: number;
  /** Overall health level. */
  health: WsHealthLevel;
  /** Server uptime in milliseconds. */
  uptimeMs: number;
  /** ISO timestamp of this snapshot. */
  timestamp: string;
}

/** Maximum number of recent cleanup events to retain for rolling stats. */
const MAX_CLEANUP_HISTORY = 500;

/** Window (ms) for "recent cleanups" count. */
const RECENT_WINDOW_MS = 60_000;

/** Window (ms) for average connection duration calculation. */
const DURATION_WINDOW_MS = 5 * 60_000;

export class WsHealthTracker {
  private readonly startedAt = Date.now();

  // Connection tracking
  private activeConnectionCount = 0;
  private peakConnectionCount = 0;
  private totalAccepted = 0;
  private totalRemoved = 0;

  // Per-connection timestamps for duration tracking
  private readonly connectionStartTimes = new Map<string, number>();
  private connectionIdCounter = 0;

  // Cleanup history (ring buffer)
  private readonly cleanupHistory: CleanupEvent[] = [];
  private readonly cleanupsByReason: Record<CleanupReason, number> = {
    close: 0,
    error: 0,
    end: 0,
    ping_timeout: 0,
    prune: 0,
    shutdown: 0,
    write_fail: 0,
  };

  // Broadcast tracking
  private totalBroadcasts = 0;
  private totalWriteFailures = 0;

  // Cleanup timing: track ms from connection start to cleanup
  // for "cleanup latency" (how quickly we detect dead connections)
  private cleanupLatencySum = 0;
  private cleanupLatencyCount = 0;

  /**
   * Record a new connection being accepted.
   * Returns a connection ID to pass to `recordDisconnect()`.
   */
  recordConnect(): string {
    const id = String(++this.connectionIdCounter);
    this.connectionStartTimes.set(id, Date.now());
    this.activeConnectionCount++;
    this.totalAccepted++;
    if (this.activeConnectionCount > this.peakConnectionCount) {
      this.peakConnectionCount = this.activeConnectionCount;
    }
    return id;
  }

  /**
   * Record a connection being removed.
   */
  recordDisconnect(connectionId: string, reason: CleanupReason): void {
    const startTime = this.connectionStartTimes.get(connectionId);
    if (!startTime) return; // Already recorded or unknown

    this.connectionStartTimes.delete(connectionId);
    const now = Date.now();
    const durationMs = now - startTime;

    this.activeConnectionCount = Math.max(0, this.activeConnectionCount - 1);
    this.totalRemoved++;
    this.cleanupsByReason[reason]++;

    const event: CleanupEvent = {
      reason,
      timestamp: now,
      connectionDurationMs: durationMs,
    };

    // Ring buffer for cleanup history
    if (this.cleanupHistory.length >= MAX_CLEANUP_HISTORY) {
      this.cleanupHistory.shift();
    }
    this.cleanupHistory.push(event);

    // Accumulate cleanup latency for averaging
    this.cleanupLatencySum += durationMs;
    this.cleanupLatencyCount++;
  }

  /** Record a broadcast attempt. */
  recordBroadcast(): void {
    this.totalBroadcasts++;
  }

  /** Record a failed write during broadcast. */
  recordBroadcastWriteFailure(): void {
    this.totalWriteFailures++;
  }

  /**
   * Sync the active connection count with the actual client set size.
   * Called periodically to correct any drift from missed events.
   */
  syncActiveCount(actualCount: number): void {
    this.activeConnectionCount = actualCount;
    if (actualCount > this.peakConnectionCount) {
      this.peakConnectionCount = actualCount;
    }
  }

  /** Get a snapshot of current health metrics. */
  getSnapshot(): WsHealthSnapshot {
    const now = Date.now();

    // Recent cleanups (last 60s)
    const recentCutoff = now - RECENT_WINDOW_MS;
    const recentCleanups = this.cleanupHistory.filter(
      (e) => e.timestamp >= recentCutoff,
    ).length;

    // Average connection duration for connections closed in last 5 min
    const durationCutoff = now - DURATION_WINDOW_MS;
    const recentDurations = this.cleanupHistory
      .filter((e) => e.timestamp >= durationCutoff)
      .map((e) => e.connectionDurationMs);
    const avgConnectionDurationMs =
      recentDurations.length > 0
        ? Math.round(
            recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length,
          )
        : 0;

    // Cleanup success rate: event-driven cleanups (close/error/end) vs
    // safety-net cleanups (ping_timeout/prune/write_fail)
    const totalCleanups = this.totalRemoved;
    const eventDrivenCleanups =
      this.cleanupsByReason.close +
      this.cleanupsByReason.error +
      this.cleanupsByReason.end +
      this.cleanupsByReason.shutdown;
    const cleanupSuccessRate =
      totalCleanups > 0 ? eventDrivenCleanups / totalCleanups : 1;

    // Average cleanup latency
    const avgCleanupLatencyMs =
      this.cleanupLatencyCount > 0
        ? Math.round(this.cleanupLatencySum / this.cleanupLatencyCount)
        : 0;

    // Health level
    const health = this.computeHealth(cleanupSuccessRate, recentCleanups);

    return {
      activeConnections: this.activeConnectionCount,
      peakConnections: this.peakConnectionCount,
      totalConnectionsAccepted: this.totalAccepted,
      totalConnectionsRemoved: this.totalRemoved,
      cleanupsByReason: { ...this.cleanupsByReason },
      recentCleanups,
      avgConnectionDurationMs,
      totalBroadcasts: this.totalBroadcasts,
      totalBroadcastWriteFailures: this.totalWriteFailures,
      cleanupSuccessRate: Math.round(cleanupSuccessRate * 1000) / 1000,
      avgCleanupLatencyMs,
      health,
      uptimeMs: now - this.startedAt,
      timestamp: new Date().toISOString(),
    };
  }

  /** Reset all counters (for testing). */
  reset(): void {
    this.activeConnectionCount = 0;
    this.peakConnectionCount = 0;
    this.totalAccepted = 0;
    this.totalRemoved = 0;
    this.connectionStartTimes.clear();
    this.connectionIdCounter = 0;
    this.cleanupHistory.length = 0;
    this.cleanupsByReason.close = 0;
    this.cleanupsByReason.error = 0;
    this.cleanupsByReason.end = 0;
    this.cleanupsByReason.ping_timeout = 0;
    this.cleanupsByReason.prune = 0;
    this.cleanupsByReason.shutdown = 0;
    this.cleanupsByReason.write_fail = 0;
    this.totalBroadcasts = 0;
    this.totalWriteFailures = 0;
    this.cleanupLatencySum = 0;
    this.cleanupLatencyCount = 0;
  }

  private computeHealth(
    cleanupSuccessRate: number,
    recentCleanups: number,
  ): WsHealthLevel {
    // Unhealthy: high rate of safety-net cleanups (>30% are prune/timeout/write_fail)
    // or very high cleanup churn (>50 cleanups per minute)
    if (cleanupSuccessRate < 0.7 || recentCleanups > 50) {
      return "unhealthy";
    }
    // Degraded: moderate safety-net usage or moderate churn
    if (cleanupSuccessRate < 0.9 || recentCleanups > 20) {
      return "degraded";
    }
    return "healthy";
  }
}
