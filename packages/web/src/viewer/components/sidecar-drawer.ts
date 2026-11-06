/**
 * The Sidecar drawer and its top-nav button.
 *
 * The drawer docks in the page flow to the right of the page body (UX1): the
 * page narrows rather than being covered, so the NEXT stage link, which is
 * positioned inside the page body, stays on the page's own right edge, and
 * the status dock moves left by the drawer's width (`--sidecar-w`, UX10).
 * Default 440 px, resizable 360–640 px by dragging or arrowing its left edge;
 * the width is remembered.
 *
 * Inside: the head, the transcript, the session's permission cards
 * (sidecar-cards.ts), an orange paused bar above the composer while the turn
 * waits on a card, and the composer. Enter sends, Shift+Enter breaks the line; the
 * composer is disabled while a turn runs, and Stop interrupts it.
 *
 * All data comes from `useSidecar` in main.ts; this file only draws it.
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { GENERAL_LENS, SIDECAR_VENDORS, lensLabel, resolveLens, sidecarSetupNeed } from "../hooks/sidecar.js";
import type { SidecarFrame, SidecarRuntimeEvent, SidecarState } from "../hooks/sidecar.js";
import { SidecarCards, cardTurnSender } from "./sidecar-cards.js";
import { SidecarSessions, NewSessionButton } from "./sidecar-sessions.js";
import { modelLabel, vendorLabel } from "./sidecar-agent-names.js";
import {
  TOOL_STATUS_TEXT, cardIsForCall, connectionLabelsFromCards, parseToolName, toolLineStatus, toolResultIsError,
} from "./sidecar-tool-names.js";
import type { ToolLineCard } from "./sidecar-tool-names.js";
import { useHubProjects } from "./project-switcher.js";
import {
  ExtensionTabPanel, ExtensionTabStrip, SIDECAR_TAB, extensionFramePath, useExtensionTabs,
} from "./sidecar-extension-tabs.js";
import { getBasePath } from "../base-path.js";

export const SIDECAR_WIDTH_DEFAULT = 440;
export const SIDECAR_WIDTH_MIN = 360;
export const SIDECAR_WIDTH_MAX = 640;
const WIDTH_KEY = "ndx-sidecar-width";
const WIDTH_STEP = 20;

export function clampSidecarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDECAR_WIDTH_DEFAULT;
  return Math.min(SIDECAR_WIDTH_MAX, Math.max(SIDECAR_WIDTH_MIN, Math.round(width)));
}

function storedWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    return raw === null ? SIDECAR_WIDTH_DEFAULT : clampSidecarWidth(Number(raw));
  } catch {
    return SIDECAR_WIDTH_DEFAULT;
  }
}

// ---------------------------------------------------------------------------
// Top-nav button
// ---------------------------------------------------------------------------

export interface SidecarButtonProps {
  open: boolean;
  /** Cards waiting across this worktree's sessions. */
  waiting: number;
  onToggle: () => void;
}

export function SidecarButton({ open, waiting, onToggle }: SidecarButtonProps) {
  const label = waiting > 0 ? `Sidecar, ${waiting} waiting` : "Sidecar";
  return h("button", {
    type: "button",
    class: `topnav-sidecar${open ? " active" : ""}`,
    onClick: onToggle,
    title: "Sidecar (⌘J)",
    "aria-label": label,
    "aria-expanded": open ? "true" : "false",
    "aria-controls": "sidecar-drawer",
    "aria-keyshortcuts": "Meta+J Control+J",
  },
    h("span", { class: "topnav-sidecar-glyph", "aria-hidden": "true" }, "◧"),
    h("span", { class: "topnav-sidecar-label", "aria-hidden": "true" }, "Sidecar"),
    waiting > 0 ? h("span", { class: "topnav-sidecar-badge", "aria-hidden": "true" }, String(waiting)) : null,
  );
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

function notesLabel(notes: number): string {
  return notes === 1 ? "1 note carried over" : `${notes} notes carried over`;
}

type ToolResult = NonNullable<SidecarRuntimeEvent["toolResult"]>;

const SUMMARY_KEYS = ["command", "file_path", "path", "pattern", "query", "url", "description", "prompt"];
const SUMMARY_MAX = 80;

/** One line naming what a tool call does: its most telling string argument, else its JSON. */
export function summarizeToolInput(input: Record<string, unknown>): string {
  const key = SUMMARY_KEYS.find((k) => typeof input[k] === "string" && (input[k] as string).trim() !== "");
  const raw = key ? (input[key] as string) : Object.keys(input).length > 0 ? JSON.stringify(input) : "";
  const line = raw.replace(/\s+/g, " ").trim();
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line;
}

/**
 * The result of each tool call, by the call's `seq`. A result that names its
 * call (Claude's `tool_use_id`, as `id`) belongs to the open call with that
 * id, or to none. A result without one — Codex's — belongs to the earliest
 * still-unanswered call to the same tool when it names one, else to the
 * earliest still-unanswered call: vendor CLIs answer calls in order.
 */
export function pairToolResults(frames: readonly SidecarFrame[]): Map<number, ToolResult> {
  const open: Array<{ seq: number; tool: string; id?: string }> = [];
  const paired = new Map<number, ToolResult>();
  for (const frame of frames) {
    if (frame.type !== "event" || frame.checkpoint) continue;
    const { event } = frame;
    if (event.type === "tool_use" && event.toolCall) {
      open.push({ seq: frame.seq, tool: event.toolCall.tool, id: event.toolCall.id });
    } else if (event.type === "tool_result" && event.toolResult) {
      const { id: callId, tool } = event.toolResult;
      const named = open.findIndex((c) => c.tool === tool);
      const index = callId
        ? open.findIndex((c) => c.id === callId)
        : named >= 0 ? named : open.length > 0 ? 0 : -1;
      if (index < 0) continue;
      const [call] = open.splice(index, 1);
      paired.set(call.seq, event.toolResult);
    }
  }
  return paired;
}

/**
 * The card each tool call raised, by the call's `seq`: the earliest card of
 * the same tool and input not yet claimed by an earlier call.
 */
export function pairToolCards<C extends ToolLineCard>(frames: readonly SidecarFrame[], cards: readonly C[]): Map<number, C> {
  const free = [...cards];
  const paired = new Map<number, C>();
  for (const frame of frames) {
    if (frame.type !== "event" || frame.checkpoint) continue;
    const { event } = frame;
    if (event.type !== "tool_use" || !event.toolCall) continue;
    const parsed = parseToolName(event.toolCall.tool);
    const index = free.findIndex((card) => cardIsForCall(card, parsed, event.toolCall!.input));
    if (index >= 0) paired.set(frame.seq, free.splice(index, 1)[0]!);
  }
  return paired;
}

/** A tool call: a status dot, a readable name and status, and a one-line summary; expanded, the raw wire name, input and result. */
function SidecarToolRow({ seq, call, result, card, connectionLabels }: {
  seq: number;
  call: NonNullable<SidecarRuntimeEvent["toolCall"]>;
  result: ToolResult | undefined;
  card?: ToolLineCard;
  connectionLabels?: Readonly<Record<string, string>>;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = `sidecar-tool-${seq}`;
  const status = toolLineStatus(card, result !== undefined, result !== undefined && toolResultIsError(result.output));
  return h("li", { class: "sidecar-tool", "data-seq": seq },
    h("button", {
      type: "button",
      class: "sidecar-tool-toggle",
      "aria-expanded": expanded ? "true" : "false",
      "aria-controls": bodyId,
      onClick: () => setExpanded((v) => !v),
    },
      h("span", { class: "sidecar-tool-dot", "data-status": status, "aria-hidden": "true" }),
      h("span", { class: "sidecar-tool-name" }, parseToolName(call.tool, connectionLabels).label),
      h("span", { class: "sidecar-tool-status" }, TOOL_STATUS_TEXT[status]),
      h("span", { class: "sidecar-tool-summary" }, summarizeToolInput(call.input)),
    ),
    expanded
      ? h("div", { class: "sidecar-tool-body", id: bodyId },
          h("div", { class: "sidecar-tool-label" }, "Tool"),
          h("code", { class: "sidecar-tool-wire" }, call.tool),
          h("div", { class: "sidecar-tool-label" }, "Input"),
          h("pre", { class: "sidecar-tool-input" }, JSON.stringify(call.input, null, 2)),
          h("div", { class: "sidecar-tool-label" }, "Result"),
          result
            ? h("pre", { class: "sidecar-tool-output" }, result.output)
            : h("p", { class: "sidecar-tool-pending" }, "No result yet"),
        )
      : null,
  );
}

/** One frame as a transcript row; null for frames the conversation does not show. */
export function SidecarFrameRow({ frame, result, card, connectionLabels }: {
  frame: SidecarFrame;
  result?: ToolResult;
  card?: ToolLineCard;
  connectionLabels?: Readonly<Record<string, string>>;
}) {
  switch (frame.type) {
    case "user":
      return h("li", { class: "sidecar-msg sidecar-msg-user", "data-seq": frame.seq }, frame.text);
    case "context-refreshed":
      return h("li", { class: "sidecar-divider", role: "separator", "data-seq": frame.seq },
        h("span", null, `Context refreshed · ${notesLabel(frame.notes)}`),
      );
    case "event": {
      // The checkpoint turn writes the ledger; it is not part of the conversation.
      if (frame.checkpoint) return null;
      const event = frame.event;
      if (event.type === "assistant" && event.text) {
        return h("li", { class: "sidecar-msg sidecar-msg-assistant", "data-seq": frame.seq }, event.text);
      }
      if (event.type === "tool_use" && event.toolCall) {
        return h(SidecarToolRow, { seq: frame.seq, call: event.toolCall, result, card, connectionLabels });
      }
      if (event.type === "failure") {
        return h("li", { class: "sidecar-msg sidecar-msg-failure", role: "alert", "data-seq": frame.seq },
          event.failure?.message ?? "The agent reported a failure",
        );
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Attachment and lens chips
// ---------------------------------------------------------------------------

/**
 * The page item attached as the session's target (removable) and the lens
 * chip. The chip names the lens the page asked for; while the registry cannot
 * run it, it says "not available yet" and the session runs General. The chip
 * opens the lens list, as does `/` in an empty composer.
 */
function SidecarAttachmentBar({ attachment, menuOpen, setMenuOpen }: {
  attachment: SidecarState["attachment"];
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}) {
  const { item, lens, lenses, chooseLens, removeItem } = attachment;
  // What a menu entry cannot run on yet: its source, or the item it needs attached.
  const noteFor = (entry: { id: string; available: boolean }): string | null => {
    if (!entry.available) return "not available yet";
    const needs = entry.id === GENERAL_LENS ? undefined : resolveLens(entry.id, lenses, item).needs;
    return needs ? `needs ${needs}` : null;
  };
  return h("div", { class: "sidecar-attachment" },
    item
      ? h("span", { class: "sidecar-chip sidecar-chip-item", "data-kind": item.kind },
          h("span", { class: "sidecar-chip-label" }, `${item.kind === "plan" || item.kind === "live" ? "" : `${item.kind} `}${item.label}`),
          h("button", {
            type: "button",
            class: "sidecar-chip-remove",
            "aria-label": `Remove ${item.label} from this session`,
            onClick: removeItem,
          }, "×"))
      : null,
    h("span", { class: "sidecar-lens" },
      h("button", {
        type: "button",
        class: "sidecar-chip sidecar-chip-lens",
        "aria-haspopup": "listbox",
        "aria-expanded": menuOpen ? "true" : "false",
        "aria-label": `Lens: ${lensLabel(lens.wanted)}${lens.needs ? ", not available yet" : ""}`,
        title: lens.needs ? `Waiting on ${lens.needs}; this session runs General` : "Switch lens (/)",
        onClick: () => setMenuOpen(!menuOpen),
      },
        h("span", { class: "sidecar-chip-label" }, lensLabel(lens.wanted)),
        lens.needs ? h("span", { class: "sidecar-chip-note" }, "not available yet") : null),
      menuOpen
        ? h("ul", { class: "sidecar-lens-menu", role: "listbox", "aria-label": "Lens" },
            [{ id: GENERAL_LENS, available: true }, ...lenses.filter((l) => l.id !== GENERAL_LENS)].map((entry) => {
              const note = noteFor(entry);
              return h("li", { key: entry.id, role: "presentation" },
                h("button", {
                  type: "button",
                  role: "option",
                  class: "sidecar-lens-option",
                  "aria-selected": entry.id === lens.wanted ? "true" : "false",
                  "aria-disabled": note ? "true" : undefined,
                  "data-lens": entry.id,
                  disabled: note !== null,
                  onClick: () => { if (chooseLens(entry.id)) setMenuOpen(false); },
                }, lensLabel(entry.id), note ? h("span", { class: "sidecar-chip-note" }, note) : null));
            }))
        : null),
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

export interface SidecarDrawerProps {
  sidecar: SidecarState;
  onClose: () => void;
}

export function SidecarDrawer({ sidecar, onClose }: SidecarDrawerProps) {
  const [width, setWidth] = useState(storedWidth);
  const [draft, setDraft] = useState("");
  const [listing, setListing] = useState(false);
  const [lensMenu, setLensMenu] = useState(false);
  const transcriptRef = useRef<HTMLOListElement>(null);
  const hub = useHubProjects();
  const tabs = useExtensionTabs(hub);
  const [selected, setSelected] = useState(SIDECAR_TAB);
  // A tab asks for its frame key on its first open and is kept after that.
  const [opened, setOpened] = useState<string[]>([]);
  const active = tabs.some((t) => t.name === selected) ? selected : SIDECAR_TAB;
  const selectTab = (id: string) => {
    setSelected(id);
    if (id !== SIDECAR_TAB) setOpened((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const applyWidth = useCallback((next: number) => {
    const w = clampSidecarWidth(next);
    setWidth(w);
    try { localStorage.setItem(WIDTH_KEY, String(w)); } catch { /* storage full or blocked: the width still applies */ }
  }, []);

  // The status dock is fixed to the viewport; it reads the drawer's width.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--sidecar-w", `${width}px`);
    return () => { root.style.removeProperty("--sidecar-w"); };
  }, [width]);

  // Follow the newest frame.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sidecar.frames.length]);

  const onResizeStart = (e: PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const move = (ev: PointerEvent) => applyWidth(startWidth + (startX - ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onResizeKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") applyWidth(width + WIDTH_STEP);
    else if (e.key === "ArrowRight") applyWidth(width - WIDTH_STEP);
    else if (e.key === "Home") applyWidth(SIDECAR_WIDTH_MIN);
    else if (e.key === "End") applyWidth(SIDECAR_WIDTH_MAX);
    else return;
    e.preventDefault();
  };

  const setupNeed = sidecarSetupNeed(sidecar.agent, sidecar.catalog, sidecar.lastTurn);
  // A missing CLI cannot run a turn, so the composer waits for it. A signed-out
  // one leaves the composer on: sending again after the login is the retry,
  // and the send clears the state.
  const blocked = setupNeed?.reason === "missing-cli" ? setupNeed : null;
  const busy = sidecar.running || sidecar.sending || blocked !== null;
  const submit = async () => {
    if (busy || !draft.trim()) return;
    if (await sidecar.send(draft)) setDraft("");
  };

  const results = pairToolResults(sidecar.frames);
  const toolCards = pairToolCards(sidecar.frames, sidecar.cards);
  const connectionLabels = connectionLabelsFromCards(sidecar.cards);
  const rows: ComponentChildren[] = sidecar.frames.map((frame) =>
    h(SidecarFrameRow, { key: frame.seq, frame, result: results.get(frame.seq), card: toolCards.get(frame.seq), connectionLabels }));
  const { agent, catalog } = sidecar;
  const models = agent ? catalog?.[agent.vendor]?.models ?? [] : [];
  // A session's own model may not be in the live list; keep it selectable.
  const modelOptions = agent?.model && !models.includes(agent.model) ? [agent.model, ...models] : models;
  const paused = sidecar.running && sidecar.sessionWaiting > 0;
  const turnFailed = sidecar.lastTurn && sidecar.lastTurn.status !== "completed" ? sidecar.lastTurn : null;

  return h("aside", {
    id: "sidecar-drawer",
    class: "sidecar-drawer",
    style: { width: `${width}px` },
    "aria-label": "Sidecar",
  },
    h("div", {
      class: "sidecar-resize",
      role: "separator",
      tabIndex: 0,
      "aria-orientation": "vertical",
      "aria-label": "Resize Sidecar",
      "aria-valuenow": width,
      "aria-valuemin": SIDECAR_WIDTH_MIN,
      "aria-valuemax": SIDECAR_WIDTH_MAX,
      onPointerDown: onResizeStart,
      onKeyDown: onResizeKey,
    }),
    h("header", { class: "sidecar-head" },
      h("span", { class: "sidecar-title" }, "Sidecar"),
      sidecar.session ? h("span", { class: "sidecar-session-name" }, sidecar.session.name) : null,
      h(NewSessionButton, { sidecar, onStarted: () => setListing(false) }),
      h("button", {
        type: "button",
        class: `sidecar-sessions-toggle${listing ? " active" : ""}`,
        "aria-pressed": listing ? "true" : "false",
        onClick: () => setListing((v) => !v),
      }, "Sessions"),
      h("button", { type: "button", class: "sidecar-close", onClick: onClose, "aria-label": "Close Sidecar", title: "Close (⌘J)" }, "×"),
    ),
    h(ExtensionTabStrip, { tabs, active, onSelect: selectTab }),
    ...tabs.filter((t) => opened.includes(t.name)).map((t) =>
      h(ExtensionTabPanel, {
        key: t.name,
        tab: t,
        framePath: extensionFramePath(getBasePath(), hub.projects, t.name),
        visible: active === t.name,
      })),
    // Hidden, not unmounted, while an extension tab shows: the conversation
    // and the composer's text survive the switch.
    h("div", { class: "sidecar-panel sidecar-chat-panel", hidden: active !== SIDECAR_TAB },
    listing ? h(SidecarSessions, { sidecar, onOpened: () => setListing(false) }) : null,
    ...(listing ? [] : [
    agent
      ? h("div", { class: "sidecar-agent" },
          h("div", { class: "sidecar-field" },
            h("label", { class: "sidecar-field-label", for: "sidecar-vendor" }, "Agent"),
            h("select", {
              id: "sidecar-vendor",
              class: "sidecar-vendor",
              value: agent.vendor,
              onChange: (e: Event) => { void sidecar.chooseAgent((e.target as HTMLSelectElement).value); },
            }, SIDECAR_VENDORS.filter((v) => catalog?.[v] || v === agent.vendor).map((v) =>
              h("option", { key: v, value: v, selected: v === agent.vendor }, vendorLabel(v))))),
          h("div", { class: "sidecar-field sidecar-field-model" },
            h("label", { class: "sidecar-field-label", for: "sidecar-model" }, "Model"),
            h("select", {
              id: "sidecar-model",
              class: "sidecar-model",
              value: agent.model,
              disabled: modelOptions.length === 0,
              onChange: (e: Event) => { void sidecar.chooseAgent(agent.vendor, (e.target as HTMLSelectElement).value); },
            }, modelOptions.map((m) =>
              h("option", { key: m, value: m, title: m, selected: m === agent.model }, modelLabel(m))))),
        )
      : null,
    h("ol", { class: "sidecar-transcript", ref: transcriptRef, "aria-live": "polite", "aria-label": "Transcript" },
      rows.length > 0 ? rows : h("li", { class: "sidecar-empty" }, "Ask about this project. Each turn runs your vendor CLI."),
    ),
    h(SidecarCards, { cards: sidecar.cards, manifest: sidecar.commandManifest, decide: sidecar.decide, send: cardTurnSender(sidecar) }),
    setupNeed
      ? h("div", { class: "sidecar-setup", role: "alert", "data-reason": setupNeed.reason },
          h("p", { class: "sidecar-setup-title" },
            setupNeed.reason === "missing-cli"
              ? `The ${setupNeed.cli} CLI is not installed`
              : `The ${setupNeed.cli} CLI is not signed in`),
          h("p", { class: "sidecar-setup-hint" },
            setupNeed.reason === "missing-cli" ? "Install it, then reopen Sidecar:" : "Sign in, then send your message again:"),
          h("code", { class: "sidecar-setup-command" }, setupNeed.command))
      : null,
    turnFailed && !setupNeed
      ? h("p", { class: "sidecar-turn-end", role: "status" },
          `Turn ${turnFailed.status}${turnFailed.error ? `: ${turnFailed.error}` : ""}`)
      : null,
    sidecar.error ? h("p", { class: "sidecar-error", role: "alert" }, sidecar.error) : null,
    paused
      ? h("div", { class: "sidecar-paused", role: "status" },
          `Agent paused · waiting on ${sidecar.sessionWaiting === 1 ? "your decision" : `${sidecar.sessionWaiting} decisions`}`)
      : null,
    sidecar.readOnly
      ? h("div", { class: "sidecar-readonly", role: "status" },
          h("span", null, "This session has ended. Its transcript is read-only."),
          h(NewSessionButton, { sidecar }))
      : h("form", {
      class: "sidecar-composer",
      onSubmit: (e: Event) => { e.preventDefault(); void submit(); },
    },
      h("div", { class: "sidecar-composer-card" },
      h(SidecarAttachmentBar, { attachment: sidecar.attachment, menuOpen: lensMenu, setMenuOpen: setLensMenu }),
      h("textarea", {
        class: "sidecar-input",
        "aria-label": "Message Sidecar",
        placeholder: blocked ? `Install the ${blocked.cli} CLI first` : busy ? "A turn is running…" : "Ask about this project, or tell the agent what to do…",
        value: draft,
        disabled: busy,
        rows: 3,
        onInput: (e: Event) => setDraft((e.target as HTMLTextAreaElement).value),
        onKeyDown: (e: KeyboardEvent) => {
          // `/` in an empty composer opens the lens list instead of typing.
          if (e.key === "/" && draft === "" && !e.isComposing) {
            e.preventDefault();
            setLensMenu(true);
            return;
          }
          if (e.key === "Escape" && lensMenu) { setLensMenu(false); return; }
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            void submit();
          }
        },
      }),
      h("div", { class: "sidecar-composer-actions" },
        h("span", { class: "sidecar-composer-hint" }, "Enter to send · Shift+Enter for a new line"),
        sidecar.running
          ? h("button", { type: "button", class: "sidecar-stop", onClick: () => { void sidecar.stop(); } }, "Stop")
          : null,
        h("button", { type: "submit", class: "sidecar-send", disabled: busy || !draft.trim() }, "Send"),
      ),
      ),
    ),
    ]),
    ),
  );
}

// ---------------------------------------------------------------------------
// Dock: the page body and, when open, the drawer beside it
// ---------------------------------------------------------------------------

export interface SidecarDockProps {
  open: boolean;
  sidecar: SidecarState;
  onClose: () => void;
  children?: ComponentChildren;
}

export function SidecarDock({ open, sidecar, onClose, children }: SidecarDockProps) {
  return h("div", { class: `app-dock${open ? " app-dock--sidecar" : ""}` },
    children,
    open ? h(SidecarDrawer, { sidecar, onClose }) : null,
  );
}
