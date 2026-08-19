/**
 * Adaptive Optimization view — monitors project evolution and manages
 * automatic workflow-parameter adjustments.
 *
 * Consumes the /api/hench/adaptive/* route group:
 *   GET    analysis        — metrics + recommended adjustments
 *   GET    settings        — adaptive settings + manual overrides
 *   POST   settings        — enable/disable, window size, min runs
 *   POST   apply           — apply an adjustment
 *   POST   dismiss/:id     — dismiss a recommendation
 *   POST   lock/:key       — protect a config key from auto-adjustment
 *   POST   unlock/:key     — re-enable auto-adjustment for a key
 *   POST   override        — set a manual override
 *   DELETE override/:key   — remove a manual override
 *   GET    history         — adjustment history + stats
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";

// ── Types (wire shapes from routes-adaptive.ts) ──────────────────────

interface ProjectMetrics {
  totalRuns: number;
  recentSuccessRate: number;
  recentAvgTurns: number;
  recentAvgTokens: number;
  recentAvgDurationMs: number;
  runsPerDay: number;
  successRateTrend: number;
  tokenUsageTrend: number;
}

interface WorkflowAdjustment {
  id: string;
  category: string;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  rationale: string;
  autoApplicable: boolean;
  currentValue: unknown;
  proposedValue: unknown;
  configKey: string;
}

interface AdaptiveSettings {
  enabled: boolean;
  windowSize: number;
  minRunsRequired: number;
  lockedKeys: string[];
}

interface AnalysisResponse {
  metrics: ProjectMetrics;
  adjustments: WorkflowAdjustment[];
  settings: AdaptiveSettings;
}

interface AdjustmentRecord {
  adjustmentId: string;
  title: string;
  category: string;
  configKey: string;
  decision: "applied" | "dismissed" | "overridden";
  previousValue?: unknown;
  newValue?: unknown;
  automatic: boolean;
  timestamp: string;
}

interface HistoryResponse {
  records: AdjustmentRecord[];
  stats: { total: number; applied: number; dismissed: number; overridden: number; automatic: number; manual: number };
}

interface SettingsResponse {
  settings: AdaptiveSettings;
  overrides: Record<string, unknown>;
}

// ── Small helpers ────────────────────────────────────────────────────

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function trendLabel(v: number): string {
  if (v > 0.01) return `↑ ${pct(Math.abs(v))}`;
  if (v < -0.01) return `↓ ${pct(Math.abs(v))}`;
  return "—";
}

async function postJson(url: string, body?: unknown, method = "POST"): Promise<Response> {
  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// ── View ─────────────────────────────────────────────────────────────

export function AdaptiveOptimizationView() {
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [aRes, hRes, sRes] = await Promise.all([
          fetch("/api/hench/adaptive/analysis"),
          fetch("/api/hench/adaptive/history"),
          fetch("/api/hench/adaptive/settings"),
        ]);
        if (!aRes.ok) throw new Error(`HTTP ${aRes.status}`);
        const a = await aRes.json() as AnalysisResponse;
        const hist = hRes.ok ? await hRes.json() as HistoryResponse : null;
        const s = sRes.ok ? await sRes.json() as SettingsResponse : null;
        if (!cancelled) {
          setAnalysis(a);
          setHistory(hist);
          setOverrides(s?.overrides ?? {});
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const runAction = useCallback(async (label: string, fn: () => Promise<Response>) => {
    setActionNote(null);
    try {
      const res = await fn();
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setActionNote(`${label} ✓`);
      reload();
    } catch (err) {
      setActionNote(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [reload]);

  const applyAdjustment = useCallback((adj: WorkflowAdjustment) =>
    runAction(`Applied "${adj.title}"`, () => postJson("/api/hench/adaptive/apply", {
      adjustmentId: adj.id,
      configKey: adj.configKey,
      newValue: adj.proposedValue,
      title: adj.title,
      category: adj.category,
      automatic: false,
    })), [runAction]);

  const dismissAdjustment = useCallback((adj: WorkflowAdjustment) =>
    runAction(`Dismissed "${adj.title}"`, () =>
      postJson(`/api/hench/adaptive/dismiss/${adj.id}`)), [runAction]);

  const lockKey = useCallback((key: string) =>
    runAction(`Locked ${key}`, () =>
      postJson(`/api/hench/adaptive/lock/${encodeURIComponent(key)}`)), [runAction]);

  const unlockKey = useCallback((key: string) =>
    runAction(`Unlocked ${key}`, () =>
      postJson(`/api/hench/adaptive/unlock/${encodeURIComponent(key)}`)), [runAction]);

  const removeOverride = useCallback((key: string) =>
    runAction(`Removed override ${key}`, () =>
      postJson(`/api/hench/adaptive/override/${encodeURIComponent(key)}`, undefined, "DELETE")), [runAction]);

  const updateSettings = useCallback((patch: Partial<AdaptiveSettings>) =>
    runAction("Settings updated", () =>
      postJson("/api/hench/adaptive/settings", patch)), [runAction]);

  const settings = analysis?.settings;

  return h("div", { class: "adaptive-container" },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "hench", title: "Hench", class: "branded-header-hench" }),
      h("h2", { class: "view-title" }, "Adaptive Optimization"),
    ),
    h("p", { class: "section-sub" },
      "Monitors run history and proposes workflow-parameter adjustments as the project evolves.",
    ),

    error
      ? h("div", { class: "cmd-result cmd-result-error", role: "alert" },
          `Could not load adaptive analysis: ${error}`)
      : null,

    actionNote
      ? h("div", { class: "cmd-result", role: "status", "aria-live": "polite" }, actionNote)
      : null,

    !analysis && !error
      ? h("div", { class: "empty-state", role: "status" }, "Loading adaptive analysis…")
      : null,

    // ── Metrics ──
    analysis
      ? h("section", { class: "adaptive-metrics", "aria-label": "Recent run metrics" },
          h("h3", { class: "section-header" }, "Recent Metrics"),
          h("div", { class: "overview-metrics" },
            h("div", { class: "metric-card" },
              h("div", { class: "metric-value" }, pct(analysis.metrics.recentSuccessRate)),
              h("div", { class: "metric-label" }, `Success rate ${trendLabel(analysis.metrics.successRateTrend)}`),
            ),
            h("div", { class: "metric-card" },
              h("div", { class: "metric-value" }, String(analysis.metrics.totalRuns)),
              h("div", { class: "metric-label" }, "Total runs"),
            ),
            h("div", { class: "metric-card" },
              h("div", { class: "metric-value" }, analysis.metrics.recentAvgTurns.toFixed(1)),
              h("div", { class: "metric-label" }, "Avg turns"),
            ),
            h("div", { class: "metric-card" },
              h("div", { class: "metric-value" }, Math.round(analysis.metrics.recentAvgTokens).toLocaleString()),
              h("div", { class: "metric-label" }, `Avg tokens ${trendLabel(analysis.metrics.tokenUsageTrend)}`),
            ),
            h("div", { class: "metric-card" },
              h("div", { class: "metric-value" }, analysis.metrics.runsPerDay.toFixed(1)),
              h("div", { class: "metric-label" }, "Runs / day"),
            ),
          ),
        )
      : null,

    // ── Recommended adjustments ──
    analysis
      ? h("section", { class: "adaptive-adjustments", "aria-label": "Recommended adjustments" },
          h("h3", { class: "section-header" }, `Recommended Adjustments (${analysis.adjustments.length})`),
          analysis.adjustments.length === 0
            ? h("div", { class: "empty-state" },
                "No adjustments recommended — current settings fit recent run behavior.")
            : analysis.adjustments.map((adj) =>
                h("div", { key: adj.id, class: "cmd-panel adaptive-adjustment" },
                  h("div", { class: "cmd-panel-header" },
                    h("h4", { class: "cmd-panel-title" },
                      h("span", { class: `tag adaptive-priority-${adj.priority}` }, adj.priority),
                      h("span", { class: "tag" }, adj.category),
                      ` ${adj.title}`,
                    ),
                    h("p", { class: "cmd-panel-desc" }, adj.description),
                  ),
                  h("p", { class: "adaptive-rationale" }, adj.rationale),
                  h("p", { class: "adaptive-change mono-sm" },
                    h("code", null, adj.configKey), ": ",
                    h("code", null, String(adj.currentValue)), " → ",
                    h("code", null, String(adj.proposedValue)),
                  ),
                  h("div", { class: "cmd-panel-actions" },
                    h("button", { class: "cmd-btn cmd-btn-primary", onClick: () => applyAdjustment(adj) }, "Apply"),
                    h("button", { class: "cmd-btn", onClick: () => dismissAdjustment(adj) }, "Dismiss"),
                    h("button", {
                      class: "cmd-btn",
                      title: "Prevent automatic adjustment of this config key",
                      onClick: () => lockKey(adj.configKey),
                    }, "Lock key"),
                  ),
                ),
              ),
        )
      : null,

    // ── Settings ──
    settings
      ? h("section", { class: "adaptive-settings", "aria-label": "Adaptive settings" },
          h("h3", { class: "section-header" }, "Settings"),
          h("label", { class: "cmd-panel-label cmd-panel-label-inline" },
            h("input", {
              type: "checkbox",
              checked: settings.enabled,
              onChange: (e: Event) =>
                updateSettings({ enabled: (e.target as HTMLInputElement).checked }),
            }),
            " Automatically apply safe adjustments",
          ),
          h("p", { class: "cmd-panel-hint" },
            `Analysis window: last ${settings.windowSize} runs · minimum ${settings.minRunsRequired} runs before recommending.`,
          ),

          h("h4", { class: "section-header" }, "Locked keys"),
          settings.lockedKeys.length === 0
            ? h("p", { class: "cmd-panel-hint" }, "No keys locked — all config keys may be auto-adjusted.")
            : h("ul", { class: "adaptive-key-list" },
                settings.lockedKeys.map((key) =>
                  h("li", { key, class: "adaptive-key-item" },
                    h("code", null, key),
                    h("button", { class: "cmd-btn cmd-btn-small", onClick: () => unlockKey(key) }, "Unlock"),
                  ),
                ),
              ),

          h("h4", { class: "section-header" }, "Manual overrides"),
          Object.keys(overrides).length === 0
            ? h("p", { class: "cmd-panel-hint" }, "No manual overrides set.")
            : h("ul", { class: "adaptive-key-list" },
                Object.entries(overrides).map(([key, value]) =>
                  h("li", { key, class: "adaptive-key-item" },
                    h("code", null, `${key} = ${String(value)}`),
                    h("button", { class: "cmd-btn cmd-btn-small", onClick: () => removeOverride(key) }, "Remove"),
                  ),
                ),
              ),
        )
      : null,

    // ── History ──
    history
      ? h("section", { class: "adaptive-history", "aria-label": "Adjustment history" },
          h("h3", { class: "section-header" }, `History (${history.stats.total})`),
          history.stats.total > 0
            ? h(Fragment, null,
                h("p", { class: "cmd-panel-hint" },
                  `${history.stats.applied} applied · ${history.stats.dismissed} dismissed · ` +
                  `${history.stats.overridden} overridden · ${history.stats.automatic} automatic`,
                ),
                h("table", { class: "data-table" },
                  h("thead", null,
                    h("tr", null,
                      h("th", null, "When"),
                      h("th", null, "Adjustment"),
                      h("th", null, "Key"),
                      h("th", null, "Change"),
                      h("th", null, "Decision"),
                    ),
                  ),
                  h("tbody", null,
                    history.records.slice().reverse().slice(0, 50).map((rec, i) =>
                      h("tr", { key: `${rec.adjustmentId}-${i}` },
                        h("td", null, new Date(rec.timestamp).toLocaleString()),
                        h("td", null, rec.title),
                        h("td", { class: "mono-sm" }, rec.configKey),
                        h("td", { class: "mono-sm" },
                          rec.previousValue !== undefined
                            ? `${String(rec.previousValue)} → ${String(rec.newValue)}`
                            : String(rec.newValue ?? "")),
                        h("td", null,
                          h("span", { class: `tag adaptive-decision-${rec.decision}` },
                            rec.decision + (rec.automatic ? " (auto)" : "")),
                        ),
                      ),
                    ),
                  ),
                ),
              )
            : h("p", { class: "cmd-panel-hint" }, "No adjustments recorded yet."),
        )
      : null,
  );
}
