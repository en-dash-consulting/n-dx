/**
 * A stage page's side panels: a column of vertical tabs down the page's right
 * edge, each sliding a panel in over the page (`StageDef.sidePanels`). Plan's
 * New change, From analysis and Inbox live here, as do the parts of a page the
 * new layout has no place for yet, kept under a divider rather than removed.
 *
 * The tab column is in the page's own flow (a sticky column beside it), so it
 * stays inside the main column: clear of the stage links, which sit in the
 * padding the main column reserves, and of the Sidecar drawer, which narrows
 * it. The tabs are disclosure buttons (`aria-expanded`), not a tablist.
 *
 * The stage page owns which panel is open, so its head action ("Add to the
 * plan") can open one. The open panel is a modal dialog over a scrim: focus
 * stays inside it, and Escape, the close button or the scrim shut it and
 * return focus to what opened it.
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

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** The control that opened the panel, focused again when it closes. */
  const openerRef = useRef<HTMLElement | null>(null);
  /** Set while closing, so the focus trap lets focus go back to the opener. */
  const closingRef = useRef(false);

  const close = () => {
    closingRef.current = true;
    onToggle(null);
    openerRef.current?.focus({ preventScroll: true });
    openerRef.current = null;
  };
  useEscapeKey(open !== null, close);

  // Move focus into the panel as it opens, or switches to another panel.
  useEffect(() => {
    if (!open) return;
    if (!openerRef.current && document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
    headingRef.current?.focus({ preventScroll: true });
  }, [open?.id]);

  // While open, focus stays in the panel: focus that lands elsewhere is
  // brought back, unless it went into another dialog (one the panel opened).
  useEffect(() => {
    if (!open) return undefined;
    closingRef.current = false;
    const onFocusIn = (e: FocusEvent) => {
      if (closingRef.current) return;
      const target = e.target as Node | null;
      const panel = panelRef.current;
      if (!panel || !target || panel.contains(target)) return;
      if (target instanceof Element && target.closest('[role="dialog"], [aria-modal="true"]')) return;
      headingRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open?.id]);

  /** Tab from the last control wraps to the first, and Shift+Tab the other way. */
  const trapTab = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === headingRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  if (shown.length === 0) return null;
  const panelId = `stage-side-panel-${stage}`;
  const tab = (p: StageSidePanel) => {
    const expanded = p.id === open?.id;
    return h("button", {
      key: p.id,
      type: "button",
      class: expanded ? "stage-side-tab stage-side-tab--active" : "stage-side-tab",
      "data-panel": p.id,
      "aria-expanded": String(expanded),
      "aria-controls": expanded ? panelId : undefined,
      onClick: (e: Event) => {
        if (expanded) { close(); return; }
        openerRef.current = e.currentTarget as HTMLElement;
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
    h("div", { class: "stage-side-tabs", role: "group", "aria-label": "Side panels", "data-stage": stage },
      named.map(tab),
      named.length > 0 && transitional.length > 0 ? h("span", { class: "stage-side-divider", "aria-hidden": "true" }) : null,
      transitional.map(tab),
    ),
    open ? h("div", { class: "stage-side-scrim", onClick: close, "aria-hidden": "true" }) : null,
    open
      ? h("aside", {
          class: "stage-side-panel",
          id: panelId,
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": `${panelId}-title`,
          "data-panel": open.id,
          ref: panelRef,
          onKeyDown: trapTab,
        },
          h("div", { class: "stage-side-head" },
            h("div", { class: "stage-side-titles" },
              h("h2", { class: "stage-side-title", id: `${panelId}-title`, tabIndex: -1, ref: headingRef }, open.title),
              h("p", { class: "stage-side-blurb" }, open.blurb),
            ),
            h("button", {
              type: "button",
              class: "stage-side-open",
              onClick: () => { closingRef.current = true; onToggle(null); openerRef.current = null; navigateTo(open.view); },
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
          // Keyed by panel, so switching panels mounts the next one afresh.
          h("div", { class: "stage-side-body", key: open.id }, renderPanel(open)),
        )
      : null,
  );
}
