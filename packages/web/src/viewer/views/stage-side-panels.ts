/**
 * A stage page's side panels: a column of vertical tabs at the page's right
 * edge, each sliding a panel in over the page (`StageDef.sidePanels`). Plan's
 * New change, From analysis and Inbox live here, as do the parts of a page the
 * new layout has no place for yet, kept under a divider rather than removed.
 *
 * The stage page owns which panel is open, so its head action ("Add to the
 * plan") can open one. The panel is a non-modal dialog: Escape or the close
 * button shuts it and returns focus to the tab that opened it, and the scrim
 * behind it closes it on a click.
 *
 * @module viewer/views/stage-side-panels
 */

import { h, Fragment } from "preact";
import type { ComponentChild } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { NavigateTo } from "../types.js";
import { ActionIcon, useEscapeKey, useProjectStatus } from "../components/index.js";
import { LiveBadge } from "./stage-badge.js";
import type { StageId, StageSidePanel } from "./stages.js";

export type RenderSidePanel = (panel: StageSidePanel) => ComponentChild;

/**
 * The panels a project of this layout shows: a v2-only panel waits until the
 * layout is known and stays hidden on a v1 project or one with no PRD.
 */
export function sidePanelsForLayout(panels: readonly StageSidePanel[], layout: "v1" | "v2" | "none" | null): StageSidePanel[] {
  return panels.filter((p) => !p.v2Only || layout === "v2");
}

export interface StageSidePanelsProps {
  stage: StageId;
  /** Already filtered to this viewer's views and to the server's presence. */
  panels: readonly StageSidePanel[];
  /** The open panel's id; null when every panel is closed. */
  openId: string | null;
  onToggle: (id: string | null) => void;
  renderPanel: RenderSidePanel;
  navigateTo: NavigateTo;
}

export function StageSidePanels({ stage, panels, openId, onToggle, renderPanel, navigateTo }: StageSidePanelsProps) {
  const status = useProjectStatus();
  const layout = status ? (status.rex?.exists === false ? "none" : status.rex?.layout ?? "v2") : null;
  const shown = sidePanelsForLayout(panels, layout);
  const open = shown.find((p) => p.id === openId) ?? null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** The control that opened the panel, focused again when it closes. */
  const openerRef = useRef<HTMLElement | null>(null);

  const close = () => {
    onToggle(null);
    openerRef.current?.focus({ preventScroll: true });
  };
  useEscapeKey(open !== null, close);

  // Move focus into the panel as it opens, or switches to another panel.
  useEffect(() => {
    if (!open) return;
    if (!openerRef.current && document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
    headingRef.current?.focus({ preventScroll: true });
  }, [open?.id]);

  if (shown.length === 0) return null;
  const panelId = `stage-side-panel-${stage}`;
  const tab = (p: StageSidePanel) => {
    const selected = p.id === open?.id;
    return h("button", {
      key: p.id,
      type: "button",
      role: "tab",
      class: selected ? "stage-side-tab stage-side-tab--active" : "stage-side-tab",
      "data-panel": p.id,
      "aria-selected": String(selected),
      "aria-controls": selected ? panelId : undefined,
      onClick: (e: Event) => {
        if (selected) { close(); return; }
        if (!open) openerRef.current = e.currentTarget as HTMLElement;
        onToggle(p.id);
      },
    },
      h("span", { class: "stage-side-tab-label" }, p.label),
      p.badge ? h(LiveBadge, { badge: p.badge }) : null,
    );
  };
  const named = shown.filter((p) => !p.transitional);
  const transitional = shown.filter((p) => p.transitional);

  return h(Fragment, null,
    open ? h("div", { class: "stage-side-scrim", onClick: close, "aria-hidden": "true" }) : null,
    h("div", { class: open ? "stage-side stage-side--open" : "stage-side", "data-stage": stage },
      h("div", { class: "stage-side-tabs", role: "tablist", "aria-orientation": "vertical", "aria-label": "Side panels" },
        named.map(tab),
        named.length > 0 && transitional.length > 0 ? h("span", { class: "stage-side-divider", role: "separator", "aria-hidden": "true" }) : null,
        transitional.map(tab),
      ),
      open
        ? h("aside", {
            class: "stage-side-panel",
            id: panelId,
            role: "dialog",
            "aria-labelledby": `${panelId}-title`,
            "data-panel": open.id,
          },
            h("div", { class: "stage-side-head" },
              h("div", { class: "stage-side-titles" },
                h("h2", { class: "stage-side-title", id: `${panelId}-title`, tabIndex: -1, ref: headingRef }, open.title),
                h("p", { class: "stage-side-blurb" }, open.blurb),
              ),
              h("button", {
                type: "button",
                class: "stage-side-open",
                onClick: () => { onToggle(null); navigateTo(open.view); },
                "aria-label": `Open ${open.title} on its own page`,
                title: `Open ${open.title} on its own page`,
              }, "Open ↗"),
              h("button", {
                type: "button",
                class: "stage-side-close",
                onClick: close,
                "aria-label": `Close ${open.title}`,
                title: "Close (Esc)",
              }, h(ActionIcon, { name: "close" })),
            ),
            // Keyed by panel, so switching tabs mounts the next panel afresh.
            h("div", { class: "stage-side-body", key: open.id }, renderPanel(open)),
          )
        : null,
    ),
  );
}
