/**
 * Inline add form for creating child items directly within the PRD tree.
 *
 * Renders a lightweight form below a parent node, auto-inferring the child
 * level from the parent. Supports title, description, and priority fields
 * with keyboard shortcuts (Enter to submit, Escape to cancel).
 */

import { h } from "preact";
import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import type { ItemLevel, Priority } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────

export interface InlineAddFormProps {
  /** The level of the parent item (used to infer child level). */
  parentLevel: ItemLevel;
  /** The ID of the parent item. */
  parentId: string;
  /** Tree depth for indentation alignment. */
  depth: number;
  /** Called when the form is submitted. */
  onSubmit: (data: InlineAddInput) => Promise<void>;
  /** Called when the form is cancelled. */
  onCancel: () => void;
}

export interface InlineAddInput {
  title: string;
  parentId: string;
  level: ItemLevel;
  description?: string;
  priority?: string;
}

// ── Constants ────────────────────────────────────────────────────────

/** Infer child level from parent level. */
const CHILD_LEVEL: Record<string, ItemLevel> = {
  epic: "feature",
  feature: "task",
  task: "subtask",
};

const LEVEL_LABELS: Record<ItemLevel, string> = {
  epic: "Epic",
  feature: "Feature",
  task: "Task",
  subtask: "Subtask",
};

const PRIORITY_OPTIONS: Array<{ value: Priority | ""; label: string }> = [
  { value: "", label: "None" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

// ── Component ────────────────────────────────────────────────────────

export function InlineAddForm({ parentLevel, parentId, depth, onSubmit, onCancel }: InlineAddFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExtra, setShowExtra] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);

  // Auto-focus the title input on mount
  useEffect(() => {
    // Small delay to ensure DOM is ready after render
    const timer = setTimeout(() => titleRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const childLevel = CHILD_LEVEL[parentLevel];
  if (!childLevel) return null; // subtasks can't have children

  const childLabel = LEVEL_LABELS[childLevel];
  const indent = (depth + 1) * 24;

  const handleSubmit = useCallback(
    async (e?: Event) => {
      if (e) e.preventDefault();

      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        setError("Title is required");
        titleRef.current?.focus();
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        await onSubmit({
          title: trimmedTitle,
          parentId,
          level: childLevel,
          description: description.trim() || undefined,
          priority: priority || undefined,
        });
      } catch (err) {
        setError(String(err));
        setSubmitting(false);
      }
    },
    [title, description, priority, parentId, childLevel, onSubmit],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
      // Ctrl/Cmd+Enter to submit from any field
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [onCancel, handleSubmit],
  );

  const handleTitleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Enter submits from title field (unless extra fields are shown)
      if (e.key === "Enter" && !e.shiftKey && !showExtra) {
        e.preventDefault();
        handleSubmit();
      }
      handleKeyDown(e);
    },
    [handleSubmit, handleKeyDown, showExtra],
  );

  return h(
    "div",
    {
      class: "prd-inline-add-form",
      style: `padding-left: ${indent + 8}px`,
      onKeyDown: handleKeyDown,
    },

    // Error display
    error
      ? h("div", { class: "prd-inline-add-error", role: "alert" }, error)
      : null,

    // Main input row: icon + title + actions
    h("div", { class: "prd-inline-add-row" },
      // Level indicator
      h("span", { class: `prd-level-badge prd-level-${childLevel}` }, childLabel),

      // Title input
      h("input", {
        ref: titleRef,
        class: "prd-inline-add-title",
        type: "text",
        value: title,
        placeholder: `New ${childLabel.toLowerCase()} title...`,
        onInput: (e: Event) => {
          setTitle((e.target as HTMLInputElement).value);
          if (error) setError(null);
        },
        onKeyDown: handleTitleKeyDown,
        disabled: submitting,
        "aria-label": `New ${childLabel.toLowerCase()} title`,
      }),

      // Toggle extra fields
      h("button", {
        type: "button",
        class: `prd-inline-add-more${showExtra ? " active" : ""}`,
        onClick: () => setShowExtra(!showExtra),
        title: showExtra ? "Hide extra fields" : "Show description & priority",
        "aria-label": showExtra ? "Hide extra fields" : "Show extra fields",
        disabled: submitting,
      }, "⋯"),

      // Submit button
      h("button", {
        type: "button",
        class: "prd-inline-add-submit",
        onClick: () => handleSubmit(),
        disabled: submitting || !title.trim(),
        title: `Add ${childLabel.toLowerCase()}`,
        "aria-label": `Add ${childLabel.toLowerCase()}`,
      }, submitting ? "…" : "✓"),

      // Cancel button
      h("button", {
        type: "button",
        class: "prd-inline-add-cancel",
        onClick: onCancel,
        disabled: submitting,
        title: "Cancel (Esc)",
        "aria-label": "Cancel",
      }, "✕"),
    ),

    // Extra fields (description + priority) — shown when expanded
    showExtra
      ? h("div", { class: "prd-inline-add-extra" },
          // Description
          h("textarea", {
            class: "prd-inline-add-description",
            value: description,
            placeholder: "Description (optional)",
            onInput: (e: Event) => setDescription((e.target as HTMLTextAreaElement).value),
            onKeyDown: handleKeyDown,
            rows: 2,
            disabled: submitting,
            "aria-label": "Description",
          }),

          // Priority selector
          h("div", { class: "prd-inline-add-priority-row" },
            h("span", { class: "prd-inline-add-priority-label" }, "Priority:"),
            h("select", {
              class: "prd-inline-add-priority",
              value: priority,
              onChange: (e: Event) => setPriority((e.target as HTMLSelectElement).value),
              disabled: submitting,
              "aria-label": "Priority",
            },
              PRIORITY_OPTIONS.map((opt) =>
                h("option", { key: opt.value, value: opt.value }, opt.label),
              ),
            ),
          ),
        )
      : null,
  );
}
