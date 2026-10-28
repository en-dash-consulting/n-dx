/**
 * In-place criterion list editing: click a criterion to edit it, × removes
 * it, "+ criterion" appends one. An edit emptied to nothing removes.
 *
 * The edits are reported one at a time, by index, so a caller that keys its
 * criteria by id (an amendment's criteria delta) can tell an edit from a
 * removal. The detail panel's Done when list and the Inbox placement's
 * Amends criteria both render through it.
 *
 * @module viewer/components/prd-tree/criteria-editor
 */

import { h } from "preact";
import { useState, useCallback } from "preact/hooks";
import { ActionIcon } from "../action-icon.js";

export interface CriteriaEditorProps {
  label: string;
  criteria: readonly string[];
  /** Absent with `onRemove` and `onAdd`: the list is read-only. */
  onEdit?: (index: number, text: string) => void;
  onRemove?: (index: number) => void;
  onAdd?: (text: string) => void;
  /** Placeholder of the add input. */
  placeholder?: string;
  /** Element id, so a refusal can point at this list. */
  id?: string;
  /** Marks the list as the field a refusal is about. */
  invalid?: boolean;
}

export function CriteriaEditor({ label, criteria, onEdit, onRemove, onAdd, placeholder = "New acceptance criterion...", id, invalid }: CriteriaEditorProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState("");
  const editable = onEdit !== undefined;

  const handleStartEdit = useCallback((i: number) => {
    setEditingIndex(i);
    setEditDraft(criteria[i]);
  }, [criteria]);

  const handleSaveEdit = useCallback(() => {
    if (editingIndex === null) return;
    const trimmed = editDraft.trim();
    if (!trimmed) onRemove?.(editingIndex);
    else if (trimmed !== criteria[editingIndex]) onEdit?.(editingIndex, trimmed);
    setEditingIndex(null);
    setEditDraft("");
  }, [editingIndex, editDraft, criteria, onEdit, onRemove]);

  const handleAdd = useCallback(() => {
    const trimmed = addDraft.trim();
    if (trimmed) onAdd?.(trimmed);
    setAddDraft("");
    setAdding(false);
  }, [addDraft, onAdd]);

  if (criteria.length === 0 && !editable) return null;

  return h(
    "div",
    { class: `task-acceptance-criteria${invalid ? " is-invalid" : ""}`, id },
    h("div", { class: "task-section-label" }, label),
    criteria.length > 0
      ? h(
          "ul",
          { class: "task-criteria-list" },
          criteria.map((criterion, i) =>
            editingIndex === i
              ? h("li", { key: i, class: "task-criterion editing" },
                  h("input", {
                    class: "task-criterion-input",
                    type: "text",
                    value: editDraft,
                    "aria-label": `Criterion ${i + 1}`,
                    onInput: (e: Event) => setEditDraft((e.target as HTMLInputElement).value),
                    onKeyDown: (e: KeyboardEvent) => {
                      if (e.key === "Enter") { e.preventDefault(); handleSaveEdit(); }
                      if (e.key === "Escape") { setEditingIndex(null); setEditDraft(""); }
                    },
                    onBlur: handleSaveEdit,
                    ref: (el: HTMLInputElement | null) => el?.focus(),
                  }),
                )
              : h("li", {
                  key: i,
                  class: `task-criterion${editable ? " editable" : ""}`,
                  onClick: editable ? () => handleStartEdit(i) : undefined,
                  role: editable ? "button" : undefined,
                  tabIndex: editable ? 0 : undefined,
                  onKeyDown: editable
                    ? (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleStartEdit(i); } }
                    : undefined,
                },
                  h("span", { class: "task-criterion-text" }, criterion),
                  onRemove
                    ? h("button", {
                        type: "button",
                        class: "task-criterion-remove",
                        onClick: (e: Event) => { e.stopPropagation(); onRemove(i); },
                        "aria-label": `Remove criterion ${i + 1}`,
                        title: "Remove",
                      }, h(ActionIcon, { name: "close" }))
                    : null,
                ),
          ),
        )
      : null,
    onAdd
      ? adding
        ? h("div", { class: "task-criterion-add-form" },
            h("input", {
              class: "task-criterion-add-input",
              type: "text",
              value: addDraft,
              placeholder,
              "aria-label": "New criterion",
              onInput: (e: Event) => setAddDraft((e.target as HTMLInputElement).value),
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === "Enter" && addDraft.trim()) { e.preventDefault(); handleAdd(); }
                if (e.key === "Escape") { setAdding(false); setAddDraft(""); }
              },
              ref: (el: HTMLInputElement | null) => el?.focus(),
            }),
            h("button", { type: "button", class: "task-criterion-add-confirm", onClick: handleAdd, disabled: !addDraft.trim(), "aria-label": "Confirm add criterion", title: "Confirm" }, "✓"),
            h("button", { type: "button", class: "task-criterion-add-cancel", onClick: () => { setAdding(false); setAddDraft(""); }, "aria-label": "Cancel add criterion", title: "Cancel" }, h(ActionIcon, { name: "close" })),
          )
        : h("button", { type: "button", class: "task-criterion-add-btn", onClick: () => setAdding(true) }, "+ criterion")
      : null,
  );
}
