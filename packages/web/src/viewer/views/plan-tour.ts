/**
 * Plan's head controls and its newcomer tour.
 *
 * Solo / Team switches how Plan reads (`plan-view-state.ts`): Solo names
 * nobody — no assignees on the cards, areas or Inbox, and no For me /
 * Everyone, since all the work is yours. The choice is remembered per browser.
 *
 * "Take the tour" walks a newcomer through the page in four steps, each
 * spotlighting its part (the glance cards, How work moves, the Inbox tab, the
 * product areas) with a card that says what it is for; the last step names
 * the Inbox button the current mode shows. Skip, Back, Next and
 * Done move through it; Escape closes it. A step whose part is not on screen
 * (Preparation, a v1 project) shows its card in the middle with no spotlight.
 *
 * @module viewer/views/plan-tour
 */

import { h, Fragment } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useEscapeKey } from "../components/index.js";
import { setPlanView, usePlanView } from "./plan-view-state.js";

export interface TourStep {
  /** A selector for the part the step spotlights. */
  target: string;
  title: string;
  body: string;
  /** The body in Solo, when it differs: the Inbox button reads "Plan in" there, "Accept →" in Team. */
  soloBody?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: ".plan-glance",
    title: "Start here every day",
    body: "These three cards answer the questions this page exists for: what you're working on, what matters most right now, and what's next for the product. They update on their own.",
  },
  {
    target: ".plan-flow",
    title: "Focus the page",
    body: "Work moves from the Inbox through Proposed, Ready and In progress to Awaiting apply. Click a stage to focus the areas and the Inbox on it; click it again, or Show all, to see everything. For me, above the areas, shows only your work.",
    soloBody: "Work moves from the Inbox through Proposed, Ready and In progress to Awaiting apply. Click a stage to focus the areas and the Inbox on it; click it again, or Show all, to see everything.",
  },
  {
    target: '.stage-side-tab[data-panel="inbox"]',
    title: "Your inbox, sorted by priority",
    body: "New work waits in the Inbox until it has a place on the product map. Prioritized and critical items rise to the top.",
  },
  {
    target: ".plan-areas-grid",
    title: "Plan work onto the product map",
    body: "Drag an Inbox item onto a product area, or press its Accept → button, to accept it into that area. Click an area to open it.",
    soloBody: "Drag an Inbox item onto a product area, or press its Plan in button, to place it there. Click an area to open it.",
  },
];

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 8;
const CARD_W = 380;

/** Where the step's part is, padded, or null when it is not on screen. */
function measure(selector: string): Rect | null {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

/** The card's place: under the spotlight when it fits, else above it, kept inside the window. */
export function cardPosition(rect: Rect | null, view: { width: number; height: number }, cardHeight = 240): { top: number; left: number } {
  const width = Math.min(CARD_W, view.width - 32);
  if (!rect) return { top: Math.max(16, (view.height - cardHeight) / 2), left: Math.max(16, (view.width - width) / 2) };
  const below = rect.top + rect.height + 12;
  const top = below + cardHeight <= view.height - 16 ? below : Math.max(16, rect.top - cardHeight - 12);
  const left = Math.min(Math.max(16, rect.left), view.width - width - 16);
  return { top, left };
}

export function PlanTour({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = TOUR_STEPS[index]!;
  const solo = usePlanView().mode === "solo";
  const last = index === TOUR_STEPS.length - 1;
  useEscapeKey(true, onClose);

  // Bring the step's part into view, then spotlight it; follow scrolls and resizes.
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(step.target);
    el?.scrollIntoView?.({ block: "center" });
    const update = () => setRect(measure(step.target));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step.target]);
  useEffect(() => { nextRef.current?.focus({ preventScroll: true }); }, [index]);

  const pos = cardPosition(rect, { width: window.innerWidth, height: window.innerHeight });
  return h("div", { class: "plan-tour", "data-step": String(index + 1) },
    rect
      ? h("div", { class: "plan-tour-spotlight", "aria-hidden": "true", style: { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` } })
      : h("div", { class: "plan-tour-dim", "aria-hidden": "true" }),
    h("div", {
      class: "plan-tour-card",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "plan-tour-title",
      "aria-describedby": "plan-tour-body",
      style: { top: `${pos.top}px`, left: `${pos.left}px` },
    },
      h("div", { class: "plan-tour-progress" },
        h("span", { class: "plan-tour-count" }, `${index + 1} of ${TOUR_STEPS.length}`),
        h("span", { class: "plan-tour-dots", "aria-hidden": "true" },
          TOUR_STEPS.map((_, i) => h("span", { key: i, class: i === index ? "plan-tour-dot plan-tour-dot--on" : "plan-tour-dot" }))),
      ),
      h("h2", { class: "plan-tour-title", id: "plan-tour-title" }, step.title),
      h("p", { class: "plan-tour-body", id: "plan-tour-body" }, solo && step.soloBody ? step.soloBody : step.body),
      h("div", { class: "plan-tour-actions" },
        h("button", { type: "button", class: "plan-tour-skip", onClick: onClose }, last ? "Close" : "Skip tour"),
        h("span", { class: "plan-tour-spacer" }),
        index > 0 ? h("button", { type: "button", class: "prep-btn", onClick: () => setIndex(index - 1) }, "Back") : null,
        h("button", {
          type: "button",
          class: "prep-btn prep-btn-primary plan-tour-next",
          ref: nextRef,
          onClick: () => (last ? onClose() : setIndex(index + 1)),
        }, last ? "Done" : "Next"),
      ),
    ),
  );
}

/** Solo / Team and "Take the tour", at the right of Plan's head. */
export function PlanHeadControls() {
  const view = usePlanView();
  const [touring, setTouring] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const mode = (m: "solo" | "team", label: string) =>
    h("button", {
      type: "button",
      class: view.mode === m ? "plan-seg plan-seg--on" : "plan-seg",
      "aria-pressed": String(view.mode === m),
      "data-mode": m,
      onClick: () => setPlanView({ mode: m }),
    }, label);
  return h(Fragment, null,
    h("div", { class: "plan-segmented", role: "group", "aria-label": "How this project is worked" },
      mode("solo", "Solo"),
      mode("team", "Team"),
    ),
    h("button", {
      type: "button",
      class: "plan-tour-open",
      ref: opener,
      onClick: () => setTouring(true),
    }, h("span", { "aria-hidden": "true" }, "?"), " Take the tour"),
    touring ? h(PlanTour, { onClose: () => { setTouring(false); opener.current?.focus({ preventScroll: true }); } }) : null,
  );
}
