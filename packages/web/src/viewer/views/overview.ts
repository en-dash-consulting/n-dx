import { h } from "preact";
import { useState, useCallback, useEffect, useMemo } from "preact/hooks";
import type { LoadedData, NavigateTo, DetailItem } from "../types.js";
import {
  BarChart,
  HealthGauge,
  PatternBadge,
  MetricCard,
  getZoneColorByIndex,
} from "../visualization/index.js";
import { basename } from "../utils.js";
import { BrandedHeader } from "../components/index.js";

interface SvAnalyzeStatusData {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  recentOutput: string;
  error: string | null;
}

/**
 * Quick and full analysis triggers for the SourceVision section.
 *
 * Quick re-analyze is a synchronous structural refresh. Full analysis runs
 * all four enrichment passes (unlocking the Architecture, Problems, and
 * Suggestions tabs) as a background job \u2014 202 + status polling \u2014 because the
 * LLM passes can take many minutes. Tab data repopulates automatically via
 * the viewer's data polling once new files land.
 */
export function AnalyzeControls() {
  const [state, setState] = useState<"idle" | "running" | "running-full" | "done" | "done-full" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  // Poll full-analysis status while running
  useEffect(() => {
    if (state !== "running-full") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/commands/sv-analyze/status");
        if (!res.ok) return;
        const data = await res.json() as SvAnalyzeStatusData;
        const lastLine = data.recentOutput.split("\n").filter(Boolean).pop();
        if (lastLine) setProgress(lastLine.slice(0, 120));
        if (!data.running && data.finishedAt) {
          clearInterval(interval);
          if (data.error) {
            setError(data.error);
            setState("error");
            setTimeout(() => setState("idle"), 10000);
          } else {
            setProgress(null);
            setState("done-full");
            setTimeout(() => setState("idle"), 8000);
          }
        }
      } catch {
        // Ignore transient fetch errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [state]);

  const handleQuick = useCallback(async () => {
    setState("running");
    setError(null);
    try {
      const res = await fetch("/api/commands/sv-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "Analysis failed" })) as { error?: string };
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setState("done");
      setTimeout(() => setState("idle"), 4000);
    } catch (err) {
      setError(String(err));
      setState("error");
      setTimeout(() => setState("idle"), 6000);
    }
  }, []);

  const handleFull = useCallback(async () => {
    setState("running-full");
    setError(null);
    setProgress(null);
    try {
      const res = await fetch("/api/commands/sv-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full: true }),
      });
      if (res.status === 409) {
        // Already running \u2014 the polling loop will track it
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "Full analysis failed to start" })) as { error?: string };
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      // 202 accepted \u2014 polling loop handles the rest
    } catch (err) {
      setError(String(err));
      setState("error");
      setTimeout(() => setState("idle"), 10000);
    }
  }, []);

  const busy = state === "running" || state === "running-full";

  return h("div", { class: "overview-reanalyze cmd-panel-actions" },
    h("button", {
      class: "cmd-btn cmd-btn-primary",
      onClick: handleQuick,
      disabled: busy,
      "aria-busy": state === "running",
      title: "Re-run sourcevision analyze to refresh all data",
    },
      state === "running"
        ? h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" })
        : h("span", { "aria-hidden": "true" }, "\u{1F504}"),
      state === "running" ? "Analyzing..." : "Re-analyze",
    ),
    h("button", {
      class: "cmd-btn cmd-btn-secondary",
      onClick: handleFull,
      disabled: busy,
      "aria-busy": state === "running-full",
      title: "Run all four enrichment passes \u2014 unlocks the Architecture, Problems, and Suggestions tabs. Takes several minutes.",
    },
      state === "running-full"
        ? h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" })
        : h("span", { "aria-hidden": "true" }, "\u2728"),
      state === "running-full" ? "Running full analysis..." : "Full analysis",
    ),
    h("span", { role: "status", "aria-live": "polite" },
      state === "running-full" && progress
        ? h("span", { class: "cmd-inline-progress" }, progress)
        : null,
      state === "done"
        ? h("span", { class: "cmd-inline-result cmd-inline-result-ok" }, "\u2713 Done")
        : null,
      state === "done-full"
        ? h("span", { class: "cmd-inline-result cmd-inline-result-ok" },
            "\u2713 Full analysis complete \u2014 tabs unlock as data refreshes")
        : null,
    ),
    state === "error" && error
      ? h("span", { class: "cmd-inline-result cmd-inline-result-err", role: "alert" }, error)
      : null,
  );
}

interface NextStep {
  priority: string;
  title: string;
  description: string;
  category: string;
}

/** Copy text to the clipboard with a legacy execCommand fallback. */
function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

/** Format the full step list as a numbered markdown list. */
function stepsToMarkdown(steps: NextStep[]): string {
  return steps
    .map((s, i) => `${i + 1}. **[${s.priority}]** ${s.title} — ${s.description}`)
    .join("\n");
}

/**
 * Prioritized next-step recommendations — the UI twin of the sourcevision
 * MCP `get_next_steps` tool. Rendered on the Overview so recommendations are
 * visible at any enrichment pass (the Suggestions tab requires pass ≥ 4).
 * Renders nothing while loading and when no steps are available — the same
 * convention as the other data-driven Overview sections.
 *
 * Each step can be copied individually, the whole list can be copied as
 * markdown, and the panel footer offers a confirm-guarded "Capture to PRD"
 * action that files the findings via POST /api/rex/capture-next-steps.
 */
export function NextStepsPanel() {
  const [steps, setSteps] = useState<NextStep[] | null>(null);
  const [copied, setCopied] = useState<number | "all" | null>(null);
  const [capture, setCapture] = useState<"idle" | "confirm" | "capturing" | "done" | "error">("idle");
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sv/next-steps?limit=5");
        if (!res.ok) return;
        const body = await res.json() as { steps?: NextStep[] };
        if (!cancelled && body.steps && body.steps.length > 0) setSteps(body.steps);
      } catch {
        // Panel is best-effort — stay hidden on failure
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleCopy = useCallback((text: string, which: number | "all") => {
    copyText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
    }).catch(() => {
      // Silent fail — button feedback simply doesn't appear
    });
  }, []);

  const handleCapture = useCallback(async () => {
    if (!steps) return;
    setCapture("capturing");
    setCaptureMsg(null);
    try {
      const res = await fetch("/api/rex/capture-next-steps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps }),
      });
      const body = await res.json().catch(() => ({})) as { created?: number; skipped?: number; error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const created = body.created ?? 0;
      const skipped = body.skipped ?? 0;
      setCaptureMsg(
        `✓ Captured ${created} to PRD` +
        (skipped > 0 ? ` (${skipped} duplicate${skipped === 1 ? "" : "s"} skipped)` : ""),
      );
      setCapture("done");
    } catch (err) {
      setCaptureMsg(String(err instanceof Error ? err.message : err));
      setCapture("error");
    }
  }, [steps]);

  if (!steps) return null;

  return h("div", { class: "overview-section overview-next-steps" },
    h("div", { class: "section-header-row" },
      h("h3", null, "Next Steps"),
      h("button", {
        class: "link-btn next-steps-copy-all",
        onClick: () => handleCopy(stepsToMarkdown(steps), "all"),
        title: "Copy all recommendations as a markdown list",
        "aria-label": "Copy all next steps as markdown",
        type: "button",
      }, copied === "all" ? "✓ Copied" : "Copy all"),
    ),
    h("ol", { class: "next-steps-list" },
      steps.map((s, i) =>
        h("li", { key: i, class: "next-step-item" },
          h("div", { class: "next-step-row" },
            h("span", { class: `next-step-priority next-step-priority-${s.priority}` }, s.priority),
            h("span", { class: "next-step-title" }, s.title),
            h("button", {
              class: "next-step-copy",
              onClick: () => handleCopy(`${s.title} — ${s.description}`, i),
              title: "Copy this recommendation",
              "aria-label": `Copy "${s.title}"`,
              type: "button",
            }, copied === i ? "✓" : "⎘"),
          ),
          h("div", { class: "next-step-desc" }, s.description),
        ),
      ),
    ),
    h("div", { class: "next-steps-footer" },
      capture === "idle" || capture === "done" || capture === "error"
        ? h("button", {
            class: "cmd-inline-trigger next-steps-capture-btn",
            onClick: () => { setCapture("confirm"); setCaptureMsg(null); },
            title: "File these recommendations as PRD items so they can be worked on",
            type: "button",
          },
            h("span", { "aria-hidden": "true" }, "\u{1F4CB}"),
            "Capture to PRD",
          )
        : null,
      capture === "confirm"
        ? h("span", { class: "next-steps-confirm" },
            `Capture ${steps.length} finding${steps.length === 1 ? "" : "s"} into the PRD?`,
            h("button", {
              class: "cmd-inline-trigger next-steps-confirm-btn",
              onClick: handleCapture,
              type: "button",
            }, "Confirm"),
            h("button", {
              class: "cmd-inline-trigger next-steps-cancel-btn",
              onClick: () => setCapture("idle"),
              type: "button",
            }, "Cancel"),
          )
        : null,
      capture === "capturing"
        ? h("span", { class: "next-steps-confirm", "aria-busy": "true" },
            h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" }),
            "Capturing...",
          )
        : null,
      h("span", { role: "status", "aria-live": "polite" },
        capture === "done" && captureMsg
          ? h("span", { class: "cmd-inline-result cmd-inline-result-ok" }, captureMsg)
          : null,
      ),
      capture === "error" && captureMsg
        ? h("span", { class: "cmd-inline-result cmd-inline-result-err", role: "alert" }, captureMsg)
        : null,
    ),
  );
}

interface OverviewProps {
  data: LoadedData;
  navigateTo?: NavigateTo;
  onSelect?: (detail: DetailItem | null) => void;
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f7df1e",
  CSS: "var(--purple)",
  HTML: "#e34f26",
  JSON: "#8b90a8",
  Markdown: "#8b90a8",
  SCSS: "#cc6699",
  Python: "#3776ab",
  Rust: "#dea584",
  Go: "#00add8",
};

export function Overview({ data, navigateTo, onSelect }: OverviewProps) {
  const { manifest, inventory, imports, zones, components } = data;

  if (!manifest && !inventory && !imports && !zones) {
    return h("div", { class: "loading" }, "No data loaded. Use 'sourcevision serve' or drop files.");
  }

  const hasZones = zones && zones.zones.length > 0;
  const hasImports = imports && imports.edges.length > 0;
  const showGettingStarted = manifest && (!hasImports || !hasZones);

  // Calculate overall health metrics
  const healthMetrics = useMemo(() => {
    if (!zones) return null;

    const avgCohesion = zones.zones.length > 0
      ? zones.zones.reduce((s, z) => s + z.cohesion, 0) / zones.zones.length
      : 0;

    const avgCoupling = zones.zones.length > 0
      ? zones.zones.reduce((s, z) => s + z.coupling, 0) / zones.zones.length
      : 0;

    // Count patterns and antipatterns from findings
    const patterns: string[] = [];
    const antipatterns: string[] = [];

    // High cohesion zones
    const highCohesionZones = zones.zones.filter(z => z.cohesion >= 0.8);
    if (highCohesionZones.length > zones.zones.length / 2) {
      patterns.push("Well-structured modules");
    }

    // Low coupling zones
    const lowCouplingZones = zones.zones.filter(z => z.coupling <= 0.3);
    if (lowCouplingZones.length > zones.zones.length / 2) {
      patterns.push("Clean boundaries");
    }

    // Check for circular deps
    if (imports && imports.summary.circularCount > 0) {
      antipatterns.push(`${imports.summary.circularCount} circular deps`);
    }

    // Hub files (too many importers)
    if (imports && imports.summary.mostImported.length > 0) {
      const hubs = imports.summary.mostImported.filter(f => f.count > 10);
      if (hubs.length > 0) {
        antipatterns.push(`${hubs.length} hub file${hubs.length > 1 ? "s" : ""}`);
      }
    }

    // Bidirectional coupling from findings
    const bidirectionalFindings = (zones.findings ?? []).filter(
      f => f.text.includes("Bidirectional")
    );
    if (bidirectionalFindings.length > 0) {
      antipatterns.push(`${bidirectionalFindings.length} bidirectional couplings`);
    }

    return { avgCohesion, avgCoupling, patterns, antipatterns };
  }, [zones, imports]);

  // Top zones by size
  const topZones = useMemo(() => {
    if (!zones) return [];
    return [...zones.zones]
      .sort((a, b) => b.files.length - a.files.length)
      .slice(0, 5);
  }, [zones]);

  // Language breakdown
  const langChartData = useMemo(() => {
    if (!inventory) return [];
    return Object.entries(inventory.summary.byLanguage)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([lang, count]) => ({
        label: lang,
        value: count,
        color: LANG_COLORS[lang] || "var(--accent)",
      }));
  }, [inventory]);

  // Zones needing attention count
  const attentionCount = useMemo(() => {
    if (!zones) return 0;
    return zones.zones.filter(z => z.cohesion < 0.4 || z.coupling > 0.5).length;
  }, [zones]);

  return h("div", { class: "overview-container" },
    // Header with project info
    manifest
      ? h("div", { class: "overview-header view-header" },
          h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
          h("h2", { class: "view-title" }, basename(manifest.targetPath)),
          h("p", { class: "overview-meta" },
            manifest.gitBranch ? `${manifest.gitBranch} ` : "",
            manifest.gitSha ? `(${manifest.gitSha.slice(0, 7)}) \u2022 ` : "",
            new Date(manifest.analyzedAt).toLocaleString()
          )
        )
      : h("div", { class: "view-header" },
          h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
          h("h2", { class: "view-title" }, "Overview"),
        ),

    // Getting Started guide for incomplete analysis
    showGettingStarted
      ? h("div", { class: "getting-started" },
          h("h3", null, "Getting Started"),
          h("p", null, "Complete the analysis to see architectural insights:"),
          h("ol", null,
            !hasImports
              ? h("li", null, h("code", null, "sourcevision analyze --phase=2"), " \u2014 Build import graph")
              : null,
            !hasZones
              ? h("li", null, h("code", null, "sourcevision analyze --phase=3"), " \u2014 Detect zones")
              : null,
            h("li", null, h("code", null, "sourcevision analyze --full"), " \u2014 Run full analysis"),
          ),
        )
      : null,

    // Re-analyze trigger
    h(AnalyzeControls, null),

    // Prioritized recommendations (hidden until analysis data exists)
    h(NextStepsPanel, null),

    // Main metrics row
    h("div", { class: "overview-metrics" },
      inventory
        ? h(MetricCard, {
            value: inventory.summary.totalFiles,
            label: "Files",
          })
        : null,
      inventory
        ? h(MetricCard, {
            value: Math.round(inventory.summary.totalLines / 1000) + "k",
            label: "Lines of Code",
          })
        : null,
      zones
        ? h(MetricCard, {
            value: zones.zones.length,
            label: "Zones",
            color: "var(--accent)",
          })
        : null,
      imports
        ? h(MetricCard, {
            value: imports.summary.circularCount,
            label: "Circular Deps",
            color: imports.summary.circularCount > 0 ? "var(--orange)" : "var(--green)",
          })
        : null
    ),

    // Architecture health section
    healthMetrics && zones
      ? h("div", { class: "overview-section" },
          h("div", { class: "section-header-row" },
            h("h3", null, "Architecture Health"),
            zones.enrichmentPass
              ? h("span", { class: "enrichment-badge" },
                  `Pass ${zones.enrichmentPass}${zones.metaEvaluationCount ? ` + ${zones.metaEvaluationCount} meta` : ""}`
                )
              : null,
            zones.lastReset
              ? h("span", { class: "enrichment-badge reset-badge" },
                  `Reset from Pass ${zones.lastReset.from} → ${zones.lastReset.to}`
                )
              : null
          ),

          h("div", { class: "health-row" },
            h(HealthGauge, {
              value: healthMetrics.avgCohesion,
              label: "Avg Cohesion",
              size: 90,
            }),
            h(HealthGauge, {
              value: healthMetrics.avgCoupling,
              label: "Avg Coupling",
              size: 90,
              inverted: true,
            }),
            h("div", { class: "pattern-list" },
              healthMetrics.patterns.map(p =>
                h(PatternBadge, { key: p, type: "pattern", label: p })
              ),
              healthMetrics.antipatterns.map(p =>
                h(PatternBadge, { key: p, type: "antipattern", label: p })
              )
            )
          )
        )
      : null,

    // Two-column layout: Languages + Zone summary
    h("div", { class: "overview-columns" },
      // Left column - Languages
      langChartData.length > 0
        ? h("div", { class: "overview-col" },
            h("h3", null, "Languages"),
            h(BarChart, { data: langChartData })
          )
        : null,

      // Right column - Compact zone summary
      topZones.length > 0
        ? h("div", { class: "overview-col" },
            h("div", { class: "section-header-row" },
              h("h3", null, "Top Zones"),
              navigateTo
                ? h("button", {
                    class: "link-btn",
                    onClick: () => navigateTo("graph"),
                  }, "Open map \u2192")
                : null
            ),
            h("div", { class: "top-zones-list" },
              topZones.map((zone, i) => {
                const globalIdx = zones!.zones.indexOf(zone);
                const color = getZoneColorByIndex(globalIdx);
                const healthColor = zone.cohesion >= 0.7 ? "var(--green)"
                  : zone.cohesion >= 0.4 ? "var(--orange)"
                  : "var(--red)";
                const healthLabel = zone.cohesion >= 0.7 ? "Good"
                  : zone.cohesion >= 0.4 ? "Fair"
                  : "Poor";

                const openZone = navigateTo ? () => navigateTo("graph", { zone: zone.id }) : undefined;

                return h("div", {
                  key: zone.id,
                  class: "top-zone-item",
                  onClick: openZone,
                  ...(openZone
                    ? {
                        role: "button",
                        tabIndex: 0,
                        "aria-label": `${zone.name}: ${zone.files.length} files, health ${healthLabel}. Open in map.`,
                        onKeyDown: (e: KeyboardEvent) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openZone();
                          }
                        },
                      }
                    : {}),
                },
                  h("span", { class: "zone-dot", style: `background: ${color}`, "aria-hidden": "true" }),
                  h("span", { class: "zone-name" }, zone.name),
                  h("span", { class: "zone-files" }, `${zone.files.length} files`),
                  h("span", {
                    class: "top-zone-health",
                    title: `Cohesion: ${zone.cohesion.toFixed(2)} / Coupling: ${zone.coupling.toFixed(2)}`,
                    style: `color: ${healthColor}`,
                  },
                    h("span", { class: "health-dot", style: `background: ${healthColor}`, "aria-hidden": "true" }),
                    h("span", { class: "health-label" }, healthLabel),
                  )
                );
              })
            ),
            attentionCount > 0
              ? h("div", { class: "zone-attention-note" },
                  `${attentionCount} zone${attentionCount > 1 ? "s" : ""} need${attentionCount === 1 ? "s" : ""} attention`
                )
              : null
          )
        : null
    ),

    // Circular dependencies (compact)
    imports?.summary.circulars.length
      ? h("div", { class: "overview-section" },
          h("h3", null, `${imports.summary.circularCount} Circular Dep${imports.summary.circularCount > 1 ? "s" : ""}`),
          h("div", { class: "circular-list" },
            imports.summary.circulars.slice(0, 3).map((c, i) =>
              h("div", { key: i, class: "circular-dep-block" },
                c.cycle.join(" \u2192 ") + " \u2192 " + c.cycle[0]
              )
            ),
            imports.summary.circulars.length > 3
              ? h("div", { class: "attention-more" },
                  `+${imports.summary.circulars.length - 3} more`
                )
              : null
          )
        )
      : null
  );
}
