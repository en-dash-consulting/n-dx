/**
 * The dashboard tile grid a stage page renders when its `StageDef` lists
 * `tiles` (stages.ts).
 *
 * The grid has twelve columns and rows of one fixed height; each tile spans
 * `cols` × `rows` of it, and dense packing fills the column beside a tall
 * tile, so the page is a set of aligned blocks rather than a stack of cards
 * of whatever height their content happened to be.
 *
 * A tile has two modes. Closed, it shows its summary — `renderSummary(tile)`,
 * else its panel, else its view cut to the tile. Open (its header is the one
 * control), it is a modal over the page: inset from the edges on a dimmed
 * backdrop, holding the whole view with the tile's tabs, headed by a back
 * trail "← Stage / Tile". The backdrop, the trail's stage, Esc and the close
 * button all close it and return focus to the tile. It stops short of the
 * detail panel when one is open, so the two sit side by side. A chromeless tile (the codebase map) is its panel alone: the panel
 * brings its own header, controls and full-screen.
 *
 * Views render through `renderView` and panels through `renderPanel`, both
 * passed in by the registry — nothing is re-implemented here, and this module
 * stays out of a cycle with view-registry.ts.
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { ViewId } from "../types.js";
import { viewLabel, viewBlurb, viewGlyph, type StageId, type StageTile, type StagePanelId, type StageTab } from "./stages.js";
import { ActionIcon } from "../components/index.js";

/** A stage panel; `opened` is true in the opened tile, false in the tile itself. */
export type RenderPanel = (panel: StagePanelId, opened: boolean) => ComponentChild;
/** A tile's summary, or null to show its panel or its view cut to the tile. */
export type RenderSummary = (tile: StageTile) => ComponentChild | null;

/** Key of a tile: its panel, else its view. */
export function tileKey(tile: StageTile): string {
  return tile.panel ?? tile.view;
}

export function tileTitle(tile: StageTile): string {
  return tile.title ?? viewLabel(tile.view);
}

// ── Full content ───────────────────────────────────────────────

interface TileContentProps {
  tile: StageTile;
  /** In the opened tile (the modal), as opposed to the tile's own preview. */
  opened: boolean;
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

/** A tile's whole content: its panel, or its view with the tile's tabs. */
function TileContent({ tile, opened, tabs, renderView, renderPanel, idBase }: TileContentProps) {
  const [active, setActive] = useState<ViewId>(tile.view);
  if (tile.panel) return h("div", { class: "stage-tile-content" }, renderPanel(tile.panel, opened));
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

interface FullScreenProps extends TileContentProps {
  stage: StageId;
  onClose: () => void;
  besideDetail: boolean;
}

function FullScreenTile({ stage, tile, onClose, besideDetail, ...content }: FullScreenProps) {
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
  const stageName = viewLabel(stage);
  return h("div", {
    class: `stage-tile-fullscreen${besideDetail ? " stage-tile-fullscreen--beside-detail" : ""}`,
    // A click on the backdrop itself, not one that bubbled up from the modal.
    onClick: (e: MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
  },
    h("div", { class: "stage-tile-modal", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "stage-tile-fullscreen-head" },
        h("nav", { class: "stage-tile-trail", "aria-label": "Back" },
          h("button", {
            type: "button",
            class: "stage-tile-trail-back",
            onClick: onClose,
            title: `Back to ${stageName}`,
          }, h("span", { "aria-hidden": "true" }, "← "), stageName),
          h("span", { class: "stage-tile-trail-sep", "aria-hidden": "true" }, "/"),
          h("span", { class: "stage-tile-glyph", "aria-hidden": "true" }, viewGlyph(tile.view)),
          h("h2", { class: "stage-tile-fullscreen-title", "aria-current": "page" }, title),
        ),
        h("button", {
          ref: closeRef,
          type: "button",
          class: "stage-tile-btn stage-tile-icon-btn",
          onClick: onClose,
          "aria-label": `Close ${title}`,
          title: "Close (Esc)",
        }, h(ActionIcon, { name: "close" })),
      ),
      h("div", { class: "stage-tile-fullscreen-body" }, h(TileContent, { tile, ...content })),
    ),
  );
}

// ── Tile ───────────────────────────────────────────────────────

interface TileProps {
  stage: StageId;
  tile: StageTile;
  onOpen: (opener: HTMLElement) => void;
  renderView: (view: ViewId) => ComponentChild;
  renderPanel: RenderPanel;
  renderSummary: RenderSummary;
}

function Tile({ stage, tile, onOpen, renderView, renderPanel, renderSummary }: TileProps) {
  const key = tileKey(tile);
  const idBase = `stage-tile-${stage}-${key}`;
  const title = tileTitle(tile);
  const span = `stage-tile--c${tile.cols ?? 4} stage-tile--r${tile.rows ?? 1}`;

  if (tile.chromeless && tile.panel) {
    return h("section", { class: `stage-tile stage-tile--chromeless ${span}`, "data-tile": key, "aria-label": title },
      renderPanel(tile.panel, false),
    );
  }

  const summary = renderSummary(tile);
  return h("section", { class: `stage-tile ${span}`, "data-tile": key, "aria-labelledby": `${idBase}-title` },
    h("button", {
      type: "button",
      class: "stage-tile-head",
      onClick: (e: Event) => onOpen(e.currentTarget as HTMLElement),
      "aria-haspopup": "dialog",
      "aria-label": `Open ${title}`,
    },
      h("span", { class: "stage-tile-glyph", "aria-hidden": "true" }, viewGlyph(tile.view)),
      h("span", { class: "stage-tile-title", id: `${idBase}-title` }, title),
      tile.panel ? null : h("span", { class: "stage-tile-blurb" }, viewBlurb(tile.view)),
      h("span", { class: "stage-tile-open", "aria-hidden": "true" }, h(ActionIcon, { name: "expand" })),
    ),
    h("div", { class: `stage-tile-body${summary === null && !tile.panel ? " stage-tile-body--view" : ""}` },
      summary !== null
        ? summary
        // A preview: the tile's own view only; its tabs are for full-screen.
        : h(TileContent, { tile, opened: false, tabs: [], renderView, renderPanel, idBase }),
    ),
  );
}

// ── Grid ───────────────────────────────────────────────────────

export interface TileGridProps {
  stage: StageId;
  tiles: readonly StageTile[];
  /** Tabs each tile may show, already filtered to the views this build can render. */
  tabsOf: (tile: StageTile) => readonly StageTab[];
  renderView: (view: ViewId) => ComponentChild;
  renderPanel: RenderPanel;
  renderSummary: RenderSummary;
  /** The detail panel is open beside the page; full-screen leaves room for it. */
  besideDetail?: boolean;
}

export function TileGrid({ stage, tiles, tabsOf, renderView, renderPanel, renderSummary, besideDetail = false }: TileGridProps) {
  const [fullScreen, setFullScreen] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const closeFullScreen = useCallback(() => {
    setFullScreen(null);
    // Return focus to the tile that opened it.
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
        onOpen: (opener: HTMLElement) => { openerRef.current = opener; setFullScreen(key); },
        renderView,
        renderPanel,
        renderSummary,
      });
    }),
    full
      ? h(FullScreenTile, {
          stage,
          tile: full,
          opened: true,
          tabs: tabsOf(full),
          renderView,
          renderPanel,
          idBase: `stage-tile-${stage}-${tileKey(full)}-full`,
          onClose: closeFullScreen,
          besideDetail,
        })
      : null,
  );
}
