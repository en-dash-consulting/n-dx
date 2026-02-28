/**
 * Memory Panel — displays system memory usage, per-process memory consumption,
 * and resource health indicators in the Hench dashboard section.
 *
 * Data comes from GET /api/hench/memory (initial + polling fallback)
 * and WebSocket "hench:memory-status" events (real-time updates).
 *
 * Shows:
 * - System memory usage percentage with a visual bar
 * - Server process (n-dx web) memory consumption
 * - Per-task process memory for active executions
 * - Resource health indicators (healthy/warning/critical)
 * - Memory pressure warnings when usage is high
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";

// ── Types ────────────────────────────────────────────────────────────

/** Resource health level — matches server-side MemoryHealthLevel. */
type MemoryHealthLevel = "healthy" | "warning" | "critical";

/** Per-process memory entry from the API. */
interface ProcessMemoryEntry {
  taskId: string;
  taskTitle: string;
  pid: number;
  rssBytes: number;
  source: "dashboard" | "disk";
}

/** Shape of the /api/hench/memory response. */
interface MemoryStatus {
  system: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  server: {
    pid: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  processes: ProcessMemoryEntry[];
  health: MemoryHealthLevel;
  loadAvg: [number, number, number];
  cpuCount: number;
  timestamp: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

const HEALTH_CONFIG: Record<MemoryHealthLevel, {
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
  warning: {
    color: "var(--orange)",
    barColor: "var(--orange)",
    label: "Pressure",
    icon: "◕",
  },
  critical: {
    color: "var(--red)",
    barColor: "var(--red)",
    label: "Critical",
    icon: "●",
  },
};

/** Format bytes into a human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

/** Defaults when no data has been fetched yet. */
const EMPTY_STATUS: MemoryStatus = {
  system: { totalBytes: 0, freeBytes: 0, usedBytes: 0, usedPercent: 0 },
  server: { pid: 0, rssBytes: 0, heapUsedBytes: 0, heapTotalBytes: 0, externalBytes: 0 },
  processes: [],
  health: "healthy",
  loadAvg: [0, 0, 0],
  cpuCount: 1,
  timestamp: "",
};

// ── Component ────────────────────────────────────────────────────────

export function MemoryPanel() {
  const [status, setStatus] = useState<MemoryStatus>(EMPTY_STATUS);
  const [loaded, setLoaded] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch from REST endpoint
  const fetchMemory = useCallback(async () => {
    try {
      const res = await fetch("/api/hench/memory");
      if (res.ok) {
        const data = await res.json() as MemoryStatus;
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
    fetchMemory();

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
          if (msg.type === "hench:memory-status") {
            setStatus({
              system: msg.system,
              server: msg.server,
              processes: msg.processes,
              health: msg.health,
              loadAvg: msg.loadAvg,
              cpuCount: msg.cpuCount,
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
    const interval = setInterval(fetchMemory, 15_000);

    return () => {
      mounted = false;
      clearInterval(interval);
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
      wsRef.current = null;
    };
  }, [fetchMemory]);

  // Don't render until we have data
  if (!loaded) return null;

  const { system, server, processes, health, loadAvg, cpuCount } = status;
  const config = HEALTH_CONFIG[health];

  return h("div", {
    class: `memory-panel memory-panel-${health}`,
    role: "region",
    "aria-label": "System memory and resource status",
  },
    // Header row
    h("div", { class: "memory-header" },
      h("div", { class: "memory-header-left" },
        h("span", {
          class: `memory-icon memory-icon-${health}`,
          "aria-hidden": "true",
        }, config.icon),
        h("h3", { class: "memory-title" }, "Memory"),
        h("span", {
          class: `memory-health-badge memory-health-${health}`,
        }, config.label),
      ),
      h("div", { class: "memory-header-right" },
        h("span", {
          class: "memory-pct-display",
          style: `color: ${config.color}`,
        },
          h("span", { class: "memory-pct-value" }, `${system.usedPercent}`),
          h("span", { class: "memory-pct-sign" }, "%"),
        ),
      ),
    ),

    // Memory pressure warning (only for warning/critical)
    health !== "healthy"
      ? h("div", { class: `memory-pressure-alert memory-pressure-${health}` },
          h("span", { class: "memory-pressure-icon", "aria-hidden": "true" },
            health === "critical" ? "▲" : "△",
          ),
          h("span", { class: "memory-pressure-text" },
            health === "critical"
              ? "System memory critically low — task performance may degrade"
              : "Memory usage elevated — monitor for potential issues",
          ),
        )
      : null,

    // System memory bar
    h("div", { class: "memory-bar-container" },
      h("div", { class: "memory-bar-label" },
        h("span", null, "System"),
        h("span", { class: "memory-bar-detail" },
          `${formatBytes(system.usedBytes)} / ${formatBytes(system.totalBytes)}`,
        ),
      ),
      h("div", { class: "memory-bar-track" },
        h("div", {
          class: `memory-bar-fill memory-bar-${health}`,
          style: `width: ${system.usedPercent}%`,
          role: "progressbar",
          "aria-valuenow": system.usedPercent,
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-label": `System memory: ${system.usedPercent}% used`,
        }),
      ),
    ),

    // Server process memory
    h("div", { class: "memory-bar-container" },
      h("div", { class: "memory-bar-label" },
        h("span", null, "Server (n-dx)"),
        h("span", { class: "memory-bar-detail" }, formatBytes(server.rssBytes)),
      ),
      h("div", { class: "memory-bar-track" },
        h("div", {
          class: "memory-bar-fill memory-bar-server",
          style: `width: ${system.totalBytes > 0 ? Math.min(100, Math.round((server.rssBytes / system.totalBytes) * 100)) : 0}%`,
          "aria-label": `Server process: ${formatBytes(server.rssBytes)}`,
        }),
      ),
    ),

    // Per-task process memory (only shown when there are active tasks)
    processes.length > 0
      ? h("div", { class: "memory-processes" },
          h("div", { class: "memory-processes-header" },
            h("span", { class: "memory-processes-title" }, "Task Processes"),
            h("span", { class: "memory-processes-count" }, String(processes.length)),
          ),
          ...processes.map((proc) =>
            h("div", { key: proc.taskId, class: "memory-process-row" },
              h("div", { class: "memory-process-info" },
                h("span", { class: "memory-process-name" }, proc.taskTitle),
                h("span", { class: "memory-process-pid" }, `PID ${proc.pid}`),
              ),
              h("span", { class: "memory-process-rss" }, formatBytes(proc.rssBytes)),
            ),
          ),
        )
      : null,

    // Stats row: load average and CPU info
    h("div", { class: "memory-stats" },
      h("div", { class: "memory-stat" },
        h("span", { class: "memory-stat-value" }, formatBytes(system.freeBytes)),
        h("span", { class: "memory-stat-label" }, "free"),
      ),
      h("div", { class: "memory-stat" },
        h("span", { class: "memory-stat-value" }, loadAvg[0].toFixed(2)),
        h("span", { class: "memory-stat-label" }, "load (1m)"),
      ),
      h("div", { class: "memory-stat" },
        h("span", { class: "memory-stat-value" }, String(cpuCount)),
        h("span", { class: "memory-stat-label" },
          `CPU${cpuCount === 1 ? "" : "s"}`,
        ),
      ),
    ),
  );
}
