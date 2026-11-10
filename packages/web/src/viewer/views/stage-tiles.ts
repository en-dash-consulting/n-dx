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
 * detail panel when one is open, so the two sit side by side. A panel may open
 * its tile at a focus (`TileFocus`: an area of Plan's product map); the trail
 * then reads "← Stage / Tile / Focus", and the tile step drops the focus.
 * A chromeless tile (the codebase map) is its panel alone: the panel
 * brings its own header, controls and full-screen.
 *
 * Views render through `renderView` and panels through `renderPanel`, both
 * passed in by the registry — nothing is re-implemented here, and this module
 * stays out of a cycle with view-registry.ts.
 */

import { h, Fragment } from "preact";
import type { ComponentChild } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { NavigateTo, ViewId } from "../types.js";
import { viewLabel, viewBlurb, viewGlyph, type StageId, type StageTile, type StagePanelId, type StageTab } from "./stages.js";
import { ActionIcon } from "../components/index.js";
import { useCliName, resolveCliLabel } from "../hooks/index.js";
import { LiveBadge } from "./stage-badge.js";

/**
 * A thing inside a tile the modal opens at (an area of Plan's product map),
 * named as the trail's last step.
 */
export interface TileFocus {
  id: string;
  label: string;
}

/** What a panel can ask of the grid. */
export interface TileGridApi {
  /** Open (or switch the modal to) a tile by key, optionally at a focus inside it. */
  openTile: (key: string, focus?: TileFocus) => void;
  /** The focus the open tile was opened at; null for the tile as a whole. */
  focus: TileFocus | null;
}

/** A stage panel; `opened` is true in the opened tile, false in the tile itself. */
export type RenderPanel = (panel: StagePanelId, opened: boolean, grid: TileGridApi) => ComponentChild;
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
  grid: TileGridApi;
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
function TileContent({ grid, tile, opened, tabs, renderView, renderPanel, idBase }: TileContentProps) {
  const [active, setActive] = useState<ViewId>(tile.view);
  // An opened panel tile that lists tabs (Open changes: List, Tree) shows them.
  if (tile.panel && !(opened && tile.tabs?.length)) return h("div", { class: "stage-tile-content" }, renderPanel(tile.panel, opened, grid));
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
            }, t.label ?? viewLabel(t.view));
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
  navigateTo?: NavigateTo;
}

function FullScreenTile({ stage, tile, onClose, besideDetail, navigateTo, ...content }: FullScreenProps) {
  const focus = content.grid.focus;
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
    h("div", { class: "stage-tile-modal", role: "dialog", "aria-modal": "true", "aria-label": focus?.label ?? title },
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
          focus
            // Opened at a focus: the tile is a step back, the focus is the page.
            ? h(Fragment, null,
                h("button", {
                  type: "button",
                  class: "stage-tile-trail-back stage-tile-trail-tile",
                  onClick: () => content.grid.openTile(tileKey(tile)),
                  title: `Back to ${title}`,
                }, title),
                h("span", { class: "stage-tile-trail-sep", "aria-hidden": "true" }, "/"),
                h("h2", { class: "stage-tile-fullscreen-title", "aria-current": "page" }, focus.label),
              )
            : h("h2", { class: "stage-tile-fullscreen-title", "aria-current": "page" }, title),
        ),
        navigateTo
          ? h("button", {
              type: "button",
              class: "stage-tile-btn stage-tile-open-page",
              onClick: () => navigateTo(tile.view),
              title: `Open ${title} on its own page`,
            }, "Open ↗")
          : null,
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

/**
 * Whether an element's content is taller than the element. Rechecked when the
 * element resizes and when its content changes (a view that loads after
 * mounting grows without resizing its tile).
 */
export function useOverflowing(ref: { current: HTMLElement | null }): boolean {
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setOverflowing(el.scrollHeight > el.clientHeight + 4));
    };
    check();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    resize?.observe(el);
    const mutation = typeof MutationObserver === "undefined" ? null : new MutationObserver(check);
    mutation?.observe(el, { childList: true, subtree: true });
    return () => { cancelAnimationFrame(frame); resize?.disconnect(); mutation?.disconnect(); };
  }, [ref]);
  return overflowing;
}

interface TileProps {
  grid: TileGridApi;
  stage: StageId;
  tile: StageTile;
  onOpen: (opener: HTMLElement) => void;
  renderView: (view: ViewId) => ComponentChild;
  renderPanel: RenderPanel;
  renderSummary: RenderSummary;
}

function Tile({ grid, stage, tile, onOpen, renderView, renderPanel, renderSummary }: TileProps) {
  const key = tileKey(tile);
  const idBase = `stage-tile-${stage}-${key}`;
  const title = tileTitle(tile);
  const span = `stage-tile--c${tile.cols ?? 4} stage-tile--r${tile.rows ?? 1}`;
  // Called before the chromeless return so the hook order never depends on the tile.
  const cliName = useCliName();
  const bodyRef = useRef<HTMLDivElement>(null);
  const overflowing = useOverflowing(bodyRef);

  if (tile.band && tile.panel) {
    return h("section", { class: "stage-band", "data-tile": key, "aria-label": title },
      renderPanel(tile.panel, false, grid),
    );
  }

  if (tile.chromeless && tile.panel) {
    return h("section", { class: `stage-tile stage-tile--chromeless ${span}`, "data-tile": key, "aria-label": title },
      renderPanel(tile.panel, false, grid),
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
      // aria-label replaces the button's content, so the count is named here.
      "aria-describedby": tile.badge ? `${idBase}-badge` : undefined,
    },
      h("span", { class: "stage-tile-glyph", "aria-hidden": "true" }, viewGlyph(tile.view)),
      h("span", { class: "stage-tile-title", id: `${idBase}-title` }, title),
      tile.badge ? h(LiveBadge, { badge: tile.badge, id: `${idBase}-badge` }) : null,
      tile.panel ? null : h("span", { class: "stage-tile-blurb" }, resolveCliLabel(viewBlurb(tile.view), cliName)),
      h("span", { class: "stage-tile-open", "aria-hidden": "true" }, h(ActionIcon, { name: "expand" })),
    ),
    h("div", { class: `stage-tile-body${summary === null && !tile.panel ? " stage-tile-body--view" : ""}`, ref: bodyRef },
      summary !== null
        ? summary
        // A preview: the tile's own view only; its tabs are for full-screen.
        : h(TileContent, { grid, tile, opened: false, tabs: [], renderView, renderPanel, idBase }),
    ),
    // More than the tile shows: say so over the fade, and open the whole view from there.
    overflowing
      ? h("button", {
          type: "button",
          class: "stage-tile-more",
          onClick: (e: Event) => onOpen(e.currentTarget as HTMLElement),
          "aria-label": `Open ${title} to see everything`,
        }, "Open to see all ", h(ActionIcon, { name: "expand" }))
      : null,
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
  /** Gives each full-screen tile an Open ↗ to its own page. */
  navigateTo?: NavigateTo;
}

export function TileGrid({ stage, tiles, tabsOf, renderView, renderPanel, renderSummary, besideDetail = false, navigateTo }: TileGridProps) {
  const [fullScreen, setFullScreen] = useState<{ key: string; focus: TileFocus | null } | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const closeFullScreen = useCallback(() => {
    setFullScreen(null);
    // Return focus to what opened it, leaving the page where it was scrolled.
    openerRef.current?.focus({ preventScroll: true });
  }, []);

  const full = fullScreen ? tiles.find((t) => tileKey(t) === fullScreen.key) : undefined;
  const grid: TileGridApi = {
    openTile: (key, focus) => {
      if (!tiles.some((t) => tileKey(t) === key)) return;
      // Switching tiles from inside the modal keeps the original opener, so
      // closing still returns focus to where the reader started. Opened from a
      // panel (an area block), the opener is the control that was pressed.
      if (!fullScreen) openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setFullScreen({ key, focus: focus ?? null });
    },
    focus: fullScreen?.focus ?? null,
  };

  // Bands sit above the grid: its rows are one fixed height, a strip is not.
  const tileOf = (tile: StageTile) => {
    const key = tileKey(tile);
    return h(Tile, {
      key,
      grid,
      stage,
      tile,
      onOpen: (opener: HTMLElement) => { openerRef.current = opener; setFullScreen({ key, focus: null }); },
      renderView,
      renderPanel,
      renderSummary,
    });
  };
  const bands = tiles.filter((t) => t.band);

  return h(Fragment, null,
    bands.length > 0 ? h("div", { class: "stage-bands" }, bands.map(tileOf)) : null,
    h("div", { class: "stage-tiles", "data-stage": stage },
    tiles.filter((t) => !t.band).map(tileOf),
    full
      ? h(FullScreenTile, {
          // Keyed by tile and focus, so switching either remounts the content (tabs reset).
          key: `${tileKey(full)}:${fullScreen?.focus?.id ?? ""}`,
          grid,
          stage,
          tile: full,
          opened: true,
          tabs: tabsOf(full),
          renderView,
          renderPanel,
          idBase: `stage-tile-${stage}-${tileKey(full)}-full`,
          onClose: closeFullScreen,
          besideDetail,
          navigateTo,
        })
      : null,
    ),
  );
}
