import { h } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { LoadedData, NavigateTo, DetailItem } from "../types.js";
import type { Zone, Finding } from "../../schema/v1.js";
import {
  BarChart,
  CollapsibleSection,
  HealthGauge,
  PatternBadge,
  MetricCard,
  ZoneMap,
  ZoneDetail,
  getZoneColorByIndex,
} from "../visualization/index.js";
import { basename } from "../utils.js";
import { BrandedHeader } from "../components/logos.js";

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
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

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

  // Zone with issues (low cohesion or high coupling)
  const zonesWithIssues = useMemo(() => {
    if (!zones) return [];
    return zones.zones.filter(z => z.cohesion < 0.4 || z.coupling > 0.5);
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

  // Handle zone click from map
  const handleZoneClick = (zoneId: string) => {
    setSelectedZoneId(zoneId);
  };

  const selectedZone = selectedZoneId
    ? zones?.zones.find(z => z.id === selectedZoneId)
    : null;

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

    // Zone Map visualization
    zones && zones.zones.length > 0
      ? h(ZoneMap, {
          zones: zones.zones,
          crossings: zones.crossings,
          selectedZone: selectedZoneId,
          onZoneClick: handleZoneClick,
        })
      : null,

    // Two-column layout for details
    h("div", { class: "overview-columns" },
      // Left column - Languages
      langChartData.length > 0
        ? h("div", { class: "overview-col" },
            h("h3", null, "Languages"),
            h(BarChart, { data: langChartData })
          )
        : null,

      // Right column - Top Zones
      topZones.length > 0
        ? h("div", { class: "overview-col" },
            h("h3", null, "Largest Zones"),
            h("div", { class: "top-zones-list" },
              topZones.map((zone, i) => {
                const globalIdx = zones!.zones.indexOf(zone);
                const color = getZoneColorByIndex(globalIdx);

                return h("div", {
                  key: zone.id,
                  class: "top-zone-item",
                  onClick: () => handleZoneClick(zone.id),
                },
                  h("span", { class: "zone-dot", style: `background: ${color}` }),
                  h("span", { class: "zone-name" }, zone.name),
                  h("span", { class: "zone-files" }, `${zone.files.length} files`)
                );
              })
            )
          )
        : null
    ),

    // Zones needing attention
    zonesWithIssues.length > 0
      ? h("div", { class: "overview-section" },
          h("h3", null, "Zones Needing Attention"),
          h("div", { class: "attention-list" },
            zonesWithIssues.slice(0, 5).map(zone => {
              const issues: string[] = [];
              if (zone.cohesion < 0.4) issues.push(`Low cohesion (${zone.cohesion.toFixed(2)})`);
              if (zone.coupling > 0.5) issues.push(`High coupling (${zone.coupling.toFixed(2)})`);

              return h("div", { key: zone.id, class: "attention-item" },
                h("span", { class: "attention-name" }, zone.name),
                h("span", { class: "attention-issues" },
                  issues.map(issue =>
                    h("span", { key: issue, class: "issue-tag" }, issue)
                  )
                )
              );
            }),
            zonesWithIssues.length > 5
              ? h("div", { class: "attention-more" },
                  `+${zonesWithIssues.length - 5} more zones`
                )
              : null
          )
        )
      : null,

    // Key insights from zones
    zones?.insights && zones.insights.length > 0
      ? h(CollapsibleSection, {
          title: "Key Insights",
          count: zones.insights.length,
          defaultOpen: true,
          threshold: 10,
        },
          ...zones.insights.slice(0, 10).map((insight, i) =>
            h("div", { key: i, class: "insight-item" }, insight)
          ),
          zones.insights.length > 10
            ? h("div", { class: "insight-more" },
                `+${zones.insights.length - 10} more insights in zones.json`
              )
            : null
        )
      : null,

    // Circular dependencies (if any)
    imports?.summary.circulars.length
      ? h(CollapsibleSection, {
          title: "Circular Dependencies",
          count: imports.summary.circularCount,
          defaultOpen: true,
          threshold: 5,
        },
          ...imports.summary.circulars.map((c, i) =>
            h("div", { key: i, class: "circular-dep-block" },
              c.cycle.join(" \u2192 ") + " \u2192 " + c.cycle[0]
            )
          )
        )
      : null,

    // Zone detail popup
    selectedZone && zones
      ? h(ZoneDetail, {
          zone: selectedZone,
          crossings: zones.crossings,
          allZones: zones.zones,
          onClose: () => setSelectedZoneId(null),
          onFileClick: navigateTo
            ? (path) => navigateTo("files", { file: path })
            : undefined,
        })
      : null
  );
}
