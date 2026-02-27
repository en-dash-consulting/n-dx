/**
 * WebSocket Health Panel — displays real-time WebSocket connection health,
 * cleanup metrics, and resource usage in the Hench dashboard section.
 *
 * Data comes from GET /api/ws/health (initial + polling fallback)
 * and WebSocket "ws:health-status" events (real-time updates).
 *
 * Shows:
 * - Active vs peak connection counts with a visual indicator
 * - Cleanup success rate and breakdown by reason
 * - Broadcast statistics and write failure rate
 * - Connection duration and health level
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";

// ── Types ────────────────────────────────────────────────────────────

/** WebSocket health level — matches server-side WsHealthLevel. */
type WsHealthLevel = "healthy" | "degraded" | "unhealthy";

/** Cleanup reason — matches server-side CleanupReason. */
type CleanupReason =
  | "close"
  | "error"
  | "end"
  | "ping_timeout"
  | "prune"
  | "shutdown"
  | "write_fail";

/** Shape of the /api/ws/health response. */
interface WsHealthStatus {
  activeConnections: number;
  peakConnections: number;
  totalConnectionsAccepted: number;
  totalConnectionsRemoved: number;
  cleanupsByReason: Record<CleanupReason, number>;
  recentCleanups: number;
  avgConnectionDurationMs: number;
  totalBroadcasts: number;
  totalBroadcastWriteFailures: number;
  cleanupSuccessRate: number;
  avgCleanupLatencyMs: number;
  health: WsHealthLevel;
  uptimeMs: number;
  timestamp: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

const HEALTH_CONFIG: Record<WsHealthLevel, {
  color: string;
  barColor: string;
  label: string;
  icon: string;
}> = {
  healthy: {
    color: "var(--green)",
    barColor: "var(--green)",
    label: "Healthy",
    icon: "●",
  },
  degraded: {
    color: "var(--orange)",
    barColor: "var(--orange)",
    label: "Degraded",
    icon: "◕",
  },
  unhealthy: {
    color: "var(--red)",
    barColor: "var(--red)",
    label: "Unhealthy",
    icon: "●",
  },
};

/** Format milliseconds into a human-readable duration. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = Math.round(secs % 60);
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

/** Format uptime into a human-readable string. */
function formatUptime(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours}h ${remMins}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
}

/** Cleanup reason display labels. */
const REASON_LABELS: Record<CleanupReason, string> = {
  close: "Clean close",
  error: "Socket error",
  end: "Half-close",
  ping_timeout: "Ping timeout",
  prune: "Pre-broadcast prune",
  shutdown: "Server shutdown",
  write_fail: "Write failure",
};

/** Whether this reason is "event-driven" (expected) vs "safety-net" (indicates issues). */
const EVENT_DRIVEN_REASONS: Set<CleanupReason> = new Set(["close", "error", "end", "shutdown"]);

/** Defaults when no data has been fetched yet. */
const EMPTY_STATUS: WsHealthStatus = {
  activeConnections: 0,
  peakConnections: 0,
  totalConnectionsAccepted: 0,
  totalConnectionsRemoved: 0,
  cleanupsByReason: {
    close: 0,
    error: 0,
    end: 0,
    ping_timeout: 0,
    prune: 0,
    shutdown: 0,
    write_fail: 0,
  },
  recentCleanups: 0,
  avgConnectionDurationMs: 0,
  totalBroadcasts: 0,
  totalBroadcastWriteFailures: 0,
  cleanupSuccessRate: 1,
  avgCleanupLatencyMs: 0,
  health: "healthy",
  uptimeMs: 0,
  timestamp: "",
};

// ── Component ────────────────────────────────────────────────────────

export function WsHealthPanel() {
  const [status, setStatus] = useState<WsHealthStatus>(EMPTY_STATUS);
  const [loaded, setLoaded] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch from REST endpoint
  const fetchWsHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/ws/health");
      if (res.ok) {
        const data = await res.json() as WsHealthStatus;
        setStatus(data);
        setLoaded(true);
      }
    } catch {
      // Silently fail — will retry on next poll
    }
  }, []);

  // WebSocket + polling
  useEffect(() => {
    let mounted = true;
    fetchWsHealth();

    // Connect to WebSocket for real-time updates
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}`;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (!mounted) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "ws:health-status") {
            setStatus({
              activeConnections: msg.activeConnections,
              peakConnections: msg.peakConnections,
              totalConnectionsAccepted: msg.totalConnectionsAccepted,
              totalConnectionsRemoved: msg.totalConnectionsRemoved,
              cleanupsByReason: msg.cleanupsByReason,
              recentCleanups: msg.recentCleanups,
              avgConnectionDurationMs: msg.avgConnectionDurationMs,
              totalBroadcasts: msg.totalBroadcasts,
              totalBroadcastWriteFailures: msg.totalBroadcastWriteFailures,
              cleanupSuccessRate: msg.cleanupSuccessRate,
              avgCleanupLatencyMs: msg.avgCleanupLatencyMs,
              health: msg.health,
              uptimeMs: msg.uptimeMs,
              timestamp: msg.timestamp,
            });
            setLoaded(true);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => { wsRef.current = null; };
    } catch {
      // WebSocket not available
    }

    // Poll as fallback every 15 seconds
    const interval = setInterval(fetchWsHealth, 15_000);

    return () => {
      mounted = false;
      clearInterval(interval);
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
      wsRef.current = null;
    };
  }, [fetchWsHealth]);

  // Don't render until we have data
  if (!loaded) return null;

  const {
    activeConnections,
    peakConnections,
    totalConnectionsAccepted,
    totalConnectionsRemoved,
    cleanupsByReason,
    recentCleanups,
    avgConnectionDurationMs,
    totalBroadcasts,
    totalBroadcastWriteFailures,
    cleanupSuccessRate,
    health,
    uptimeMs,
  } = status;

  const config = HEALTH_CONFIG[health];
  const successPct = Math.round(cleanupSuccessRate * 100);

  // Compute cleanup breakdown for display — only show reasons with non-zero counts
  const cleanupEntries = (Object.entries(cleanupsByReason) as [CleanupReason, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  // Broadcast failure rate
  const broadcastFailRate = totalBroadcasts > 0
    ? (totalBroadcastWriteFailures / totalBroadcasts * 100).toFixed(1)
    : "0.0";

  return h("div", {
    class: `ws-health-panel ws-health-panel-${health}`,
    role: "region",
    "aria-label": "WebSocket connection health",
  },
    // Header row
    h("div", { class: "ws-health-header" },
      h("div", { class: "ws-health-header-left" },
        h("span", {
          class: `ws-health-icon ws-health-icon-${health}`,
          "aria-hidden": "true",
        }, config.icon),
        h("h3", { class: "ws-health-title" }, "WebSocket Health"),
        h("span", {
          class: `ws-health-badge ws-health-badge-${health}`,
        }, config.label),
      ),
      h("div", { class: "ws-health-header-right" },
        h("span", {
          class: "ws-health-connection-count",
          style: `color: ${config.color}`,
        },
          h("span", { class: "ws-health-count-value" }, String(activeConnections)),
          h("span", { class: "ws-health-count-label" }, " active"),
        ),
      ),
    ),

    // Connection bar — active vs peak
    peakConnections > 0
      ? h("div", { class: "ws-health-bar-container" },
          h("div", { class: "ws-health-bar-label" },
            h("span", null, "Connections"),
            h("span", { class: "ws-health-bar-detail" },
              `${activeConnections} active / ${peakConnections} peak`,
            ),
          ),
          h("div", { class: "ws-health-bar-track" },
            h("div", {
              class: `ws-health-bar-fill ws-health-bar-${health}`,
              style: `width: ${Math.min(100, Math.round((activeConnections / Math.max(1, peakConnections)) * 100))}%`,
              role: "progressbar",
              "aria-valuenow": activeConnections,
              "aria-valuemin": 0,
              "aria-valuemax": peakConnections,
              "aria-label": `${activeConnections} of ${peakConnections} peak connections`,
            }),
          ),
        )
      : null,

    // Cleanup success rate bar
    totalConnectionsRemoved > 0
      ? h("div", { class: "ws-health-bar-container" },
          h("div", { class: "ws-health-bar-label" },
            h("span", null, "Cleanup Success"),
            h("span", { class: "ws-health-bar-detail" }, `${successPct}%`),
          ),
          h("div", { class: "ws-health-bar-track" },
            h("div", {
              class: `ws-health-bar-fill ws-health-bar-${successPct >= 90 ? "healthy" : successPct >= 70 ? "degraded" : "unhealthy"}`,
              style: `width: ${successPct}%`,
              role: "progressbar",
              "aria-valuenow": successPct,
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-label": `Cleanup success rate: ${successPct}%`,
            }),
          ),
        )
      : null,

    // Cleanup breakdown (only show when there are cleanups)
    cleanupEntries.length > 0
      ? h("div", { class: "ws-health-cleanup-breakdown" },
          h("div", { class: "ws-health-cleanup-header" },
            h("span", { class: "ws-health-cleanup-title" }, "Cleanup Reasons"),
            h("span", { class: "ws-health-cleanup-recent" },
              `${recentCleanups} in last 60s`,
            ),
          ),
          ...cleanupEntries.map(([reason, count]) =>
            h("div", {
              key: reason,
              class: `ws-health-cleanup-row${EVENT_DRIVEN_REASONS.has(reason) ? "" : " ws-health-cleanup-row-warn"}`,
            },
              h("span", { class: "ws-health-cleanup-reason" },
                REASON_LABELS[reason],
              ),
              h("span", { class: "ws-health-cleanup-count" }, String(count)),
            ),
          ),
        )
      : null,

    // Stats row
    h("div", { class: "ws-health-stats" },
      h("div", { class: "ws-health-stat" },
        h("span", { class: "ws-health-stat-value" },
          String(totalConnectionsAccepted),
        ),
        h("span", { class: "ws-health-stat-label" }, "total accepted"),
      ),
      h("div", { class: "ws-health-stat" },
        h("span", { class: "ws-health-stat-value" },
          String(totalBroadcasts),
        ),
        h("span", { class: "ws-health-stat-label" }, "broadcasts"),
      ),
      h("div", { class: "ws-health-stat" },
        h("span", { class: "ws-health-stat-value" },
          avgConnectionDurationMs > 0 ? formatDuration(avgConnectionDurationMs) : "—",
        ),
        h("span", { class: "ws-health-stat-label" }, "avg duration"),
      ),
      h("div", { class: "ws-health-stat" },
        h("span", { class: "ws-health-stat-value" }, formatUptime(uptimeMs)),
        h("span", { class: "ws-health-stat-label" }, "uptime"),
      ),
    ),

    // Broadcast failure indicator (only show if there are failures)
    totalBroadcastWriteFailures > 0
      ? h("div", { class: "ws-health-failure-alert" },
          h("span", { class: "ws-health-failure-icon", "aria-hidden": "true" }, "△"),
          h("span", { class: "ws-health-failure-text" },
            `${totalBroadcastWriteFailures} broadcast write failure${totalBroadcastWriteFailures === 1 ? "" : "s"} (${broadcastFailRate}% of broadcasts)`,
          ),
        )
      : null,
  );
}
