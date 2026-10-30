/**
 * Sidecar permission cards (story 08, UX4, UX8).
 *
 * The open session's cards, oldest first. The agent waits on the first
 * waiting card, so only that one can be decided: Approve, Deny with an
 * optional note that reaches the agent as the decision's reason, and
 * "Always allow" when the card carries an allow-list key. ⌘↵ (Ctrl+Enter)
 * approves it and ⌘⌫ (Ctrl+Backspace) denies it, except while focus is in
 * a text field, where those keys keep their editing meaning, or when a page
 * control has already handled the key.
 *
 * Bodies are generic: a title from the card's input and the input itself.
 * A command card adds the effects line its ndx command declares in the
 * command manifest; a work card shows the run's `ndx work --resolve`
 * preview, read before the card was raised. A change-set card (story 11)
 * shows its items as the server read them: each item's title, description
 * and done-when, editable while it is the first waiting card and sent with
 * the approval; any existing item it matches; and, on v2, where the change
 * lands — on its target, or in the Inbox needing placement. It never offers
 * to apply the change. Rich edit bodies come later.
 *
 * A card withdrawn because its session ended draws as denied with the note
 * "session ended" (UX8); one withdrawn because the turn stopped draws as
 * withdrawn.
 */

import { h } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { SIDECAR_SESSION_ENDED_REASON, checkRunOptions, itemTypeLabel, workCommandArgs } from "../external.js";
import { useCliName } from "../hooks/index.js";
import type { SidecarCard, SidecarCardDecision, SidecarCardKind, SidecarState } from "../hooks/index.js";
import type { SidecarChangeSetEdit } from "../external.js";

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
        // The execute route's own argv builder, so the title is the command approval spawns.
        // Options that fail the shape check would be refused there; the title then leaves them out.
        const checked = checkRunOptions(input.options);
        const options = checked.ok ? checked.options : {};
        return str(input.taskId) ? [cliName, ...workCommandArgs({ taskId: str(input.taskId), options, dir: "." })].join(" ") : "";
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
 * `{token}` layout paths expand to the manifest's layoutPaths; a token it
 * does not name stays as written.
 */
export function sidecarCommandEffectsLine(card: SidecarCard, manifest: SidecarState["commandManifest"]): string {
  if (manifest === null || manifest === "loading") return "reading effects…";
  if (manifest === "unavailable") return "effects unavailable";
  const argv = Array.isArray(card.input.argv) ? card.input.argv.map(String) : [];
  const effects = manifest.cliNames.includes(argv[0] ?? "") ? manifest.effects[argv[1] ?? ""] : undefined;
  if (!effects) return "no declared effects";
  const expand = (text: string): string =>
    text.replace(/\{(\w+)\}/g, (token, name: string) => manifest.layoutPaths[name] ?? token);
  const reads = effects.reads.length > 0 ? expand(effects.reads.join(" + ")) : "nothing";
  const writes = effects.writes.length > 0 ? expand(effects.writes.map((w) => w.path).join(", ")) : "nothing";
  const llm = effects.llm.length > 0 ? `${effects.llm.length === 1 ? "1 LLM phase" : `${effects.llm.length} LLM phases`}` : "no LLM";
  return `reads ${reads} · writes ${writes} · ${llm} · ${effects.duration}`;
}

// ── Change-set card (story 11) ───────────────────────────────────────

/** One item's fields as the operator is editing them; criteria one per line. */
export interface ChangeSetDraft {
  title: string;
  description: string;
  criteria: string;
}

type ChangeSetItem = NonNullable<SidecarCard["changeSet"]>["items"][number];

const criteriaLines = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter(Boolean);

function draftOf(item: ChangeSetItem): ChangeSetDraft {
  return { title: item.title, description: item.description ?? "", criteria: (item.acceptanceCriteria ?? []).join("\n") };
}

/** The edits an approval sends: only the items, and fields, the operator changed. */
export function changeSetEdits(card: SidecarCard, drafts: Readonly<Record<number, ChangeSetDraft>>): SidecarChangeSetEdit[] {
  const items = card.changeSet?.items ?? [];
  const edits: SidecarChangeSetEdit[] = [];
  for (const [key, draft] of Object.entries(drafts)) {
    const index = Number(key);
    const item = items[index];
    if (!item) continue;
    const edit: SidecarChangeSetEdit = { index };
    if (draft.title.trim() !== item.title) edit.title = draft.title;
    if (draft.description.trim() !== (item.description ?? "").trim()) edit.description = draft.description;
    const criteria = criteriaLines(draft.criteria);
    if (criteria.join("\n") !== (item.acceptanceCriteria ?? []).join("\n")) edit.acceptanceCriteria = criteria;
    if (Object.keys(edit).length > 1) edits.push(edit);
  }
  return edits;
}

/** Where a v2 change-set's change lands, said before approval. */
export function changeSetPlacementLine(card: SidecarCard): string | null {
  const placement = card.changeSet?.placement;
  if (!placement) return null;
  return "target" in placement
    ? `Placed on ${placement.title} (touches ${placement.target})`
    : "No target: the change lands in the Inbox needing placement. Placing it from Sidecar comes with the Place lens.";
}

function parentLine(item: ChangeSetItem, items: readonly ChangeSetItem[]): string {
  if (item.parent !== undefined) return `under item ${item.parent + 1} (${items[item.parent]?.title ?? "?"})`;
  if (item.parentId) return `under ${item.parentId}`;
  return item.type === "change" ? "" : "at the root";
}

interface ChangeSetBodyProps {
  card: SidecarCard;
  /** The first waiting card: its fields are editable. */
  editable: boolean;
  drafts: Readonly<Record<number, ChangeSetDraft>>;
  onDraft: (index: number, draft: ChangeSetDraft) => void;
}

function ChangeSetBody({ card, editable, drafts, onDraft }: ChangeSetBodyProps) {
  const changeSet = card.changeSet!;
  const placement = changeSetPlacementLine(card);
  const written = card.carriedOut;
  return h("div", { class: "sidecar-change-set" },
    placement
      ? h("p", { class: `sidecar-change-set-placement${"inbox" in changeSet.placement! ? " sidecar-change-set-inbox" : ""}` }, placement)
      : null,
    h("ol", { class: "sidecar-change-set-items" },
      changeSet.items.map((item, index) => {
        const draft = drafts[index] ?? draftOf(item);
        const set = (field: keyof ChangeSetDraft) => (e: Event) =>
          onDraft(index, { ...draft, [field]: (e.target as HTMLInputElement | HTMLTextAreaElement).value });
        const label = `item ${index + 1}`;
        return h("li", { class: "sidecar-change-set-item", "data-index": index },
          h("div", { class: "sidecar-change-set-item-head" },
            h("span", { class: "sidecar-change-set-type" }, itemTypeLabel(item.type)),
            h("span", { class: "sidecar-change-set-parent" }, parentLine(item, changeSet.items)),
          ),
          item.duplicate
            ? h("p", { class: "sidecar-change-set-duplicate", role: "note" },
                `Matches existing ${itemTypeLabel(item.duplicate.type).toLowerCase()} "${item.duplicate.title}" (${item.duplicate.id}, ${item.duplicate.status})`)
            : null,
          editable
            ? h("div", { class: "sidecar-change-set-fields" },
                h("input", { type: "text", class: "sidecar-change-set-title", "aria-label": `Title of ${label}`, value: draft.title, onInput: set("title") }),
                h("textarea", { class: "sidecar-change-set-description", "aria-label": `Description of ${label}`, rows: 2, value: draft.description, onInput: set("description") }),
                h("textarea", { class: "sidecar-change-set-criteria", "aria-label": `Done when (one per line) for ${label}`, rows: 2, placeholder: "Done when… (one per line)", value: draft.criteria, onInput: set("criteria") }),
              )
            : h("div", { class: "sidecar-change-set-fields" },
                h("p", { class: "sidecar-change-set-title" }, item.title, written?.ids?.[index] ? h("code", null, ` ${written.ids[index]}`) : null),
                item.description ? h("p", { class: "sidecar-change-set-description" }, item.description) : null,
                item.acceptanceCriteria?.length
                  ? h("ul", { class: "sidecar-change-set-criteria", "aria-label": "Done when" }, item.acceptanceCriteria.map((c) => h("li", null, c)))
                  : null,
              ),
        );
      }),
    ),
    written
      ? h("p", { class: "sidecar-change-set-written" },
          written.ok ? `Written${card.edited ? " with your edits" : ""}: ${written.ids?.length ?? 0} items` : "Nothing was written; the agent was told why")
      : null,
  );
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
  /** The first waiting change-set card's edits, by item index. */
  drafts: Readonly<Record<number, ChangeSetDraft>>;
  onDraft: (index: number, draft: ChangeSetDraft) => void;
}

function SidecarCardView({ card, cliName, first, manifest, note, onNote, deciding, onDecide, drafts, onDraft }: CardProps) {
  const state = sidecarCardState(card);
  const input = h("pre", { class: "sidecar-card-input" }, JSON.stringify(card.input, null, 2));
  const editable = first && state === "pending";
  // A change-set card's body is its items; the raw input stays behind a disclosure.
  const body = card.changeSet
    ? [
        h(ChangeSetBody, { card, editable, drafts: editable ? drafts : {}, onDraft }),
        h("details", { class: "sidecar-card-details" }, h("summary", null, "Input"), input),
      ]
    : state === "pending"
      ? input
      : h("details", { class: "sidecar-card-details" }, h("summary", null, "Input"), input);
  return h("li", { class: `sidecar-card sidecar-card--${state}`, "data-card": card.id, "data-kind": card.kind },
    h("div", { class: "sidecar-card-head" },
      h("span", { class: "sidecar-card-kind" }, SIDECAR_CARD_KIND_LABELS[card.kind] ?? card.kind),
      h("span", { class: "sidecar-card-title" }, sidecarCardTitle(card, cliName)),
    ),
    card.kind === "command" ? h("div", { class: "sidecar-card-effects" }, sidecarCommandEffectsLine(card, manifest)) : null,
    card.preview !== undefined
      ? h("pre", { class: "sidecar-card-preview", "aria-label": "What this would run" }, card.preview)
      : null,
    body,
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
              h("button", { type: "button", class: "sidecar-card-approve", disabled: deciding, onClick: () => onDecide({ approve: true }) },
                card.changeSet ? `Approve and write ${card.changeSet.items.length} ${card.changeSet.items.length === 1 ? "item" : "items"}` : "Approve"),
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
  const [drafts, setDrafts] = useState<Record<number, ChangeSetDraft>>({});
  const [deciding, setDeciding] = useState(false);
  const firstId = first?.id ?? null;

  // A note, and a change set's edits, belong to the card they were typed on.
  useEffect(() => { setNote(""); setDrafts({}); }, [firstId]);

  const answer = async (decision: SidecarCardDecision) => {
    if (!first || deciding) return;
    setDeciding(true);
    try {
      // An approval writes the operator's edits; a denial writes nothing, so it sends none.
      const edits = decision.approve && first.changeSet ? changeSetEdits(first, drafts) : [];
      await decide(first.id, edits.length > 0 ? { ...decision, edits } : decision);
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
      // A page control that already took the key (the PRD forms submit on
      // ⌘↵ from any of their fields, selects included) must not also decide
      // the agent's card.
      if (!action || e.defaultPrevented || isTextField(e.target)) return;
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
      drafts,
      onDraft: (index: number, draft: ChangeSetDraft) => setDrafts((prev) => ({ ...prev, [index]: draft })),
    })),
  );
}
