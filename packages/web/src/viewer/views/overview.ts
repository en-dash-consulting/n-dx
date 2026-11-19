import { h, Fragment } from "preact";
import { useState, useCallback, useMemo } from "preact/hooks";
import type { LoadedData, NavigateTo, DetailItem } from "../types.js";
import type { ComponentChild } from "preact";
import {
  BarChart,
  PatternBadge,
  getZoneColorByIndex,
  zoneNeedsAttention,
} from "../visualization/index.js";
import { basename } from "../utils.js";
import { formatSince } from "../utils/format.js";
import { narrationNotice } from "./narration-notice.js";
import { IsoMapHero } from "./iso-map.js";
import { DeliveryPanel, deliveryAnalysisStamp } from "./delivery.js";
import { isoMapAnalysisStamp } from "./iso-map-url.js";
import { ActionIcon, AnalyzeControls, BrandedHeader, InfoTip } from "../components/index.js";
import type { JobTray } from "../hooks/index.js";
import { NextStepsCapture, copyText, stepsToMarkdown, useNextSteps, type NextStep } from "./next-steps.js";
import { concernCardProps, type ActionItem, type RecommendationFocus } from "./action-items.js";
import { useAnalyzeActions } from "./analyze-actions-context.js";

const NEXT_STEPS_OPEN_KEY = "ndx.overview.next-steps-open";

function readNextStepsOpen(): boolean {
  try {
    return localStorage.getItem(NEXT_STEPS_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeNextStepsOpen(open: boolean): void {
  try {
    localStorage.setItem(NEXT_STEPS_OPEN_KEY, open ? "1" : "0");
  } catch { /* storage unavailable — state lasts for this page */ }
}

const PRIORITY_ORDER = ["critical", "high", "medium", "low"];

/** `[priority, count]` pairs, most severe first; unknown priorities last. */
function priorityCounts(steps: NextStep[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const s of steps) counts.set(s.priority, (counts.get(s.priority) ?? 0) + 1);
  const rank = (p: string) => {
    const i = PRIORITY_ORDER.indexOf(p);
    return i === -1 ? PRIORITY_ORDER.length : i;
  };
  return [...counts.entries()].sort(([a], [b]) => rank(a) - rank(b));
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
 *
 * Collapsed by default to one summary line — the count by priority and the
 * top step's title — so the map above it stays the first thing on the page.
 * The open state is remembered per browser.
 *
 * The Analyze dashboard lists the same steps in its health tile, beside the
 * problems and suggestions they do not cover (health-actions.ts).
 */
export function NextStepsPanel() {
  const steps = useNextSteps(5);
  const [copied, setCopied] = useState<number | "all" | null>(null);
  const [open, setOpen] = useState<boolean>(() => readNextStepsOpen());

  const handleCopy = useCallback((text: string, which: number | "all") => {
    copyText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
    }).catch(() => {
      // Silent fail — button feedback simply doesn't appear
    });
  }, []);

  if (!steps) return null;

  const counts = priorityCounts(steps);

  return h("details", {
    class: "overview-section overview-next-steps",
    open,
    onToggle: (e: Event) => {
      const next = (e.currentTarget as HTMLDetailsElement).open;
      setOpen(next);
      writeNextStepsOpen(next);
    },
  },
    h("summary", { class: "section-header-row next-steps-summary" },
      h("span", { class: "next-steps-caret", "aria-hidden": "true" }, open ? "▾" : "▸"),
      h("h3", null, "Next Steps"),
      h("span", { class: "next-steps-counts" },
        counts.map(([priority, n]) =>
          h("span", { key: priority, class: `next-step-priority next-step-priority-${priority}` }, `${n} ${priority}`),
        ),
      ),
      !open
        ? h("span", { class: "next-steps-preview" }, steps[0]!.title)
        : null,
      h("button", {
        class: "link-btn next-steps-copy-all",
        onClick: (e: Event) => {
          // Inside <summary>: copying must not also toggle the panel.
          e.preventDefault();
          handleCopy(stepsToMarkdown(steps), "all");
        },
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
            }, h(ActionIcon, { name: copied === i ? "check" : "copy" })),
          ),
          h("div", { class: "next-step-desc" }, s.description),
        ),
      ),
    ),
    h(NextStepsCapture, { steps }),
  );
}

interface OverviewProps {
  data: LoadedData;
  navigateTo?: NavigateTo;
  onSelect?: (detail: DetailItem | null) => void;
  /** Shared job tray — AnalyzeControls starts and reads the full run there. */
  jobs: JobTray;
  /**
   * `lead`: only the analysis line and its controls — the Analyze
   * dashboard's lead, whose map, health, Next steps and Languages are tiles
   * of their own (MapPanel, CodebaseStats, NextStepsPanel, LanguagesPanel).
   * Default `full`.
   */
  variant?: "full" | "lead";
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f7df1e",
  "C#": "#9b4f96",
  "ASP.NET": "#512bd4",
  SQL: "#e38c00",
  Java: "#b07219",
  Kotlin: "#a97bff",
  Swift: "#f05138",
  Ruby: "#cc342d",
  PHP: "#777bb4",
  Shell: "#89e051",
  "C++": "#f34b7d",
  C: "#555555",
  Vue: "#41b883",
  CSS: "var(--purple)",
  HTML: "#e34f26",
  JSON: "#8b90a8",
  Markdown: "#8b90a8",
  SCSS: "#cc6699",
  Python: "#3776ab",
  Rust: "#dea584",
  Go: "#00add8",
};

/** The facts the isometric map's caption lists: zones, imports and the branch, when known. */
function isoMapFacts({ zones, imports, manifest }: LoadedData): string[] {
  return [
    `${zones?.zones.length ?? 0} zones`,
    imports ? `${imports.edges.length.toLocaleString()} imports` : "",
    manifest?.gitBranch ?? "",
  ].filter(Boolean);
}

/** Green ≥ 0.7, orange ≥ 0.4, red below — higher is better. */
function healthColor(score: number): string {
  return score >= 0.7 ? "var(--green)" : score >= 0.4 ? "var(--orange)" : "var(--red)";
}

export interface StatTileProps {
  glyph: string;
  label: string;
  value: string;
  /** One quiet line under the label. */
  sub?: string;
  /** Colour for the value, the glyph's tint and the meter. */
  tone?: string;
  /** 0–1 fill for a meter under the value (cohesion, coupling). */
  meter?: number;
  info?: ComponentChild;
  /** Makes the whole card a control; the info tip stays its own button above it. */
  onOpen?: () => void;
  /** A toggle rather than a link: its pressed state (the health list's filter). */
  pressed?: boolean;
  /** Pointer over the card, or focus on its control, and away again. */
  onHover?: (over: boolean) => void;
  /** What pressing does, read after the value ("show related items"). Default: "show". */
  action?: string;
  /** Tooltip for the card's control. */
  hint?: string;
}

export function StatTile({ glyph, label, value, sub, tone, meter, info, onOpen, pressed, onHover, action = "show", hint }: StatTileProps) {
  const color = tone ?? "var(--accent)";
  return h("div", {
    class: `overview-stat${onOpen ? " overview-stat--action" : ""}${pressed ? " overview-stat--pressed" : ""}`,
    role: "listitem",
    style: `--stat-tone: ${color}`,
    onMouseEnter: onHover ? () => onHover(true) : undefined,
    onMouseLeave: onHover ? () => onHover(false) : undefined,
  },
    onOpen
      ? h("button", {
          type: "button",
          class: "overview-stat-open",
          onClick: onOpen,
          "aria-label": `${label}: ${value} — ${action}`,
          "aria-pressed": pressed === undefined ? undefined : String(pressed),
          title: hint,
          onFocus: onHover ? () => onHover(true) : undefined,
          onBlur: onHover ? () => onHover(false) : undefined,
        })
      : null,
    h("span", { class: "overview-stat-glyph", "aria-hidden": "true" }, glyph),
    h("div", { class: "overview-stat-body" },
      h("span", { class: "overview-stat-label" }, label, info ?? null),
      h("span", { class: "overview-stat-value" }, value),
      meter !== undefined
        ? h("span", { class: "overview-stat-meter", "aria-hidden": "true" },
            h("span", { style: `width: ${Math.round(Math.max(0, Math.min(1, meter)) * 100)}%` }),
          )
        : null,
      sub ? h("span", { class: "overview-stat-sub" }, sub) : null,
    ),
  );
}

export function Overview({ data, navigateTo, onSelect, jobs, variant = "full" }: OverviewProps) {
  const lead = variant === "lead";
  const { manifest, inventory, imports, zones } = data;

  // The memos run before the no-data return below, so every render calls the
  // same hooks in the same order.

  // Top zones by size
  const topZones = useMemo(() => {
    if (!zones) return [];
    return [...zones.zones]
      .sort((a, b) => b.files.length - a.files.length)
      .slice(0, 5);
  }, [zones]);

  // Language breakdown
  const langChartData = useMemo(() => languageChartData(data), [inventory]);

  // Zones needing attention count
  const attentionCount = useMemo(() => {
    if (!zones) return 0;
    return zones.zones.filter(zoneNeedsAttention).length;
  }, [zones]);

  if (!manifest && !inventory && !imports && !zones) {
    return h("div", { class: "loading" }, "No data loaded. Use 'sourcevision serve' or drop files.");
  }

  const hasZones = zones && zones.zones.length > 0;
  const hasImports = imports && imports.edges.length > 0;
  const showGettingStarted = manifest && (!hasImports || !hasZones);

  const narration = manifest ? narrationNotice(manifest.narration) : null;

  return h("div", { class: "overview-container overview--map-first" },
    // Kept for the standalone Overview route; the stage page hides view headers.
    manifest
      ? h("div", { class: "overview-header view-header" },
          h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
          h("h2", { class: "view-title" }, basename(manifest.targetPath)),
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

    // Which analysis this is, and the control to refresh it. On the Analysis
    // dashboard both sit in the page head instead (the `lead` variant).
    lead ? null : h("div", { class: "overview-topbar" },
      h(AnalysisStatus, { data }),
      h(AnalyzeControls, { jobs }),
    ),
    narration
      ? h("p", { class: "overview-meta overview-narration", role: "status" }, narration)
      : null,

    // The map leads: the codebase's shape before any number about it.
    hasZones && !lead
      ? h(IsoMapHero, {
          analysisStamp: isoMapAnalysisStamp(data),
          facts: isoMapFacts(data),
          onOpenOptions: navigateTo ? () => navigateTo("iso-map") : undefined,
        })
      : null,

    // Headline numbers and architecture health, as one row of tiles.
    lead ? null : h(CodebaseStats, { data }),

    // Prioritized recommendations (hidden until analysis data exists)
    lead ? null : h(NextStepsPanel, null),

    // SDLC readiness and discovered infrastructure, with their evidence.
    lead ? null : h("div", { class: "overview-section" },
      h("h3", null, "Delivery & infrastructure"),
      h(DeliveryPanel, { stamp: deliveryAnalysisStamp(manifest), opened: true }),
    ),

    // Two-column layout: Languages + Zone summary
    lead ? null : h("div", { class: "overview-columns" },
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
    !lead && imports?.summary.circulars.length
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

// ── Dashboard panels ─────────────────────────────────────────

/**
 * The codebase map as the Analyze dashboard's hero tile. Its Expand opens the
 * map tile's modal (`onExpand`); inside the modal (`opened`) it fills the
 * space and leaves the title and Expand to the modal.
 *
 * Under the dashboard's provider the map carries the tiles' recommendations:
 * a "!" on every zone with issues, and while the pointer is over a
 * recommended fix, that fix's zones lit and a note beside the map naming them
 * — or saying it is not on the map, or adds files the map cannot draw yet.
 */
export function MapPanel({ data, navigateTo, opened = false, onExpand }: {
  data: LoadedData;
  navigateTo?: NavigateTo;
  opened?: boolean;
  onExpand?: () => void;
}): ComponentChild {
  const shared = useAnalyzeActions();
  const { zones } = data;
  if (!zones || zones.zones.length === 0) {
    return h("p", { class: "stage-tile-empty" }, "No zones yet — run an analysis to draw the map.");
  }
  const hovered = shared?.hovered ?? null;
  const flagged = shared ? Object.keys(shared.issues).length : 0;
  const facts = isoMapFacts(data);
  return h(Fragment, null,
    h(IsoMapHero, {
      analysisStamp: isoMapAnalysisStamp(data),
      facts: flagged > 0 ? [...facts, `${flagged} with issues (!)`] : facts,
      onOpenOptions: navigateTo ? () => navigateTo("iso-map") : undefined,
      onExpand: opened ? undefined : onExpand,
      hosted: opened,
      marks: shared ? { issues: shared.issues, lit: hovered && hovered.zones.length > 0 ? hovered.zones : null } : undefined,
    }),
    hovered ? h(MapNote, { zones: hovered.zones, note: hovered.note, names: zones.zones }) : null,
  );
}

/** Beside the map while a recommendation is hovered: where it is, or why it is not drawn. */
function MapNote({ zones, note, names }: {
  zones: readonly string[];
  note?: string;
  names: ReadonlyArray<{ id: string; name: string }>;
}): ComponentChild {
  const name = (id: string) => names.find((z) => z.id === id)?.name ?? id;
  return h("aside", { class: "map-note", role: "status", "aria-live": "polite" },
    zones.length > 0
      ? h("p", { class: "map-note-zones" }, h("strong", null, "Lit on the map: "), zones.map(name).join(", "))
      : h("p", { class: "map-note-zones" }, h("strong", null, "Not on the map"), " — no zone it names is drawn."),
    note ? h("p", { class: "map-note-new" }, h("span", { class: "map-note-mark", "aria-hidden": "true" }, "+"), note) : null,
  );
}

interface PieSlice { label: string; value: number; color: string }

/** Slices past the first `max` fold into one "Other" slice. */
function foldSlices(slices: readonly PieSlice[], max: number): PieSlice[] {
  if (slices.length <= max) return [...slices];
  const rest = slices.slice(max - 1).reduce((n, s) => n + s.value, 0);
  return [...slices.slice(0, max - 1), { label: "Other", value: rest, color: "var(--text-dim)" }];
}

/**
 * Files by language as a donut, with a legend of each slice's share. Each
 * slice is a stroked arc of one circle, so the chart scales with no layout
 * code and every slice can carry its own title.
 */
export function LanguagePie({ slices, label = "Files by language" }: { slices: readonly PieSlice[]; label?: string }): ComponentChild {
  const total = slices.reduce((n, s) => n + s.value, 0);
  const r = 15.9155; // circumference 100: an arc's length is its percentage
  let offset = 0;
  return h("div", { class: "lang-pie" },
    h("svg", { class: "lang-pie-chart", viewBox: "0 0 42 42", role: "img", "aria-label": label },
      h("circle", { cx: 21, cy: 21, r, fill: "none", stroke: "var(--bg-hover)", "stroke-width": 6 }),
      slices.map((s) => {
        const pct = total > 0 ? (s.value / total) * 100 : 0;
        const arc = h("circle", {
          key: s.label, cx: 21, cy: 21, r, fill: "none", stroke: s.color, "stroke-width": 6,
          "stroke-dasharray": `${pct} ${100 - pct}`,
          "stroke-dashoffset": String(25 - offset),
        }, h("title", null, `${s.label}: ${s.value.toLocaleString()} files (${Math.round(pct)}%)`));
        offset += pct;
        return arc;
      }),
    ),
    h("ul", { class: "lang-pie-legend", role: "list" },
      slices.map((s) => h("li", { key: s.label },
        h("span", { class: "languages-swatch", style: `background: ${s.color}`, "aria-hidden": "true" }),
        h("span", { class: "lang-pie-label" }, s.label),
        h("span", { class: "lang-pie-share" }, `${total > 0 ? Math.round((s.value / total) * 100) : 0}%`),
      )),
    ),
  );
}

/**
 * Source files by language. In the tile, a pie of the top languages; opened,
 * the pie beside every language with its files, lines and share, whether its
 * imports are analysed, and the extensions the inventory skipped.
 */
export function LanguagesPanel({ data, opened = false }: { data: LoadedData; opened?: boolean }): ComponentChild {
  const rows = useMemo(() => languageRows(data), [data.inventory]);
  if (rows.length === 0) return h("p", { class: "stage-tile-empty" }, "No inventory loaded.");
  // Every language counts toward the slices; past the first few they share "Other".
  const slices = rows.map((r) => ({ label: r.language, value: r.files, color: r.color }));
  if (!opened) return h(LanguagePie, { slices: foldSlices(slices, 6) });

  const skipped = Object.entries(data.inventory?.summary.skippedExtensions ?? {}).sort(([, a], [, b]) => b - a);
  return h("div", { class: "languages-breakdown" },
    h(LanguagePie, { slices: foldSlices(slices, 9) }),
    h("table", { class: "languages-table" },
      h("thead", null, h("tr", null,
        h("th", null, "Language"),
        h("th", { class: "num" }, "Files"),
        h("th", { class: "num" }, "Lines"),
        h("th", { class: "num" }, "Share"),
        h("th", null, "Imports"),
      )),
      h("tbody", null, rows.map((r) => h("tr", { key: r.language },
        h("td", null,
          h("span", { class: "languages-swatch", style: `background: ${r.color}`, "aria-hidden": "true" }),
          r.language),
        h("td", { class: "num" }, r.files.toLocaleString()),
        h("td", { class: "num" }, r.lines.toLocaleString()),
        h("td", { class: "num" }, `${r.share}%`),
        h("td", { class: r.analysed ? "languages-analysed" : "languages-inventoried" },
          r.analysed ? "analysed" : "inventoried only"),
      ))),
    ),
    skipped.length > 0
      ? h("p", { class: "languages-skipped" },
          h("strong", null, "Skipped: "),
          skipped.map(([ext, n]) => `${ext} (${n.toLocaleString()})`).join(" · "))
      : null,
  );
}

interface LanguageRow { language: string; files: number; lines: number; share: number; analysed: boolean; color: string }

function languageRows(data: LoadedData): LanguageRow[] {
  const inventory = data.inventory;
  if (!inventory) return [];
  const lines = new Map<string, number>();
  for (const f of inventory.files) lines.set(f.language, (lines.get(f.language) ?? 0) + (f.lineCount ?? 0));
  const total = inventory.summary.totalFiles || 1;
  const analysed = new Set(inventory.summary.analysedLanguages ?? []);
  return Object.entries(inventory.summary.byLanguage)
    .sort(([, a], [, b]) => b - a)
    .map(([language, files]) => ({
      language,
      files,
      lines: lines.get(language) ?? 0,
      share: Math.round((files / total) * 1000) / 10,
      analysed: analysed.has(language),
      color: LANG_COLORS[language] || "var(--accent)",
    }));
}

function languageChartData(data: LoadedData): Array<{ label: string; value: number; color: string }> {
  const inventory = data.inventory;
  if (!inventory) return [];
  return Object.entries(inventory.summary.byLanguage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([lang, count]) => ({ label: lang, value: count, color: LANG_COLORS[lang] || "var(--accent)" }));
}

export type StatKey = "files" | "zones" | "cycles" | "cohesion" | "coupling";

interface CodebaseStatsProps {
  data: LoadedData;
  onStat?: (stat: StatKey) => void;
  /**
   * Ties Avg cohesion and Avg coupling to the recommended fixes: hovering one
   * highlights the fixes it concerns, pressing it filters the list to them.
   * Takes over `onStat` for those two cards.
   */
  focus?: { focus: RecommendationFocus; items: readonly ActionItem[] };
  /** Further cards after these, in the same list (the dashboard's infrastructure cards). */
  extra?: ComponentChild[];
}

/** Headline numbers and architecture health: Overview's stats row, and the dashboard's visuals tile. */
export function CodebaseStats({ data, onStat, focus, extra = [] }: CodebaseStatsProps): ComponentChild {
  const open = (stat: StatKey) => (onStat ? () => onStat(stat) : undefined);
  const concernCard = (concern: "cohesion" | "coupling") =>
    focus ? concernCardProps(focus.focus, focus.items, concern) : { onOpen: open(concern) };
  const { inventory, imports, zones } = data;
  const healthMetrics = useMemo(() => computeHealthMetrics(zones, imports), [zones, imports]);
  const attentionCount = useMemo(
    () => (zones ? zones.zones.filter(zoneNeedsAttention).length : 0),
    [zones],
  );
  return h("div", { class: "overview-stats", role: "list", "aria-label": "Codebase summary" },
      inventory
        ? h(StatTile, {
            glyph: "▤",
            label: "Files", onOpen: open("files"),
            value: inventory.summary.totalFiles.toLocaleString(),
            sub: `${Math.round(inventory.summary.totalLines / 1000).toLocaleString()}k lines`,
          })
        : null,
      zones
        ? h(StatTile, {
            glyph: "◇",
            label: "Zones", onOpen: open("zones"),
            value: String(zones.zones.length),
            sub: attentionCount > 0 ? `${attentionCount} need attention` : "all healthy",
            tone: attentionCount > 0 ? "var(--orange)" : undefined,
            info: h(InfoTip, { term: "zone", label: "zones" }),
          })
        : null,
      imports
        ? h(StatTile, {
            glyph: "⟲",
            label: "Circular deps", onOpen: open("cycles"),
            value: String(imports.summary.circularCount),
            sub: imports.summary.circularCount > 0 ? "cycles to break" : "no import cycles",
            tone: imports.summary.circularCount > 0 ? "var(--orange)" : "var(--green)",
          })
        : null,
      healthMetrics && zones
        ? h(StatTile, {
            glyph: "◉",
            label: "Avg cohesion", ...concernCard("cohesion"),
            value: healthMetrics.avgCohesion.toFixed(2),
            sub: "higher is better",
            tone: healthColor(healthMetrics.avgCohesion),
            meter: healthMetrics.avgCohesion,
            info: h(InfoTip, { term: "cohesion" }),
          })
        : null,
      healthMetrics && zones
        ? h(StatTile, {
            glyph: "⇄",
            label: "Avg coupling", ...concernCard("coupling"),
            value: healthMetrics.avgCoupling.toFixed(2),
            sub: "lower is better",
            tone: healthColor(1 - healthMetrics.avgCoupling),
            meter: healthMetrics.avgCoupling,
            info: h(InfoTip, { term: "coupling" }),
          })
        : null,
      ...extra,
      healthMetrics && (healthMetrics.patterns.length > 0 || healthMetrics.antipatterns.length > 0)
        ? h("div", { class: "overview-stat overview-stat--signals", role: "listitem" },
            h("span", { class: "overview-stat-label" }, "Signals"),
            h("div", { class: "pattern-list" },
              healthMetrics.patterns.map(p =>
                h(PatternBadge, { key: p, type: "pattern", label: p })
              ),
              healthMetrics.antipatterns.map(p =>
                h(PatternBadge, { key: p, type: "antipattern", label: p })
              ),
            ),
          )
        : null,
    );
}

function computeHealthMetrics(zones: LoadedData["zones"], imports: LoadedData["imports"]) {
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
}

// ── Codebase at a glance, opened ─────────────────────────────

/** Element ids the opened visuals tile's stat cards scroll to. */
export const HEALTH_ATTENTION_ID = "health-attention";
export const HEALTH_CYCLES_ID = "health-cycles";

interface HealthDetailProps {
  data: LoadedData;
  /** Show a zone or file in the detail panel beside the modal. */
  setDetail: (item: DetailItem) => void;
}

/**
 * What the opened visuals tile's health cards summarise: the zones needing
 * attention, the hub files and the import cycles, each zone and file opening
 * its detail.
 */
export function HealthDetail({ data, setDetail }: HealthDetailProps): ComponentChild {
  const { zones, imports, inventory } = data;
  const files = useMemo(() => new Map((inventory?.files ?? []).map((f) => [f.path, f])), [inventory]);
  const attention = useMemo(
    () => (zones?.zones ?? [])
      .filter(zoneNeedsAttention)
      .sort((a, b) => (a.cohesion - a.coupling) - (b.cohesion - b.coupling)),
    [zones],
  );
  const cycles = imports?.summary.circulars ?? [];
  const hubs = imports?.summary.mostImported.slice(0, 12) ?? [];

  const showFile = (path: string) => {
    const f = files.get(path);
    setDetail({
      type: "file", title: basename(path), path,
      language: f?.language, lines: f?.lineCount, role: f?.role, category: f?.category, hash: f?.hash,
    });
  };
  const fileButton = (path: string) =>
    h("button", { type: "button", class: "health-link health-file", onClick: () => showFile(path), title: path }, path);

  return h(Fragment, null,
    h("div", { class: "health-columns" },
      h("section", { class: "health-section", id: HEALTH_ATTENTION_ID, "aria-labelledby": "health-attention-title" },
        h("h3", { id: "health-attention-title" }, `Zones needing attention`, h("span", { class: "health-count" }, String(attention.length))),
        attention.length === 0
          ? h("p", { class: "stage-tile-empty" }, "Every zone holds together and keeps to itself.")
          : h("table", { class: "languages-table health-table" },
              h("thead", null, h("tr", null,
                h("th", null, "Zone"), h("th", { class: "num" }, "Files"),
                h("th", { class: "num" }, "Cohesion"), h("th", { class: "num" }, "Coupling"))),
              h("tbody", null, attention.map((z) => h("tr", { key: z.id },
                h("td", null, h("button", {
                  type: "button",
                  class: "health-link",
                  onClick: () => setDetail({
                    type: "zone", title: z.name, id: z.id, zoneId: z.id, description: z.description,
                    files: z.files.length, entryPoints: z.entryPoints,
                    cohesion: z.cohesion.toFixed(2), coupling: z.coupling.toFixed(2),
                  }),
                }, z.name)),
                h("td", { class: "num" }, z.files.length.toLocaleString()),
                h("td", { class: "num", style: `color: ${healthColor(z.cohesion)}` }, z.cohesion.toFixed(2)),
                h("td", { class: "num", style: `color: ${healthColor(1 - z.coupling)}` }, z.coupling.toFixed(2)),
              ))),
            ),
      ),
      h("section", { class: "health-section", "aria-labelledby": "health-hubs" },
        h("h3", { id: "health-hubs" }, "Hub files", h("span", { class: "health-count" }, String(hubs.length))),
        hubs.length === 0
          ? h("p", { class: "stage-tile-empty" }, "No file is imported widely.")
          : h("ol", { class: "health-list" }, hubs.map((hub) =>
              h("li", { key: hub.path }, fileButton(hub.path), h("span", { class: "health-meta" }, `${hub.count} importers`)))),
      ),
    ),
    h("section", { class: "health-section", id: HEALTH_CYCLES_ID, "aria-labelledby": "health-cycles-title" },
      h("h3", { id: "health-cycles-title" }, "Import cycles", h("span", { class: "health-count" }, String(imports?.summary.circularCount ?? 0))),
      cycles.length === 0
        ? h("p", { class: "stage-tile-empty" }, "No import cycles.")
        : h("ol", { class: "health-list health-cycles" }, cycles.slice(0, 50).map((c, i) =>
            h("li", { key: i },
              c.cycle.flatMap((path, j) => [j > 0 ? h("span", { class: "health-arrow", "aria-hidden": "true" }, " → ") : null, fileButton(path)]),
            ))),
      cycles.length > 50 ? h("p", { class: "health-meta" }, `+${cycles.length - 50} more`) : null,
    ),
  );
}

// ── Analysis status line ─────────────────────────────────────

/** Enrichment passes the full analysis runs; the meter fills toward this. */
const ENRICHMENT_PASSES = 4;

/**
 * Which analysis the page shows, in one quiet line: branch, commit, age, and
 * how far enrichment has got as a four-segment meter. A pass reset (zones
 * changed, so enrichment started over) is told in the meter's tooltip.
 */
export function AnalysisStatus({ data }: { data: LoadedData }): ComponentChild {
  const { manifest, zones } = data;
  if (!manifest) return h("span", null);
  const pass = zones?.enrichmentPass ?? 0;
  const filled = Math.min(pass, ENRICHMENT_PASSES);
  const meta = zones?.metaEvaluationCount ?? 0;
  const reset = zones?.lastReset;
  const meterTitle = [
    `Enrichment pass ${pass} of ${ENRICHMENT_PASSES}`,
    meta ? `${meta} meta-evaluation${meta === 1 ? "" : "s"}` : "",
    reset ? `Reset from pass ${reset.from} to ${reset.to} when the zones changed` : "",
  ].filter(Boolean).join(" · ");
  const ago = formatSince(manifest.analyzedAt);
  return h("p", { class: "analysis-status" },
    manifest.gitBranch
      ? h("span", { class: "analysis-status-branch" }, h(ActionIcon, { name: "branch", class: "action-icon-sm" }), manifest.gitBranch)
      : null,
    manifest.gitSha ? h("code", { class: "analysis-status-sha" }, manifest.gitSha.slice(0, 7)) : null,
    h("span", { title: new Date(manifest.analyzedAt).toLocaleString() }, `analyzed ${ago ?? new Date(manifest.analyzedAt).toLocaleString()}`),
    h("span", { class: "analysis-status-pass", title: meterTitle },
      h("span", { class: "analysis-meter", "aria-hidden": "true" },
        Array.from({ length: ENRICHMENT_PASSES }, (_, i) =>
          h("span", { key: i, class: `analysis-meter-seg${i < filled ? " analysis-meter-seg--on" : ""}` })),
      ),
      `Pass ${pass} of ${ENRICHMENT_PASSES}${meta ? ` + ${meta} meta` : ""}`,
      reset ? h("span", { class: "analysis-status-reset", "aria-hidden": "true" }, " ↺") : null,
    ),
  );
}
