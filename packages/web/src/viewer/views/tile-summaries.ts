/**
 * Collapsed summaries for the Analyze dashboard's tiles (stage-tiles.ts).
 *
 * Each reads only the analysis already loaded into `LoadedData` — no fetch of
 * its own — and uses the same selection its view uses (Problems are the
 * anti-pattern findings, Suggestions the suggestion findings, …), so a tile and
 * the view it expands into never disagree about a count. A tile with nothing
 * to show says so in one line; a view still behind an enrichment pass says
 * which pass it needs. Returning null leaves the tile showing its panel or,
 * for a view, the view itself clipped.
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import type { LoadedData } from "../types.js";
import type { Finding } from "../external.js";
import type { StageTile } from "./stages.js";
import { ENRICHMENT_THRESHOLDS } from "./enrichment-thresholds.js";
import { effectiveEnrichmentPass } from "../enrichment-pass.js";

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

function bySeverity(a: Finding, b: Finding): number {
  return (SEVERITY_ORDER[a.severity ?? "info"] ?? 2) - (SEVERITY_ORDER[b.severity ?? "info"] ?? 2);
}

function empty(text: string): ComponentChild {
  return h("p", { class: "tile-sum-empty" }, text);
}

function gated(requiredPass: number): ComponentChild {
  return empty(`Needs enrichment pass ${requiredPass} — run Full analysis to unlock it.`);
}

/** Count chips, in order, skipping zeroes. */
function chips(items: Array<[label: string, count: number, tone?: string]>): ComponentChild {
  const shown = items.filter(([, n]) => n > 0);
  return h("div", { class: "tile-sum-chips" },
    shown.map(([label, n, tone]) =>
      h("span", { key: label, class: `tile-sum-chip${tone ? ` tile-sum-chip--${tone}` : ""}` },
        h("strong", null, n.toLocaleString()), ` ${label}`),
    ),
  );
}

function findingList(findings: readonly Finding[]): ComponentChild {
  return h("ul", { class: "tile-sum-list", role: "list" },
    findings.slice(0, 3).map((f, i) =>
      h("li", { key: i, class: `tile-sum-item tile-sum-item--${f.severity ?? "info"}` }, f.text),
    ),
  );
}

function findingsSummary(data: LoadedData, type: Finding["type"], noun: string, requiredPass: number): ComponentChild {
  if (effectiveEnrichmentPass(data.zones, data.manifest) < requiredPass) return gated(requiredPass);
  const findings = (data.zones?.findings ?? []).filter((f) => f.type === type).sort(bySeverity);
  if (findings.length === 0) return empty(`No ${noun} found.`);
  const count = (s: string) => findings.filter((f) => (f.severity ?? "info") === s).length;
  return h("div", null,
    chips([["critical", count("critical"), "critical"], ["warning", count("warning"), "warning"], ["info", count("info")]]),
    findingList(findings),
  );
}

function zonesSummary(data: LoadedData): ComponentChild {
  const zones = data.zones?.zones ?? [];
  if (zones.length === 0) return empty("No zones loaded.");
  const attention = zones.filter((z) => z.cohesion < 0.4 || z.coupling > 0.5).length;
  const files = zones.reduce((n, z) => n + z.files.length, 0);
  const largest = [...zones].sort((a, b) => b.files.length - a.files.length).slice(0, 4);
  const circular = data.imports?.summary.circularCount ?? 0;
  return h("div", null,
    chips([["zones", zones.length], ["need attention", attention, "warning"], ["import cycles", circular, "warning"]]),
    h("ul", { class: "tile-sum-list tile-sum-bars", role: "list" },
      largest.map((z) => {
        const share = files > 0 ? z.files.length / files : 0;
        const tone = z.cohesion >= 0.7 ? "good" : z.cohesion >= 0.4 ? "fair" : "poor";
        return h("li", { key: z.id, class: "tile-sum-bar" },
          h("span", { class: "tile-sum-bar-label" }, z.name),
          h("span", { class: "tile-sum-bar-track", "aria-hidden": "true" },
            h("span", { class: `tile-sum-bar-fill tile-sum-bar-fill--${tone}`, style: `width: ${Math.max(2, Math.round(share * 100))}%` }),
          ),
          h("span", { class: "tile-sum-bar-value" }, `${Math.round(share * 100)}%`),
        );
      }),
    ),
  );
}

function filesSummary(data: LoadedData): ComponentChild {
  const summary = data.inventory?.summary;
  if (!summary) return empty("No file inventory loaded.");
  const roles = Object.entries(summary.byRole ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  return h("div", null,
    h("p", { class: "tile-sum-headline" },
      h("strong", null, summary.totalFiles.toLocaleString()), " files · ",
      h("strong", null, `${Math.round(summary.totalLines / 1000).toLocaleString()}k`), " lines"),
    chips(roles.map(([role, n]) => [role, n])),
  );
}

function architectureSummary(data: LoadedData): ComponentChild {
  if (effectiveEnrichmentPass(data.zones, data.manifest) < ENRICHMENT_THRESHOLDS.architecture) {
    return gated(ENRICHMENT_THRESHOLDS.architecture);
  }
  const findings = (data.zones?.findings ?? []).filter((f) => f.type === "pattern" || f.type === "relationship");
  const crossings = data.zones?.crossings?.length ?? 0;
  if (findings.length === 0 && crossings === 0) return empty("No architecture findings yet.");
  return h("div", null,
    chips([
      ["patterns", findings.filter((f) => f.type === "pattern").length],
      ["relationships", findings.filter((f) => f.type === "relationship").length],
      ["cross-zone imports", crossings],
    ]),
    findings.length > 0 ? findingList([...findings].sort(bySeverity)) : null,
  );
}

/** The Analyze dashboard's collapsed tile bodies. Null: show the panel or the clipped view. */
export function analyzeTileSummary(tile: StageTile, data: LoadedData): ComponentChild | null {
  if (tile.panel) return null;
  switch (tile.view) {
    case "problems": return findingsSummary(data, "anti-pattern", "problems", ENRICHMENT_THRESHOLDS.problems);
    case "suggestions": return findingsSummary(data, "suggestion", "suggestions", ENRICHMENT_THRESHOLDS.suggestions);
    case "zones": return zonesSummary(data);
    case "files": return filesSummary(data);
    case "architecture": return architectureSummary(data);
    default: return null;
  }
}
