/**
 * The Inbox's own page, for clearing a backlog: the queue on the left in the
 * Plan section's order (IB7), and the selected change's "Where it goes"
 * section inline on the right. Place & next is the default action.
 *
 * Keyboard, inactive while typing in a field: J/K move, 1–5 pick a
 * candidate, T/A set touches/amends, Enter places and moves on, S skips
 * (the change stays in the Inbox), N says nothing fits, / searches. Each
 * shortcut presses the control the section renders, so a key does exactly
 * what its button does.
 *
 * Reached from the Plan section's "Open ↗" and the bottom-bar Inbox pill.
 *
 * @module viewer/views/inbox-triage
 */

import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useProjectStatus } from "../components/index.js";
import { ChangePlacementSection, takeTitleFocus } from "../components/prd-tree/change-placement.js";
import type { NavigateTo } from "../types.js";
import { AppliedHistory, StrengthChip, bestGuess, useInbox, type InboxRow } from "./inbox.js";
import { Pending, StaleNotice } from "./product-pages.js";

// ── Shortcuts ────────────────────────────────────────────────────────

/** Input types a person does not type into: shortcuts stay live on them. */
const NON_TEXT_INPUTS = new Set(["radio", "checkbox", "button", "submit", "reset", "range", "color", "file", "image"]);

/** True when `target` takes typed text, so a letter belongs to it. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return false;
}

export type Shortcut =
  | { kind: "move"; delta: 1 | -1 }
  | { kind: "pick"; n: number }
  | { kind: "relation"; relation: "touches" | "amends" }
  | { kind: "place" }
  | { kind: "skip" }
  | { kind: "nothing-fits" }
  | { kind: "search" };

/** The shortcut a key press means, or null when it is not one or not ours. */
export function shortcutFor(e: Pick<KeyboardEvent, "key" | "target" | "ctrlKey" | "metaKey" | "altKey">): Shortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === "Enter") {
    // A focused button or link answers Enter itself.
    const el = e.target instanceof Element ? e.target : null;
    return el?.closest("button, a, summary") ? null : { kind: "place" };
  }
  // The queue is a listbox, so its arrows move too; elsewhere they stay native (radio groups).
  if ((key === "ArrowDown" || key === "ArrowUp") && e.target instanceof Element && e.target.getAttribute("role") === "listbox") {
    return { kind: "move", delta: key === "ArrowDown" ? 1 : -1 };
  }
  if (key >= "1" && key <= "5") return { kind: "pick", n: Number(key) };
  switch (key) {
    case "j": return { kind: "move", delta: 1 };
    case "k": return { kind: "move", delta: -1 };
    case "t": return { kind: "relation", relation: "touches" };
    case "a": return { kind: "relation", relation: "amends" };
    case "s": return { kind: "skip" };
    case "n": return { kind: "nothing-fits" };
    case "/": return { kind: "search" };
    default: return null;
  }
}

/** Shown on the page, in the order the keys are listed in the brief. */
const KEY_HELP: ReadonlyArray<[keys: string[], label: string]> = [
  [["J", "K"], "move"],
  [["1", "5"], "pick"],
  [["T", "A"], "touches / amends"],
  [["↵"], "place & next"],
  [["S"], "skip"],
  [["N"], "nothing fits"],
  [["/"], "search"],
];

function KeyHelp() {
  return h("ul", { class: "inbox-keys", "aria-label": "Keyboard shortcuts" },
    KEY_HELP.map(([keys, label]) =>
      h("li", { key: label },
        keys.map((k, i) => [i ? (label === "pick" ? "–" : "/") : null, h("kbd", { key: k }, k)]),
        ` ${label}`,
      ),
    ),
  );
}

/** Click the first of `selectors` the section renders, when it is enabled. */
function press(scope: HTMLElement, selectors: readonly string[]): void {
  for (const sel of selectors) {
    const el = scope.querySelector<HTMLButtonElement | HTMLInputElement>(sel);
    if (!el) continue;
    if (!el.disabled) el.click();
    return;
  }
}

// ── Queue ────────────────────────────────────────────────────────────

const optionId = (id: string) => `inbox-q-${id}`;

function QueueItem({ row, selected, onSelect }: { row: InboxRow; selected: boolean; onSelect: (id: string) => void }) {
  const { change, shortlist } = row;
  const placement = shortlist && "placement" in shortlist ? shortlist.placement : null;
  const guess = placement ? bestGuess(placement) : null;
  const tags = placement?.change.tags ?? [];
  return h("li", {
    id: optionId(change.id),
    role: "option",
    "aria-selected": String(selected),
    class: `inbox-qitem${selected ? " is-selected" : ""}`,
    "data-change-id": change.id,
    onClick: () => onSelect(change.id),
  },
    h("div", { class: "inbox-qitem-title" }, change.title),
    h("div", { class: "inbox-qitem-meta" },
      guess ? h(StrengthChip, { strength: guess.strength }) : null,
      h("span", { class: "inbox-qitem-tasks" }, `${change.taskCount} task${change.taskCount === 1 ? "" : "s"}`),
      tags.map((tag) => h("span", { key: tag, class: "tag inbox-tag" }, tag)),
    ),
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export function InboxTriagePage({ navigateTo }: { navigateTo?: NavigateTo }) {
  const { load, rows, refetch } = useInbox();
  const status = useProjectStatus();
  const [selected, setSelected] = useState<string | null>(null);
  const [placed, setPlaced] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<HTMLUListElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  // Where the selection last sat in the queue: a placed change leaves it,
  // and J then lands on the one that took its slot.
  const lastIndex = useRef(0);

  const order = useMemo(() => rows.map((r) => r.change.id), [rows]);
  const index = selected ? order.indexOf(selected) : -1;
  if (index >= 0) lastIndex.current = index;

  // The first pick waits for every shortlist: until then the order is the read's, not IB7's.
  const ordered = rows.every((r) => r.shortlist);
  useEffect(() => {
    if (selected === null && ordered && order.length) setSelected(order[0]);
  }, [order, ordered, selected]);

  const select = (id: string) => {
    // The section asks the detail panel to focus the next title; here the
    // queue keeps focus, so the next key press still reaches the page.
    takeTitleFocus(id);
    setSelected(id);
    listRef.current?.focus();
  };

  const step = (delta: 1 | -1) => {
    if (!order.length) return;
    const from = index >= 0 ? index + delta : delta > 0 ? lastIndex.current : lastIndex.current - 1;
    setSelected(order[(from + order.length) % order.length]);
  };

  const run = (shortcut: Shortcut) => {
    const scope = detailRef.current;
    switch (shortcut.kind) {
      case "move": step(shortcut.delta); return;
      case "skip": step(1); return;
      case "pick":
        scope?.querySelectorAll<HTMLInputElement>(".cp-shortlist .cp-target input")[shortcut.n - 1]?.click();
        return;
      case "relation":
        if (scope) press(scope, [`.cp-relation input[value="${shortcut.relation}"]`]);
        return;
      case "place":
        if (scope) press(scope, [".cp-place-next", ".cp-propose-next", ".cp-place", ".cp-propose-btn"]);
        return;
      case "nothing-fits":
        if (scope) press(scope, [".cp-nothing-fits"]);
        return;
      case "search":
        scope?.querySelector<HTMLInputElement>(".cp-search-input:not([disabled])")?.focus();
        return;
    }
  };

  // Bound once; the ref sees this render's state.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog over the page owns the keyboard.
      if (e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      const shortcut = shortcutFor(e);
      if (!shortcut) return;
      e.preventDefault();
      runRef.current(shortcut);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (load.state === "v1") return null;
  if (load.state !== "ready") return h(Pending, { load });

  const current = selected ? load.data.find((c) => c.id === selected) : undefined;
  const onWritten = (id: string) => () => {
    setPlaced((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    refetch();
  };

  return h("div", { class: "inbox-page" },
    h(StaleNotice, { message: load.refreshError }),
    h("nav", { class: "inbox-crumb", "aria-label": "Breadcrumb" },
      navigateTo
        ? h("button", { type: "button", class: "ch-change-link", onClick: () => navigateTo("plan") }, "Plan")
        : "Plan",
      " › ",
      h("b", null, "Inbox"),
      h("span", { class: "inbox-crumb-counts", role: "status" },
        ` · ${rows.length} to place · ${placed.size} placed this visit`),
    ),
    h("div", { class: "inbox-triage" },
      h("div", { class: "inbox-queue" },
        rows.length
          ? h("ul", {
              ref: listRef,
              class: "inbox-queue-list",
              role: "listbox",
              tabIndex: 0,
              "aria-label": "Changes to place",
              "aria-activedescendant": index >= 0 ? optionId(order[index]) : undefined,
            }, rows.map((row) => h(QueueItem, { key: row.change.id, row, selected: row.change.id === selected, onSelect: select })))
          : h("div", { class: "empty-state inbox-empty", role: "status" }, "Inbox is empty"),
        h(AppliedHistory, { count: status?.rex.inbox?.appliedUnplaced ?? null }),
      ),
      h("div", { class: "inbox-detail", ref: detailRef },
        current
          ? [
              h("div", { key: "head", class: "inbox-detail-head" },
                h("span", { class: "ch-display-id" }, current.displayId ?? current.id.slice(0, 8)),
                h("div", { class: "inbox-detail-title" }, current.title),
                navigateTo
                  ? h("button", {
                      type: "button", class: "ch-change-link inbox-detail-open",
                      onClick: () => navigateTo("prd", { taskId: current.id }),
                    }, "Open in Tasks")
                  : null,
              ),
              h(ChangePlacementSection, {
                key: current.id,
                changeId: current.id,
                changeTitle: current.title,
                onOpenChange: select,
                onWritten: onWritten(current.id),
              }),
              h("div", { key: "bar", class: "inbox-detail-bar" },
                h("button", {
                  type: "button", class: "btn btn-sm inbox-skip",
                  disabled: !order.some((id) => id !== current.id),
                  onClick: () => step(1),
                }, "Skip"),
                h(KeyHelp, null),
              ),
            ]
          : null,
      ),
    ),
  );
}
