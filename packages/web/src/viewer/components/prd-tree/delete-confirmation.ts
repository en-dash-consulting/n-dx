/**
 * Modal confirmation dialog for deleting PRD items.
 *
 * Renders a centered overlay dialog that warns users about deletion
 * consequences (including child items that will be removed) and
 * requires explicit confirmation before proceeding.
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import type { PRDItemData, ItemLevel } from "./types.js";
import { countDescendants } from "./tree-utils.js";

const LEVEL_LABELS: Record<ItemLevel, string> = {
  epic: "Epic",
  feature: "Feature",
  task: "Task",
  subtask: "Subtask",
};

export interface DeleteConfirmationProps {
  /** The item targeted for deletion. */
  item: PRDItemData;
  /** Called with the item ID when the user confirms deletion. */
  onConfirm: (id: string) => Promise<void>;
  /** Called when the user cancels (closes the dialog). */
  onCancel: () => void;
}

export function DeleteConfirmation({ item, onConfirm, onCancel }: DeleteConfirmationProps) {
  const [deleting, setDeleting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const levelLabel = LEVEL_LABELS[item.level] || item.level;
  const descendantCount = countDescendants(item);

  // Focus the cancel button on mount for keyboard accessibility
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) {
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel, deleting]);

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (e: MouseEvent) => {
      if (deleting) return;
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onCancel();
      }
    },
    [onCancel, deleting],
  );

  const handleConfirm = useCallback(async () => {
    setDeleting(true);
    try {
      await onConfirm(item.id);
    } catch {
      setDeleting(false);
    }
  }, [onConfirm, item.id]);

  return h(
    "div",
    {
      class: "delete-modal-backdrop",
      onClick: handleBackdropClick,
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "delete-modal-title",
    },
    h(
      "div",
      { ref: dialogRef, class: "delete-modal" },

      // Header
      h(
        "div",
        { class: "delete-modal-header" },
        h("span", { class: "delete-modal-icon" }, "\u26A0"),
        h("span", { id: "delete-modal-title", class: "delete-modal-title" }, `Delete ${levelLabel}`),
      ),

      // Body
      h(
        "div",
        { class: "delete-modal-body" },

        // Item info
        h(
          "div",
          { class: "delete-modal-item" },
          h("span", { class: `prd-level-badge prd-level-${item.level}` }, levelLabel),
          h("span", { class: "delete-modal-item-title" }, item.title),
        ),

        // Warning message
        descendantCount > 0
          ? h(
              "div",
              { class: "delete-modal-warning" },
              h("span", { class: "delete-modal-warning-icon" }, "\u26A0"),
              h(
                "span",
                null,
                `This will also permanently delete ${descendantCount} child item${descendantCount !== 1 ? "s" : ""}.`,
              ),
            )
          : null,

        h("p", { class: "delete-modal-message" }, "This action cannot be undone."),
      ),

      // Footer actions
      h(
        "div",
        { class: "delete-modal-actions" },
        h(
          "button",
          {
            ref: cancelRef,
            class: "delete-modal-cancel-btn",
            onClick: onCancel,
            disabled: deleting,
          },
          "Cancel",
        ),
        h(
          "button",
          {
            class: "delete-modal-confirm-btn",
            onClick: handleConfirm,
            disabled: deleting,
          },
          deleting ? "Deleting\u2026" : `Delete ${levelLabel}`,
        ),
      ),
    ),
  );
}
