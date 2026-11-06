/**
 * The item-edit card's body (`propose_item_edit`): each field the agent
 * changes, before and after. A list field (done-when, tags) marks each entry
 * removed, added or kept. While the card is the first waiting one, the
 * proposed values are editable, and the approval sends only the fields the
 * operator changed; the server writes the card's values with them.
 */

import { h } from "preact";
import type { SidecarCard, SidecarItemEditFields } from "../hooks/sidecar.js";

type ItemEdit = NonNullable<SidecarCard["itemEdit"]>;
type Field = keyof SidecarItemEditFields;

/** The fields in the order the card lists them. */
const FIELDS: readonly Field[] = ["title", "description", "acceptanceCriteria", "tags", "priority"];
const PRIORITIES = ["critical", "high", "medium", "low"] as const;

const LABELS: Readonly<Record<Field, string>> = {
  title: "Title",
  description: "Description",
  acceptanceCriteria: "Done when",
  tags: "Tags",
  priority: "Priority",
};

/** The card's fields as the operator is editing them: lists one entry per line. */
export type ItemEditDraft = Partial<Record<Field, string>>;

const isList = (field: Field): field is "acceptanceCriteria" | "tags" => field === "acceptanceCriteria" || field === "tags";
const lines = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter(Boolean);

function fieldsOf(itemEdit: ItemEdit): Field[] {
  return FIELDS.filter((field) => field in itemEdit.after);
}

function textOf(value: SidecarItemEditFields[Field]): string {
  return Array.isArray(value) ? value.join("\n") : value ?? "";
}

/** The draft a card starts with: the agent's proposed values. */
export function itemEditDraftOf(itemEdit: ItemEdit): ItemEditDraft {
  return Object.fromEntries(fieldsOf(itemEdit).map((field) => [field, textOf(itemEdit.after[field])]));
}

/** The edits an approval sends: only the fields whose draft differs from the proposed value. */
export function itemEditEdits(itemEdit: ItemEdit, draft: ItemEditDraft): SidecarItemEditFields {
  const edits: Record<string, unknown> = {};
  for (const field of fieldsOf(itemEdit)) {
    const text = draft[field];
    if (text === undefined) continue;
    const proposed = itemEdit.after[field];
    if (isList(field)) {
      const list = lines(text);
      if (list.join("\n") !== textOf(proposed)) edits[field] = list;
    } else if ((field === "description" ? text : text.trim()) !== textOf(proposed)) {
      edits[field] = field === "description" ? text : text.trim();
    }
  }
  return edits as SidecarItemEditFields;
}

/** A list field's entries, each marked removed, added or kept. */
export function listDiff(before: readonly string[], after: readonly string[]): Array<{ text: string; mark: "removed" | "added" | "kept" }> {
  return [
    ...before.filter((entry) => !after.includes(entry)).map((text) => ({ text, mark: "removed" as const })),
    ...after.map((text) => ({ text, mark: before.includes(text) ? "kept" as const : "added" as const })),
  ];
}

const MARK_PREFIX = { removed: "− ", added: "+ ", kept: "  " } as const;

function ListDiff({ field, before, after }: { field: Field; before: readonly string[]; after: readonly string[] }) {
  return h("ul", { class: "sidecar-item-edit-list", "aria-label": `${LABELS[field]}, before and after` },
    listDiff(before, after).map(({ text, mark }) =>
      h("li", { class: `sidecar-item-edit-${mark}` }, h("span", { "aria-hidden": "true" }, MARK_PREFIX[mark]), mark === "kept" ? text : h(mark === "added" ? "ins" : "del", null, text))));
}

function ValueDiff({ before, after }: { before: string; after: string }) {
  return h("div", { class: "sidecar-item-edit-value" },
    h("del", { class: "sidecar-item-edit-removed" }, before || "(none)"),
    h("ins", { class: "sidecar-item-edit-added" }, after || "(none)"),
  );
}

function FieldEditor({ field, value, onInput }: { field: Field; value: string; onInput: (value: string) => void }) {
  const label = field === "acceptanceCriteria" || field === "tags" ? `${LABELS[field]} (one per line)` : LABELS[field];
  const set = (e: Event) => onInput((e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value);
  if (field === "priority") {
    return h("select", { class: "sidecar-item-edit-input", "aria-label": `Proposed ${label}`, value, onChange: set },
      PRIORITIES.map((p) => h("option", { value: p }, p)));
  }
  if (field === "title") return h("input", { type: "text", class: "sidecar-item-edit-input", "aria-label": `Proposed ${label}`, value, onInput: set });
  return h("textarea", { class: "sidecar-item-edit-input", "aria-label": `Proposed ${label}`, rows: field === "tags" ? 2 : 3, value, onInput: set });
}

export interface ItemEditBodyProps {
  card: SidecarCard;
  /** The first waiting card: its proposed values are editable. */
  editable: boolean;
  draft: ItemEditDraft;
  onDraft: (draft: ItemEditDraft) => void;
}

export function ItemEditBody({ card, editable, draft, onDraft }: ItemEditBodyProps) {
  const itemEdit = card.itemEdit!;
  const written = card.carriedOut;
  return h("div", { class: "sidecar-item-edit" },
    h("p", { class: "sidecar-item-edit-item" }, h("strong", null, itemEdit.itemId), " ", itemEdit.itemTitle),
    h("dl", { class: "sidecar-item-edit-fields" },
      fieldsOf(itemEdit).flatMap((field) => {
        const before = itemEdit.before[field];
        const proposed = itemEdit.after[field];
        // The diff follows the operator's edit, so what is shown is what Approve writes.
        const shown = editable && draft[field] !== undefined
          ? (isList(field) ? lines(draft[field]!) : draft[field]!)
          : proposed;
        return [
          h("dt", { class: "sidecar-item-edit-label" }, LABELS[field]),
          h("dd", { class: "sidecar-item-edit-field", "data-field": field },
            isList(field)
              ? h(ListDiff, { field, before: (before as string[] | undefined) ?? [], after: (shown as string[] | undefined) ?? [] })
              : h(ValueDiff, { before: textOf(before), after: textOf(shown) }),
            editable ? h(FieldEditor, { field, value: draft[field] ?? textOf(proposed), onInput: (value) => onDraft({ ...draft, [field]: value }) }) : null,
          ),
        ];
      })),
    h("p", { class: "sidecar-item-edit-note" }, written
      ? (written.ok ? `Written to the item${card.edited ? " with your edits" : ""}.` : "Nothing was written; the agent was told why.")
      : "Approve writes the values after the edit; Deny writes nothing."),
  );
}
