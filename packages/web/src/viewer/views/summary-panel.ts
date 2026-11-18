/**
 * The Analyze dashboard's Summary tile: what the codebase is made of — its
 * files and lines, its languages as a pie, its largest zones and its files by
 * role — in one tile where Zones, Languages and Files used to be three.
 *
 * It reads only the analysis already loaded into `LoadedData` and uses the
 * selections the Zones and Files views use, so the tile and the views it opens
 * to never disagree about a count. A zone with issues carries the same "!" the
 * codebase map puts on it, when the dashboard's provider has marked it.
 * Opened, the tile's first tab shows every language and every role; Zones and
 * Files follow as tabs of their own.
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import type { LoadedData } from "../types.js";
import { zoneNeedsAttention } from "../visualization/metrics.js";
import { LanguagesPanel } from "./overview.js";
import { useAnalyzeActions } from "./analyze-actions-context.js";

function empty(text: string): ComponentChild {
  return h("p", { class: "tile-sum-empty" }, text);
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

function headline(data: LoadedData): ComponentChild {
  const summary = data.inventory?.summary;
  const zones = data.zones?.zones.length ?? 0;
  const languages = Object.keys(summary?.byLanguage ?? {}).length;
  if (!summary && zones === 0) return empty("No analysis loaded yet.");
  const part = (n: string, label: string) => [h("strong", null, n), ` ${label}`];
  const parts = [
    summary ? part(summary.totalFiles.toLocaleString(), "files") : null,
    summary ? part(`${Math.round(summary.totalLines / 1000).toLocaleString()}k`, "lines") : null,
    zones > 0 ? part(zones.toLocaleString(), "zones") : null,
    languages > 0 ? part(languages.toLocaleString(), languages === 1 ? "language" : "languages") : null,
  ].filter((p) => p !== null);
  return h("p", { class: "tile-sum-headline" },
    parts.flatMap((p, i) => (i > 0 ? [" · ", ...p!] : p!)));
}

function zonesSummary(data: LoadedData, issues: Readonly<Record<string, string>> | null): ComponentChild {
  const zones = data.zones?.zones ?? [];
  if (zones.length === 0) return empty("No zones loaded.");
  const attention = zones.filter(zoneNeedsAttention).length;
  const files = zones.reduce((n, z) => n + z.files.length, 0);
  const largest = [...zones].sort((a, b) => b.files.length - a.files.length).slice(0, 4);
  const circular = data.imports?.summary.circularCount ?? 0;
  const flagged = (id: string, z: (typeof zones)[number]) => (issues ? !!issues[id] : zoneNeedsAttention(z));
  return h("section", { class: "summary-block", "aria-label": "Zones" },
    chips([["zones", zones.length], ["need attention", attention, "warning"], ["import cycles", circular, "warning"]]),
    h("ul", { class: "tile-sum-list tile-sum-bars", role: "list", "aria-label": "Largest zones" },
      largest.map((z) => {
        const share = files > 0 ? z.files.length / files : 0;
        const tone = z.cohesion >= 0.7 ? "good" : z.cohesion >= 0.4 ? "fair" : "poor";
        const issue = flagged(z.id, z);
        return h("li", { key: z.id, class: "tile-sum-bar" },
          h("span", { class: "tile-sum-bar-label" },
            issue ? h("span", { class: "summary-issue", title: "Has issues — marked ! on the map" }, "!") : null,
            z.name),
          h("span", { class: "tile-sum-bar-track", "aria-hidden": "true" },
            h("span", { class: `tile-sum-bar-fill tile-sum-bar-fill--${tone}`, style: `width: ${Math.max(2, Math.round(share * 100))}%` }),
          ),
          h("span", { class: "tile-sum-bar-value" }, `${Math.round(share * 100)}%`),
        );
      }),
    ),
  );
}

function rolesSummary(data: LoadedData, limit: number): ComponentChild {
  const summary = data.inventory?.summary;
  if (!summary) return empty("No file inventory loaded.");
  const roles = Object.entries(summary.byRole ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);
  // Bars, not chips: each role's share of the files, across the tile's width.
  const total = summary.totalFiles || roles.reduce((n, [, c]) => n + c, 0);
  return h("ul", { class: "tile-sum-list tile-sum-bars", role: "list", "aria-label": "Files by role" },
    roles.map(([role, n]) => {
      const share = total > 0 ? n / total : 0;
      return h("li", { key: role, class: "tile-sum-bar", title: `${n.toLocaleString()} ${role} files` },
        h("span", { class: "tile-sum-bar-label" }, role),
        h("span", { class: "tile-sum-bar-track", "aria-hidden": "true" },
          h("span", { class: "tile-sum-bar-fill tile-sum-bar-fill--neutral", style: `width: ${Math.max(2, Math.round(share * 100))}%` })),
        h("span", { class: "tile-sum-bar-value" }, n.toLocaleString()),
      );
    }));
}

/**
 * The Summary tile: the totals, the languages as a pie, the largest zones and
 * the files by role. Opened (its first tab): every language with its share,
 * lines and import analysis, and every role.
 */
export function SummaryPanel({ data, opened = false }: { data: LoadedData; opened?: boolean }): ComponentChild {
  const issues = useAnalyzeActions()?.issues ?? null;
  if (opened) {
    return h("div", { class: "summary-panel summary-panel--opened" },
      headline(data),
      h("section", { class: "summary-block", "aria-labelledby": "summary-languages" },
        h("h3", { id: "summary-languages" }, "Languages"),
        h(LanguagesPanel, { data, opened: true }),
      ),
      h("section", { class: "summary-block", "aria-labelledby": "summary-roles" },
        h("h3", { id: "summary-roles" }, "Files by role"),
        rolesSummary(data, Infinity),
      ),
    );
  }
  return h("div", { class: "summary-panel" },
    headline(data),
    h(LanguagesPanel, { data }),
    zonesSummary(data, issues),
    h("section", { class: "summary-block", "aria-label": "Files by role" }, rolesSummary(data, 4)),
  );
}
