/**
 * Sidecar permission cards (story 08, UX4, UX8).
 *
 * The open session's cards, oldest first. The agent waits on the first
 * waiting card, so only that one can be decided: Approve, Deny with an
 * optional note that reaches the agent as the decision's reason, and
 * "Always allow" when the card carries an allow-list key. ⌘↵ (Ctrl+Enter)
 * approves it and ⌘⌫ (Ctrl+Backspace) denies it, except while focus is in
 * a text field, where those keys keep their editing meaning.
 *
 * Bodies are generic: a title from the card's input and the input itself.
 * A command card adds the effects line its ndx command declares in the
 * command manifest. Rich change-set and edit bodies come later (M3).
 *
 * A card withdrawn because its session ended draws as denied with the note
 * "session ended" (UX8); one withdrawn because the turn stopped draws as
 * withdrawn.
 */

import { h } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { SIDECAR_SESSION_ENDED_REASON } from "../external.js";
import { useCliName } from "../hooks/index.js";
import type { SidecarCard, SidecarCardDecision, SidecarCardKind, SidecarState } from "../hooks/index.js";

export const SIDECAR_CARD_KIND_LABELS: Readonly<Record<SidecarCardKind, string>> = {
  command: "Command",
  work: "Work",
  "change-set": "Change set",
  placement: "Placement",
  edit: "Edit",
  "network-read": "Network read",
  "draft-post": "Draft post",
  "migration-decision": "Migration decision",
};

export type SidecarCardState = "pending" | "approved" | "denied" | "allow-listed" | "withdrawn";

/** How a card draws: a session-end withdrawal reads as a denial. */
export function sidecarCardState(card: SidecarCard): SidecarCardState {
  switch (card.status) {
    case "pending": return "pending";
    case "approved": return card.remembered ? "allow-listed" : "approved";
    case "denied": return "denied";
    case "withdrawn": return card.reason === SIDECAR_SESSION_ENDED_REASON ? "denied" : "withdrawn";
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const count = (v: unknown, one: string, many: string): string => {
  const n = Array.isArray(v) ? v.length : 0;
  return `${n} ${n === 1 ? one : many}`;
};

/** One line naming what the card would do, from its input; `cliName` from useCliName(). */
export function sidecarCardTitle(card: SidecarCard, cliName: string): string {
  const { input } = card;
  const title = ((): string => {
    switch (card.kind) {
      case "command": return Array.isArray(input.argv) ? input.argv.map(String).join(" ") : "";
      case "work": {
        const flags = Array.isArray(input.flags) ? input.flags.map(String) : [];
        return str(input.taskId) ? [cliName, "work", `--task=${str(input.taskId)}`, ...flags].join(" ") : "";
      }
      case "change-set": return count(input.items, "item", "items");
      case "placement": return str(input.change) && str(input.target) ? `${str(input.change)} → ${str(input.target)}` : "";
      case "edit": return str(input.path);
      case "network-read": return [str(input.kind), str(input.ref)].filter(Boolean).join(" ");
      case "draft-post": return [str(input.kind), str(input.target)].filter(Boolean).join(" · ");
      case "migration-decision": return count(input.entries, "decision", "decisions");
    }
  })();
  return title || card.tool;
}

/**
 * The effects line of a command card: what its ndx command reads, writes,
 * whether it calls a model and how long it takes, from GET
 * /api/commands/manifest; "no declared effects" when the manifest has none.
 */
export function sidecarCommandEffectsLine(card: SidecarCard, manifest: SidecarState["commandManifest"]): string {
  if (manifest === null || manifest === "loading") return "reading effects…";
  if (manifest === "unavailable") return "effects unavailable";
  const argv = Array.isArray(card.input.argv) ? card.input.argv.map(String) : [];
  const effects = manifest.cliNames.includes(argv[0] ?? "") ? manifest.effects[argv[1] ?? ""] : undefined;
  if (!effects) return "no declared effects";
  const reads = effects.reads.length > 0 ? effects.reads.join(" + ") : "nothing";
  const writes = effects.writes.length > 0 ? effects.writes.map((w) => w.path).join(", ") : "nothing";
  const llm = effects.llm.length > 0 ? `${effects.llm.length === 1 ? "1 LLM phase" : `${effects.llm.length} LLM phases`}` : "no LLM";
  return `reads ${reads} · writes ${writes} · ${llm} · ${effects.duration}`;
}

function settledNote(card: SidecarCard, state: SidecarCardState): string {
  switch (state) {
    case "approved": return "Approved";
    case "allow-listed": return "Approved · allow-listed, runs without asking from now on";
    case "denied":
      if (card.status === "withdrawn") return `Denied · ${SIDECAR_SESSION_ENDED_REASON}`;
      return card.reason ? `Denied · note sent to the agent: "${card.reason}"` : "Denied";
    case "withdrawn": return `Withdrawn · ${card.reason ?? "the turn stopped"}`;
    case "pending": return "";
  }
}

/** Focus is somewhere ⌘↵ and ⌘⌫ edit text. */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"].includes(target.type);
}

/** ⌘↵ / Ctrl+Enter approves, ⌘⌫ / Ctrl+Backspace denies; null for any other key. */
export function cardShortcut(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): "approve" | "deny" | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null;
  if (e.key === "Enter") return "approve";
  if (e.key === "Backspace") return "deny";
  return null;
}

interface CardProps {
  card: SidecarCard;
  cliName: string;
  /** The first waiting card: the only one that can be decided. */
  first: boolean;
  manifest: SidecarState["commandManifest"];
  note: string;
  onNote: (note: string) => void;
  deciding: boolean;
  onDecide: (decision: SidecarCardDecision) => void;
}

function SidecarCardView({ card, cliName, first, manifest, note, onNote, deciding, onDecide }: CardProps) {
  const state = sidecarCardState(card);
  const input = h("pre", { class: "sidecar-card-input" }, JSON.stringify(card.input, null, 2));
  return h("li", { class: `sidecar-card sidecar-card--${state}`, "data-card": card.id, "data-kind": card.kind },
    h("div", { class: "sidecar-card-head" },
      h("span", { class: "sidecar-card-kind" }, SIDECAR_CARD_KIND_LABELS[card.kind] ?? card.kind),
      h("span", { class: "sidecar-card-title" }, sidecarCardTitle(card, cliName)),
    ),
    card.kind === "command" ? h("div", { class: "sidecar-card-effects" }, sidecarCommandEffectsLine(card, manifest)) : null,
    state === "pending"
      ? input
      : h("details", { class: "sidecar-card-details" }, h("summary", null, "Input"), input),
    state !== "pending"
      ? h("p", { class: "sidecar-card-note" }, settledNote(card, state))
      : first
        ? h("div", { class: "sidecar-card-decide" },
            h("input", {
              type: "text",
              class: "sidecar-card-reason",
              "aria-label": "Note for the agent if you deny",
              placeholder: "Note for the agent if you deny (optional)",
              value: note,
              onInput: (e: Event) => onNote((e.target as HTMLInputElement).value),
            }),
            h("div", { class: "sidecar-card-actions" },
              h("button", { type: "button", class: "sidecar-card-approve", disabled: deciding, onClick: () => onDecide({ approve: true }) }, "Approve"),
              h("button", { type: "button", class: "sidecar-card-deny", disabled: deciding, onClick: () => onDecide({ approve: false, reason: note }) }, "Deny"),
              card.allowListKey !== null
                ? h("button", {
                    type: "button",
                    class: "sidecar-card-always",
                    disabled: deciding,
                    onClick: () => onDecide({ approve: true, remember: true }),
                  }, "Always allow")
                : null,
              h("span", { class: "sidecar-card-keys", "aria-hidden": "true" }, "⌘↵ approve · ⌘⌫ deny"),
            ),
          )
        : h("p", { class: "sidecar-card-queued" }, "Decided after the card above"),
  );
}

export interface SidecarCardsProps {
  cards: SidecarCard[];
  manifest: SidecarState["commandManifest"];
  decide: SidecarState["decide"];
}

export function SidecarCards({ cards, manifest, decide }: SidecarCardsProps) {
  const cliName = useCliName();
  const first = cards.find((c) => c.status === "pending") ?? null;
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);
  const firstId = first?.id ?? null;

  // A note belongs to the card it was typed on.
  useEffect(() => { setNote(""); }, [firstId]);

  const answer = async (decision: SidecarCardDecision) => {
    if (!first || deciding) return;
    setDeciding(true);
    try {
      await decide(first.id, decision);
    } finally {
      setDeciding(false);
    }
  };
  const answerRef = useRef(answer);
  answerRef.current = answer;
  const noteRef = useRef(note);
  noteRef.current = note;

  useEffect(() => {
    if (!firstId) return;
    const handler = (e: KeyboardEvent) => {
      const action = cardShortcut(e);
      if (!action || isTextField(e.target)) return;
      e.preventDefault();
      void answerRef.current(action === "approve" ? { approve: true } : { approve: false, reason: noteRef.current });
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [firstId]);

  if (cards.length === 0) return null;
  return h("ol", { class: "sidecar-cards", "aria-label": "Permission cards" },
    cards.map((card) => h(SidecarCardView, {
      key: card.id,
      card,
      cliName,
      first: card.id === firstId,
      manifest,
      note,
      onNote: setNote,
      deciding,
      onDecide: (decision: SidecarCardDecision) => { void answer(decision); },
    })),
  );
}
