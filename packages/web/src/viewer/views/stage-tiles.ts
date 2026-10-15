/**
 * The dashboard tile grid a stage page renders when its `StageDef` lists
 * `tiles` (stages.ts).
 *
 * A chromeless tile (the codebase map) is its panel alone: the panel brings
 * its own header, controls and full-screen. Every other tile has three sizes
 * of attention:
 *  - **collapsed** — a cell (or a full row, for `hero`/`wide`) showing its
 *    summary: `renderSummary(tile)`, or the view itself clipped to the tile
 *    when no summary exists;
 *  - **expanded** — the same tile across the full grid width, rendering the
 *    real view (remembered per tile, like the stacked sections' open state);
 *  - **full-screen** — the view over the page, closed with Esc or the close
 *    button, with `renderAside` beside it when the caller has something to
 *    show there (the open PRD item).
 *
 * Views render through `renderView` and panels through `renderPanel`, both
 * passed in by the registry — nothing is re-implemented here, and this module
 * stays out of a cycle with view-registry.ts.
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { ViewId, NavigateTo } from "../types.js";
import { viewLabel, viewBlurb, viewGlyph, type StageId, type StageTile, type StagePanelId, type StageTab } from "./stages.js";
import { ActionIcon } from "../components/index.js";

export type RenderPanel = (panel: StagePanelId) => ComponentChild;
/** A tile's collapsed summary, or null to show the view itself, clipped. */
export type RenderSummary = (tile: StageTile) => ComponentChild | null;

/** Storage key and React key of a tile: its panel, else its view. */
export function tileKey(tile: StageTile): string {
  return tile.panel ?? tile.view;
}

export function tileTitle(tile: StageTile): string {
  return tile.title ?? viewLabel(tile.view);
}

// ── Remembered expansion ───────────────────────────────────────

const EXPANDED_KEY = "ndx.stage-tiles";

function readExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeExpanded(key: string, expanded: boolean): void {
  try {
    const all = readExpanded();
    if (expanded) all[key] = true;
    else delete all[key];
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(all));
  } catch { /* storage unavailable — state lasts for this page */ }
}

// ── Tile body ──────────────────────────────────────────────────

interface TileBodyProps {
  tile: StageTile;
  tabs: readonly StageTab[];
  renderView: (view: ViewId) => ComponentChild;
  renderPanel: RenderPanel;
  idBase: string;
}

/** Move the active tab with the arrow keys — the roving-tabindex tablist pattern. */
function tabListKeyDown(e: KeyboardEvent, tabs: readonly StageTab[], activeIndex: number, activate: (view: ViewId) => void): void {
  let next: number | null = null;
  if (e.key === "ArrowRight") next = (activeIndex + 1) % tabs.length;
  else if (e.key === "ArrowLeft") next = (activeIndex - 1 + tabs.length) % tabs.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = tabs.length - 1;
  if (next === null || next === activeIndex) return;
  e.preventDefault();
  const view = tabs[next]!.view;
  activate(view);
  const list = (e.currentTarget as HTMLElement).closest(".stage-tile-tablist");
  list?.querySelector<HTMLButtonElement>(`[data-tab="${view}"]`)?.focus();
}

/** A tile's full content: its panel, or its view with the tile's tabs. */
function TileContent({ tile, tabs, renderView, renderPanel, idBase }: TileBodyProps) {
  const [active, setActive] = useState<ViewId>(tile.view);
  if (tile.panel) return h("div", { class: "stage-tile-content" }, renderPanel(tile.panel));
  const shown = tabs.some((t) => t.view === active) ? active : tile.view;
  return h("div", { class: "stage-tile-content" },
    tabs.length > 1
      ? h("div", { class: "stage-section-tablist stage-tile-tablist", role: "tablist", "aria-label": `${tileTitle(tile)} views` },
          tabs.map((t, i) => {
            const selected = t.view === shown;
            return h("button", {
              key: t.view,
              type: "button",
              role: "tab",
              id: `${idBase}-tab-${t.view}`,
              "data-tab": t.view,
              class: `stage-section-tab${selected ? " active" : ""}`,
              "aria-selected": String(selected),
              "aria-controls": `${idBase}-panel`,
              tabIndex: selected ? 0 : -1,
              onClick: () => setActive(t.view),
              onKeyDown: (e: KeyboardEvent) => tabListKeyDown(e, tabs, i, setActive),
            }, viewLabel(t.view));
          }),
        )
      : null,
    h("div", tabs.length > 1 ? { id: `${idBase}-panel`, role: "tabpanel", "aria-labelledby": `${idBase}-tab-${shown}` } : {},
      renderView(shown),
    ),
  );
}

// ── Full-screen layer ──────────────────────────────────────────

interface FullScreenProps extends TileBodyProps {
  onClose: () => void;
  aside: ComponentChild | null;
  navigateTo: NavigateTo;
}

function FullScreenTile({ tile, onClose, aside, navigateTo, ...body }: FullScreenProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = tileTitle(tile);
  return h("div", {
    class: `stage-tile-fullscreen${aside ? " stage-tile-fullscreen--split" : ""}`,
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title,
  },
    h("div", { class: "stage-tile-fullscreen-main" },
      h("div", { class: "stage-tile-head" },
        h("span", { class: "stage-tile-glyph", "aria-hidden": "true" }, viewGlyph(tile.view)),
        h("h2", { class: "stage-tile-title" }, title),
        h("span", { class: "stage-tile-actions" },
          h("button", {
            type: "button",
            class: "stage-tile-btn",
            onClick: () => { onClose(); navigateTo(tile.view); },
            "aria-label": `Open ${viewLabel(tile.view)} on its own page`,
            title: `Open ${viewLabel(tile.view)} on its own page`,
          }, "Open ↗"),
          h("button", {
            ref: closeRef,
            type: "button",
            class: "stage-tile-btn stage-tile-icon-btn",
            onClick: onClose,
            "aria-label": `Close full-screen ${title}`,
            title: "Close (Esc)",
          }, h(ActionIcon, { name: "close" })),
        ),
      ),
      h("div", { class: "stage-tile-fullscreen-body" }, h(TileContent, { tile, ...body })),
    ),
    aside ? h("aside", { class: "stage-tile-fullscreen-aside", "aria-label": "Selected item" }, aside) : null,
  );
}

// ── Tile ───────────────────────────────────────────────────────

interface TileProps {
  stage: StageId;
  tile: StageTile;
  tabs: readonly StageTab[];
  expanded: boolean;
  onToggle: () => void;
  onFullScreen: (opener: HTMLElement) => void;
  navigateTo: NavigateTo;
  renderView: (view: ViewId) => ComponentChild;
  renderPanel: RenderPanel;
  renderSummary: RenderSummary;
}

function Tile({ stage, tile, tabs, expanded, onToggle, onFullScreen, navigateTo, renderView, renderPanel, renderSummary }: TileProps) {
  const key = tileKey(tile);
  const idBase = `stage-tile-${stage}-${key}`;
  const title = tileTitle(tile);
  const summary = expanded ? null : renderSummary(tile);
  const size = expanded ? "expanded" : (tile.size ?? "normal");

  if (tile.chromeless && tile.panel) {
    return h("section", { class: `stage-tile stage-tile--${tile.size ?? "normal"} stage-tile--chromeless`, "data-tile": key, "aria-label": title },
      renderPanel(tile.panel),
    );
  }

  return h("section", {
    class: `stage-tile stage-tile--${size}`,
    "data-tile": key,
    "aria-labelledby": `${idBase}-title`,
  },
    h("div", { class: "stage-tile-head" },
      h("button", {
        type: "button",
        class: "stage-tile-toggle",
        onClick: onToggle,
        "aria-expanded": String(expanded),
        "aria-controls": `${idBase}-body`,
        title: expanded ? `Collapse ${title}` : `Expand ${title}`,
      },
        h("span", { class: "stage-tile-glyph", "aria-hidden": "true" }, viewGlyph(tile.view)),
        h("span", { class: "stage-tile-title", id: `${idBase}-title` }, title),
        tile.panel ? null : h("span", { class: "stage-tile-blurb" }, viewBlurb(tile.view)),
      ),
      h("span", { class: "stage-tile-actions" },
        h("button", {
          type: "button",
          class: "stage-tile-btn stage-tile-icon-btn",
          onClick: (e: Event) => onFullScreen(e.currentTarget as HTMLElement),
          "aria-label": `Open ${title} full-screen`,
          title: "Full-screen",
        }, h(ActionIcon, { name: "expand" })),
        h("button", {
          type: "button",
          class: "stage-tile-btn",
          onClick: () => navigateTo(tile.view),
          "aria-label": `Open ${viewLabel(tile.view)} on its own page`,
          title: `Open ${viewLabel(tile.view)} on its own page`,
        }, "Open ↗"),
      ),
    ),
    h("div", {
      class: `stage-tile-body${!expanded && summary === null && tile.size !== "hero" ? " stage-tile-body--clip" : ""}`,
      id: `${idBase}-body`,
    },
      summary !== null
        ? h("div", { class: "stage-tile-summary" }, summary)
        : h(TileContent, { tile, tabs, renderView, renderPanel, idBase }),
    ),
  );
}

// ── Grid ───────────────────────────────────────────────────────

export interface TileGridProps {
  stage: StageId;
  tiles: readonly StageTile[];
  /** Tabs each tile may show, already filtered to the views this build can render. */
  tabsOf: (tile: StageTile) => readonly StageTab[];
  navigateTo: NavigateTo;
  renderView: (view: ViewId) => ComponentChild;
  renderPanel: RenderPanel;
  renderSummary: RenderSummary;
  /** Shown beside a full-screen tile when non-null (the open PRD item). */
  renderAside?: () => ComponentChild | null;
}

export function TileGrid({ stage, tiles, tabsOf, navigateTo, renderView, renderPanel, renderSummary, renderAside }: TileGridProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => readExpanded());
  const [fullScreen, setFullScreen] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const toggle = (key: string) => {
    const storageKey = `${stage}:${key}`;
    const next = !expanded[storageKey];
    setExpanded((prev) => ({ ...prev, [storageKey]: next }));
    writeExpanded(storageKey, next);
  };

  const closeFullScreen = useCallback(() => {
    setFullScreen(null);
    // Return focus to the control that opened it.
    openerRef.current?.focus();
  }, []);

  const full = fullScreen ? tiles.find((t) => tileKey(t) === fullScreen) : undefined;

  return h("div", { class: "stage-tiles", "data-stage": stage },
    tiles.map((tile) => {
      const key = tileKey(tile);
      return h(Tile, {
        key,
        stage,
        tile,
        tabs: tabsOf(tile),
        expanded: !!expanded[`${stage}:${key}`],
        onToggle: () => toggle(key),
        onFullScreen: (opener: HTMLElement) => { openerRef.current = opener; setFullScreen(key); },
        navigateTo,
        renderView,
        renderPanel,
        renderSummary,
      });
    }),
    full
      ? h(FullScreenTile, {
          tile: full,
          tabs: tabsOf(full),
          renderView,
          renderPanel,
          idBase: `stage-tile-${stage}-${tileKey(full)}-full`,
          onClose: closeFullScreen,
          aside: renderAside?.() ?? null,
          navigateTo,
        })
      : null,
  );
}
