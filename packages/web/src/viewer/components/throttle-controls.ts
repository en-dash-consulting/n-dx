/**
 * Throttle Controls — manual execution throttling, pause/resume, and
 * emergency stop for hench processes.
 *
 * Provides:
 * - Concurrency limit slider to adjust max concurrent processes at runtime
 * - Pause/resume toggle for new task executions
 * - Emergency stop button (with confirmation) to kill all running processes
 * - Real-time state via WebSocket `hench:throttle-state` events
 *
 * Data comes from GET /api/hench/throttle (initial + polling fallback)
 * and WebSocket events for live updates.
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";

// ── Types ────────────────────────────────────────────────────────────

/** Shape of the /api/hench/throttle response. */
interface ThrottleStatus {
  paused: boolean;
  pausedAt: string | null;
  concurrencyOverride: number | null;
  effectiveMaxConcurrent: number;
  configMaxConcurrent: number;
  lastEmergencyStopAt: string | null;
  lastEmergencyStopCount: number;
  activeExecutions: number;
  timestamp: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

const EMPTY_STATUS: ThrottleStatus = {
  paused: false,
  pausedAt: null,
  concurrencyOverride: null,
  effectiveMaxConcurrent: 3,
  configMaxConcurrent: 3,
  lastEmergencyStopAt: null,
  lastEmergencyStopCount: 0,
  activeExecutions: 0,
  timestamp: "",
};

/** Format a relative time string like "2m ago". */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ── Component ────────────────────────────────────────────────────────

export function ThrottleControlsPanel() {
  const [status, setStatus] = useState<ThrottleStatus>(EMPTY_STATUS);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [sliderValue, setSliderValue] = useState<number>(3);
  const wsRef = useRef<WebSocket | null>(null);

  // ── Fetch throttle status ──────────────────────────────────────────

  const fetchThrottle = useCallback(async () => {
    try {
      const res = await fetch("/api/hench/throttle");
      if (res.ok) {
        const data = await res.json() as ThrottleStatus;
        setStatus(data);
        setSliderValue(data.effectiveMaxConcurrent);
        setLoaded(true);
      }
    } catch {
      // Silently fail — will retry on next poll
    }
  }, []);

  // ── WebSocket + polling ────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;
    fetchThrottle();

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
          if (msg.type === "hench:throttle-state") {
            setStatus({
              paused: msg.paused,
              pausedAt: msg.pausedAt,
              concurrencyOverride: msg.concurrencyOverride,
              effectiveMaxConcurrent: msg.effectiveMaxConcurrent,
              configMaxConcurrent: msg.configMaxConcurrent,
              lastEmergencyStopAt: msg.lastEmergencyStopAt,
              lastEmergencyStopCount: msg.lastEmergencyStopCount,
              activeExecutions: msg.activeExecutions,
              timestamp: msg.timestamp,
            });
            setSliderValue(msg.effectiveMaxConcurrent);
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

    // Poll as fallback every 10 seconds
    const interval = setInterval(fetchThrottle, 10_000);

    return () => {
      mounted = false;
      clearInterval(interval);
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
      wsRef.current = null;
    };
  }, [fetchThrottle]);

  // ── Handlers ───────────────────────────────────────────────────────

  const handleConcurrencyChange = useCallback(async (value: number) => {
    setLoading("concurrency");
    setError(null);
    try {
      const isReset = value === status.configMaxConcurrent;
      const res = await fetch("/api/hench/throttle", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxConcurrent: isReset ? null : value }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update concurrency limit");
      } else {
        await fetchThrottle();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(null);
    }
  }, [status.configMaxConcurrent, fetchThrottle]);

  const handlePause = useCallback(async () => {
    setLoading("pause");
    setError(null);
    try {
      const res = await fetch("/api/hench/throttle/pause", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to pause");
      } else {
        await fetchThrottle();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(null);
    }
  }, [fetchThrottle]);

  const handleResume = useCallback(async () => {
    setLoading("resume");
    setError(null);
    try {
      const res = await fetch("/api/hench/throttle/resume", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to resume");
      } else {
        await fetchThrottle();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(null);
    }
  }, [fetchThrottle]);

  const handleEmergencyStop = useCallback(async () => {
    setLoading("stop");
    setError(null);
    try {
      const res = await fetch("/api/hench/throttle/emergency-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Emergency stop failed");
      } else {
        await fetchThrottle();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(null);
      setShowStopConfirm(false);
    }
  }, [fetchThrottle]);

  // ── Render ─────────────────────────────────────────────────────────

  if (!loaded) return null;

  const { paused, pausedAt, concurrencyOverride, effectiveMaxConcurrent, configMaxConcurrent, activeExecutions, lastEmergencyStopAt } = status;
  const hasOverride = concurrencyOverride !== null;

  return h("div", {
    class: `throttle-controls${paused ? " throttle-controls-paused" : ""}`,
    role: "region",
    "aria-label": "Execution throttle controls",
  },

    // Header
    h("div", { class: "throttle-header" },
      h("div", { class: "throttle-header-left" },
        h("span", {
          class: `throttle-icon${paused ? " throttle-icon-paused" : ""}`,
          "aria-hidden": "true",
        }, paused ? "⏸" : "⚙"),
        h("h3", { class: "throttle-title" }, "Throttle Controls"),
        paused
          ? h("span", { class: "throttle-paused-badge" }, "Paused")
          : null,
      ),
      activeExecutions > 0
        ? h("span", { class: "throttle-active-count" },
            `${activeExecutions} active`,
          )
        : null,
    ),

    // Error display
    error
      ? h("div", { class: "throttle-error", role: "alert" }, error)
      : null,

    // Concurrency slider
    h("div", { class: "throttle-section" },
      h("div", { class: "throttle-section-header" },
        h("span", { class: "throttle-section-label" }, "Concurrency Limit"),
        h("span", { class: "throttle-section-value" },
          hasOverride
            ? h("span", null,
                h("span", { class: "throttle-override-value" }, String(effectiveMaxConcurrent)),
                h("span", { class: "throttle-config-hint" }, ` (config: ${configMaxConcurrent})`),
              )
            : String(effectiveMaxConcurrent),
        ),
      ),
      h("div", { class: "throttle-slider-row" },
        h("span", { class: "throttle-slider-min" }, "1"),
        h("input", {
          type: "range",
          class: "throttle-slider",
          min: 1,
          max: 10,
          step: 1,
          value: sliderValue,
          disabled: loading === "concurrency",
          "aria-label": "Adjust maximum concurrent processes",
          onInput: (e: Event) => {
            const val = parseInt((e.target as HTMLInputElement).value, 10);
            setSliderValue(val);
          },
          onChange: (e: Event) => {
            const val = parseInt((e.target as HTMLInputElement).value, 10);
            handleConcurrencyChange(val);
          },
        }),
        h("span", { class: "throttle-slider-max" }, "10"),
      ),
      hasOverride
        ? h("button", {
            class: "throttle-reset-btn",
            onClick: () => handleConcurrencyChange(configMaxConcurrent),
            disabled: loading === "concurrency",
            "aria-label": "Reset to config default",
          }, `Reset to default (${configMaxConcurrent})`)
        : null,
    ),

    // Pause/Resume control
    h("div", { class: "throttle-section" },
      h("div", { class: "throttle-section-header" },
        h("span", { class: "throttle-section-label" }, "New Executions"),
        h("span", {
          class: `throttle-status-indicator${paused ? " throttle-status-paused" : " throttle-status-active"}`,
        }, paused ? "Paused" : "Accepting"),
      ),
      paused
        ? h("div", { class: "throttle-pause-info" },
            h("p", { class: "throttle-pause-desc" },
              "New task executions are blocked. Running tasks continue until they finish.",
            ),
            pausedAt
              ? h("span", { class: "throttle-pause-time" }, `Paused ${timeAgo(pausedAt)}`)
              : null,
            h("button", {
              class: "throttle-resume-btn",
              onClick: handleResume,
              disabled: loading === "resume",
              "aria-label": "Resume new executions",
            }, loading === "resume" ? "Resuming…" : "▶ Resume Executions"),
          )
        : h("button", {
            class: "throttle-pause-btn",
            onClick: handlePause,
            disabled: loading === "pause",
            "aria-label": "Pause new executions",
          }, loading === "pause" ? "Pausing…" : "⏸ Pause New Executions"),
    ),

    // Emergency stop
    h("div", { class: "throttle-section throttle-section-danger" },
      h("div", { class: "throttle-section-header" },
        h("span", { class: "throttle-section-label throttle-danger-label" }, "Emergency Stop"),
      ),
      showStopConfirm
        ? h("div", { class: "throttle-stop-confirm" },
            h("p", { class: "throttle-stop-warn" },
              `This will terminate ${activeExecutions} running execution${activeExecutions !== 1 ? "s" : ""} and pause new ones. Are you sure?`,
            ),
            h("div", { class: "throttle-stop-actions" },
              h("button", {
                class: "throttle-stop-confirm-btn",
                onClick: handleEmergencyStop,
                disabled: loading === "stop",
                "aria-label": "Confirm emergency stop",
              }, loading === "stop" ? "Stopping…" : "⚠ Confirm Stop All"),
              h("button", {
                class: "throttle-stop-cancel-btn",
                onClick: () => setShowStopConfirm(false),
                disabled: loading === "stop",
              }, "Cancel"),
            ),
          )
        : h("button", {
            class: "throttle-stop-btn",
            onClick: () => setShowStopConfirm(true),
            disabled: activeExecutions === 0,
            "aria-label": activeExecutions === 0
              ? "No active executions to stop"
              : "Emergency stop all executions",
          },
            activeExecutions === 0
              ? "No Active Executions"
              : `⛔ Stop All Executions (${activeExecutions})`,
          ),
      lastEmergencyStopAt
        ? h("span", { class: "throttle-stop-last" },
            `Last stop: ${timeAgo(lastEmergencyStopAt)}`,
          )
        : null,
    ),
  );
}
