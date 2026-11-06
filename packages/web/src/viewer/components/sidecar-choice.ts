/**
 * The choice card's body (`ask_choice`): the agent's question with an option
 * per row (a radio, or a checkbox when several may be picked), an Other row
 * for free text, and a Send button. Arrow keys move between rows (and select
 * them for a single-answer question, as a radio group does). Sending approves
 * the card with the answer; the agent reads it as the tool result.
 */

import { h } from "preact";
import { useRef } from "preact/hooks";
import type { SidecarCard, SidecarChoiceAnswer } from "../hooks/sidecar.js";

/** The row the operator picked: the labels of the options, and the Other text when that row is on. */
export interface ChoiceDraft {
  selected: string[];
  /** The Other row is picked (so its text counts). */
  otherOn: boolean;
  other: string;
}

export const EMPTY_CHOICE_DRAFT: ChoiceDraft = { selected: [], otherOn: false, other: "" };

/** The answer a draft sends, or null while it is not one (nothing picked, or Other picked with no text). */
export function choiceAnswerOf(draft: ChoiceDraft): SidecarChoiceAnswer | null {
  const other = draft.otherOn ? draft.other.trim() : "";
  if (draft.otherOn && !other) return null;
  if (draft.selected.length === 0 && !other) return null;
  return { selected: draft.selected, ...(other && { other }) };
}

/** A draft with `label` toggled; a single-answer question holds one pick, Other included. */
export function toggleChoice(draft: ChoiceDraft, label: string, multiSelect: boolean): ChoiceDraft {
  const on = draft.selected.includes(label);
  if (!multiSelect) return { selected: [label], otherOn: false, other: draft.other };
  return { ...draft, selected: on ? draft.selected.filter((s) => s !== label) : [...draft.selected, label] };
}

/** A draft with the Other row toggled. */
export function toggleOther(draft: ChoiceDraft, multiSelect: boolean): ChoiceDraft {
  if (!multiSelect) return { selected: [], otherOn: true, other: draft.other };
  return { ...draft, otherOn: !draft.otherOn };
}

/** What a settled card says was answered. */
export function choiceAnswerLine(answer: SidecarChoiceAnswer): string {
  return [...answer.selected, ...(answer.other ? [`Other: ${answer.other}`] : [])].join(" · ");
}

export interface ChoiceBodyProps {
  card: SidecarCard;
  /** The first waiting card: rows can be picked. */
  editable: boolean;
  draft: ChoiceDraft;
  onDraft: (draft: ChoiceDraft) => void;
  /** Send, when the draft is an answer. */
  onSend: () => void;
}

export function ChoiceBody({ card, editable, draft, onDraft, onSend }: ChoiceBodyProps) {
  const choice = card.choice!;
  const { multiSelect } = choice;
  const group = useRef<HTMLDivElement>(null);
  const answer = choice.answer;
  const rowCount = choice.options.length + 1;
  const kind = multiSelect ? "checkbox" : "radio";

  // ↑/↓ (and ←/→) move focus between rows; for a single answer the row focused is the one picked.
  const move = (e: KeyboardEvent, row: number) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = (row + step + rowCount) % rowCount;
    const target = group.current?.querySelectorAll<HTMLInputElement>('input[data-choice-row]')[next];
    target?.focus();
    if (!multiSelect && target) {
      if (next === choice.options.length) onDraft(toggleOther(draft, false));
      else onDraft(toggleChoice(draft, choice.options[next]!.label, false));
    }
  };

  // One tab stop for a single-answer group: the picked row, else the first. A checkbox group tabs through every row.
  const stopRow = draft.otherOn ? choice.options.length : Math.max(0, choice.options.findIndex((o) => draft.selected.includes(o.label)));
  const tabIndexOf = (row: number): number => (multiSelect || !editable || row === stopRow ? 0 : -1);
  const picked = (label: string) => (answer ? answer.selected.includes(label) : draft.selected.includes(label));
  const otherPicked = answer ? !!answer.other : draft.otherOn;

  return h("div", { class: "sidecar-choice" },
    h("p", { class: "sidecar-choice-question", id: `choice-${card.id}` }, choice.question),
    h("div", {
      class: "sidecar-choice-rows", ref: group,
      role: multiSelect ? "group" : "radiogroup", "aria-labelledby": `choice-${card.id}`,
    },
      choice.options.map((option, row) => {
        const on = picked(option.label);
        return h("label", { class: `sidecar-choice-row${on ? " is-selected" : ""}`, key: option.label },
          h("input", {
            type: kind, name: `choice-${card.id}`, "data-choice-row": "", checked: on, disabled: !editable,
            tabIndex: tabIndexOf(row),
            onChange: () => onDraft(toggleChoice(draft, option.label, multiSelect)),
            onKeyDown: (e: KeyboardEvent) => move(e, row),
          }),
          h("span", { class: "sidecar-choice-text" },
            h("span", { class: "sidecar-choice-label" }, option.label),
            option.description ? h("span", { class: "sidecar-choice-description" }, option.description) : null,
          ),
        );
      }),
      h("label", { class: `sidecar-choice-row sidecar-choice-other${otherPicked ? " is-selected" : ""}` },
        h("input", {
          type: kind, name: `choice-${card.id}`, "data-choice-row": "", checked: otherPicked, disabled: !editable,
          "aria-label": "Other",
          tabIndex: tabIndexOf(choice.options.length),
          onChange: () => onDraft(toggleOther(draft, multiSelect)),
          onKeyDown: (e: KeyboardEvent) => move(e, choice.options.length),
        }),
        h("span", { class: "sidecar-choice-text" },
          h("span", { class: "sidecar-choice-label" }, "Other"),
          answer
            ? (answer.other ? h("span", { class: "sidecar-choice-description" }, answer.other) : null)
            : h("input", {
                type: "text", class: "sidecar-choice-other-input", "aria-label": "Other answer", placeholder: "Write your own answer",
                value: draft.other, disabled: !editable,
                // Typing in Other picks it, and a single answer lets go of the options.
                onInput: (e: Event) => {
                  const other = (e.target as HTMLInputElement).value;
                  onDraft(multiSelect ? { ...draft, otherOn: true, other } : { selected: [], otherOn: true, other });
                },
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && choiceAnswerOf({ ...draft, otherOn: true })) {
                    e.preventDefault();
                    onSend();
                  }
                },
              }),
        ),
      ),
    ),
    answer ? h("p", { class: "sidecar-choice-note" }, `Answered: ${choiceAnswerLine(answer)}`) : null,
  );
}
