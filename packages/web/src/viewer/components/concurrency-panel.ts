/**
 * Concurrency Panel — displays real-time concurrent execution count,
 * configured limits, and queue status in the Hench dashboard section.
 *
 * Data comes from GET /api/hench/concurrency (initial + polling fallback)
 * and WebSocket "hench:concurrency-status" events (real-time updates).
 *
 * Shows:
 * - Current/max concurrent process count with a visual bar
 * - Slots available and utilization percentage
 * - Queue length and pending task count
 * - Visual indicators (color-coded) for approaching resource limits
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";

// ── Types ────────────────────────────────────────────────────────────

/** Concurrency utilization level — matches server-side ConcurrencyLevel. */
type ConcurrencyLevel = "low" | "moderate" | "high" | "at_limit";

/** Shape of the /api/hench/concurrency response. */
interface ConcurrencyStatus {
  processCount: number;
  maxConcurrent: number;
  slotsAvailable: number;
  level: ConcurrencyLevel;
  utilization: number;
  totalRunning: number;
  dashboardActive: number;
  diskRunning: number;
  pendingTasks: number;
  timestamp: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

const LEVEL_CONFIG: Record<ConcurrencyLevel, {
  color: string;
  barColor: string;
  label: string;
  icon: string;
}> = {
  low: {
    color: "var(--green)",
    barColor: "var(--green)",
    label: "Available",
    icon: "●",
  },
  moderate: {
    color: "var(--accent)",
    barColor: "var(--accent)",
    label: "Active",
    icon: "◐",
  },
  high: {
    color: "var(--orange)",
    barColor: "var(--orange)",
    label: "Nearing limit",
    icon: "◕",
  },
  at_limit: {
    color: "var(--red)",
    barColor: "var(--red)",
    label: "At limit",
    icon: "●",
  },
};

/** Defaults when no data has been fetched yet. */
const EMPTY_STATUS: ConcurrencyStatus = {
  processCount: 0,
  maxConcurrent: 3,
  slotsAvailable: 3,
  level: "low",
  utilization: 0,
  totalRunning: 0,
  dashboardActive: 0,
  diskRunning: 0,
  pendingTasks: 0,
  timestamp: "",
};

// ── Component ────────────────────────────────────────────────────────

export function ConcurrencyPanel() {
  const [status, setStatus] = useState<ConcurrencyStatus>(EMPTY_STATUS);
  const [loaded, setLoaded] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch from REST endpoint
  const fetchConcurrency = useCallback(async () => {
    try {
      const res = await fetch("/api/hench/concurrency");
      if (res.ok) {
        const data = await res.json() as ConcurrencyStatus;
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
    fetchConcurrency();

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
          if (msg.type === "hench:concurrency-status") {
            setStatus((prev) => ({
              processCount: msg.processCount,
              maxConcurrent: msg.maxConcurrent,
              slotsAvailable: msg.slotsAvailable,
              level: msg.level,
              utilization: msg.utilization,
              totalRunning: msg.totalRunning,
              dashboardActive: msg.dashboardActive,
              diskRunning: msg.diskRunning,
              pendingTasks: prev.pendingTasks, // WS doesn't include pending tasks; preserve from REST
              timestamp: msg.timestamp,
            }));
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
    const interval = setInterval(fetchConcurrency, 15_000);

    return () => {
      mounted = false;
      clearInterval(interval);
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
      wsRef.current = null;
    };
  }, [fetchConcurrency]);

  // Don't render until we have data
  if (!loaded) return null;

  const { processCount, maxConcurrent, slotsAvailable, level, utilization, totalRunning, pendingTasks } = status;
  const config = LEVEL_CONFIG[level];
  const pct = Math.round(utilization * 100);

  return h("div", {
    class: `concurrency-panel concurrency-panel-${level}`,
    role: "region",
    "aria-label": "Concurrent execution status",
  },
    // Header row
    h("div", { class: "concurrency-header" },
      h("div", { class: "concurrency-header-left" },
        h("span", {
          class: `concurrency-icon concurrency-icon-${level}`,
          "aria-hidden": "true",
        }, config.icon),
        h("h3", { class: "concurrency-title" }, "Concurrency"),
        h("span", {
          class: `concurrency-level-badge concurrency-level-${level}`,
        }, config.label),
      ),
      h("div", { class: "concurrency-header-right" },
        h("span", {
          class: "concurrency-ratio",
          style: `color: ${config.color}`,
        },
          h("span", { class: "concurrency-ratio-current" }, String(processCount)),
          h("span", { class: "concurrency-ratio-sep" }, "/"),
          h("span", { class: "concurrency-ratio-max" }, String(maxConcurrent)),
        ),
      ),
    ),

    // Utilization bar
    h("div", { class: "concurrency-bar-container" },
      h("div", {
        class: "concurrency-bar-track",
      },
        h("div", {
          class: `concurrency-bar-fill concurrency-bar-${level}`,
          style: `width: ${pct}%`,
          role: "progressbar",
          "aria-valuenow": processCount,
          "aria-valuemin": 0,
          "aria-valuemax": maxConcurrent,
          "aria-label": `${processCount} of ${maxConcurrent} concurrent processes`,
        }),
        // Segment markers for each slot
        ...Array.from({ length: maxConcurrent - 1 }, (_, i) =>
          h("div", {
            key: i,
            class: "concurrency-bar-segment",
            style: `left: ${((i + 1) / maxConcurrent) * 100}%`,
            "aria-hidden": "true",
          }),
        ),
      ),
      h("span", { class: "concurrency-bar-pct" }, `${pct}%`),
    ),

    // Stats row
    h("div", { class: "concurrency-stats" },
      h("div", { class: "concurrency-stat" },
        h("span", { class: "concurrency-stat-value" }, String(slotsAvailable)),
        h("span", { class: "concurrency-stat-label" },
          `slot${slotsAvailable === 1 ? "" : "s"} available`,
        ),
      ),
      h("div", { class: "concurrency-stat" },
        h("span", { class: "concurrency-stat-value" }, String(totalRunning)),
        h("span", { class: "concurrency-stat-label" },
          `task${totalRunning === 1 ? "" : "s"} running`,
        ),
      ),
      pendingTasks > 0
        ? h("div", { class: "concurrency-stat" },
            h("span", { class: "concurrency-stat-value concurrency-stat-pending" },
              String(pendingTasks),
            ),
            h("span", { class: "concurrency-stat-label" },
              `pending task${pendingTasks === 1 ? "" : "s"}`,
            ),
          )
        : null,
    ),
  );
}
