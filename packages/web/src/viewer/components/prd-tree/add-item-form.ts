/**
 * Add item form for creating new PRD items.
 *
 * Provides a form with type selection, title input, optional description,
 * priority, and parent constraint. The form validates level/parent
 * relationships and provides real-time feedback.
 */

import { h } from "preact";
import { useState, useCallback, useMemo } from "preact/hooks";
import type { PRDItemData, ItemLevel, Priority } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────

export interface AddItemFormProps {
  /** All items in the document, for parent selection. */
  allItems: PRDItemData[];
  /** Called when the form is submitted. */
  onSubmit: (data: AddItemInput) => Promise<void>;
  /** Called when the form is cancelled/closed. */
  onCancel: () => void;
  /** Pre-selected parent ID (e.g., from right-clicking an item). */
  defaultParentId?: string | null;
}

export interface AddItemInput {
  title: string;
  level?: string;
  parentId?: string;
  description?: string;
  priority?: string;
  tags?: string[];
  acceptanceCriteria?: string[];
}

// ── Constants ────────────────────────────────────────────────────────

const LEVEL_OPTIONS: Array<{ value: ItemLevel; label: string }> = [
  { value: "epic", label: "Epic" },
  { value: "feature", label: "Feature" },
  { value: "task", label: "Task" },
  { value: "subtask", label: "Subtask" },
];

const PRIORITY_OPTIONS: Array<{ value: Priority | ""; label: string }> = [
  { value: "", label: "None" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

/** Valid parent levels for each item level. */
const LEVEL_HIERARCHY: Record<ItemLevel, Array<ItemLevel | null>> = {
  epic: [null],
  feature: ["epic"],
  task: ["feature", "epic"],
  subtask: ["task"],
};

/** Infer child level from parent level. */
const CHILD_LEVEL: Record<string, ItemLevel> = {
  epic: "feature",
  feature: "task",
  task: "subtask",
};

// ── Helpers ──────────────────────────────────────────────────────────

/** Flatten the tree for parent selection. */
function flattenItems(items: PRDItemData[], depth = 0): Array<{ item: PRDItemData; depth: number }> {
  const result: Array<{ item: PRDItemData; depth: number }> = [];
  for (const item of items) {
    result.push({ item, depth });
    if (item.children && item.children.length > 0) {
      result.push(...flattenItems(item.children, depth + 1));
    }
  }
  return result;
}

/** Check if a level is allowed under a given parent level. */
function isValidParent(childLevel: ItemLevel, parentLevel: ItemLevel | null): boolean {
  const allowed = LEVEL_HIERARCHY[childLevel];
  if (parentLevel === null) return allowed.includes(null);
  return allowed.includes(parentLevel);
}

// ── Component ────────────────────────────────────────────────────────

export function AddItemForm({ allItems, onSubmit, onCancel, defaultParentId }: AddItemFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState<ItemLevel | "">(defaultParentId ? "" : "epic");
  const [parentId, setParentId] = useState<string>(defaultParentId ?? "");
  const [priority, setPriority] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flatten items for parent selector
  const flatItems = useMemo(() => flattenItems(allItems), [allItems]);

  // Auto-infer level when parent changes
  const effectiveLevel = useMemo<ItemLevel | "">(() => {
    if (level) return level;
    if (parentId) {
      const parent = flatItems.find((f) => f.item.id === parentId);
      if (parent) {
        return CHILD_LEVEL[parent.item.level] ?? "";
      }
    }
    return "epic";
  }, [level, parentId, flatItems]);

  // Filter parent options based on selected level
  const validParents = useMemo(() => {
    if (!effectiveLevel) return flatItems;
    return flatItems.filter((f) => isValidParent(effectiveLevel, f.item.level));
  }, [effectiveLevel, flatItems]);

  // Determine if the selected level can be a root item
  const canBeRoot = effectiveLevel ? LEVEL_HIERARCHY[effectiveLevel].includes(null) : true;

  const handleSubmit = useCallback(
    async (e: Event) => {
      e.preventDefault();
      if (!title.trim()) {
        setError("Title is required");
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        await onSubmit({
          title: title.trim(),
          level: effectiveLevel || undefined,
          parentId: parentId || undefined,
          description: description.trim() || undefined,
          priority: priority || undefined,
        });
        // Reset form on success
        setTitle("");
        setDescription("");
        setLevel("");
        setParentId("");
        setPriority("");
      } catch (err) {
        setError(String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [title, effectiveLevel, parentId, description, priority, onSubmit],
  );

  const levelLabel = effectiveLevel
    ? LEVEL_OPTIONS.find((o) => o.value === effectiveLevel)?.label ?? effectiveLevel
    : "item";

  return h(
    "form",
    { class: "rex-add-form", onSubmit: handleSubmit },

    // Header
    h("div", { class: "rex-add-form-header" },
      h("h3", { class: "rex-add-form-title" }, "Add New Item"),
      h("button", {
        type: "button",
        class: "rex-add-form-close",
        onClick: onCancel,
        "aria-label": "Close",
      }, "\u00d7"),
    ),

    // Error display
    error
      ? h("div", { class: "rex-add-form-error", role: "alert", "aria-live": "assertive" }, error)
      : null,

    // Level selector
    h("div", { class: "rex-add-form-field" },
      h("label", { class: "rex-add-form-label" }, "Type"),
      h("div", { class: "rex-add-form-level-group" },
        LEVEL_OPTIONS.map((opt) =>
          h("button", {
            key: opt.value,
            type: "button",
            class: `rex-add-form-level-btn prd-level-${opt.value}${effectiveLevel === opt.value ? " active" : ""}`,
            onClick: () => {
              setLevel(opt.value);
              // Clear parent if it's incompatible
              if (parentId) {
                const parent = flatItems.find((f) => f.item.id === parentId);
                if (parent && !isValidParent(opt.value, parent.item.level)) {
                  setParentId("");
                }
              }
              // Clear parent if the level must be root
              if (LEVEL_HIERARCHY[opt.value].length === 1 && LEVEL_HIERARCHY[opt.value][0] === null) {
                setParentId("");
              }
            },
          }, opt.label),
        ),
      ),
    ),

    // Parent selector (hidden for epic)
    effectiveLevel !== "epic"
      ? h("div", { class: "rex-add-form-field" },
          h("label", { class: "rex-add-form-label" }, "Parent"),
          h("select", {
            class: "rex-add-form-select",
            value: parentId,
            onChange: (e: Event) => {
              const val = (e.target as HTMLSelectElement).value;
              setParentId(val);
              // Auto-infer level from parent if not explicitly set
              if (val && !level) {
                const parent = flatItems.find((f) => f.item.id === val);
                if (parent) {
                  const inferred = CHILD_LEVEL[parent.item.level];
                  if (inferred) setLevel(inferred);
                }
              }
            },
          },
            canBeRoot
              ? h("option", { value: "" }, "(root item)")
              : h("option", { value: "", disabled: true }, "Select a parent..."),
            validParents.map((f) =>
              h("option", { key: f.item.id, value: f.item.id },
                `${"  ".repeat(f.depth)}${f.item.title} (${f.item.level})`,
              ),
            ),
          ),
        )
      : null,

    // Title
    h("div", { class: "rex-add-form-field" },
      h("label", { class: "rex-add-form-label" }, "Title"),
      h("input", {
        class: "rex-add-form-input",
        type: "text",
        value: title,
        placeholder: `Enter ${levelLabel} title...`,
        onInput: (e: Event) => setTitle((e.target as HTMLInputElement).value),
        required: true,
        ref: (el: HTMLInputElement | null) => el?.focus(),
      }),
    ),

    // Description
    h("div", { class: "rex-add-form-field" },
      h("label", { class: "rex-add-form-label" }, "Description ", h("span", { class: "rex-add-form-optional" }, "(optional)")),
      h("textarea", {
        class: "rex-add-form-textarea",
        value: description,
        placeholder: "Describe the item...",
        onInput: (e: Event) => setDescription((e.target as HTMLTextAreaElement).value),
        rows: 3,
      }),
    ),

    // Priority
    h("div", { class: "rex-add-form-field" },
      h("label", { class: "rex-add-form-label" }, "Priority"),
      h("select", {
        class: "rex-add-form-select",
        value: priority,
        onChange: (e: Event) => setPriority((e.target as HTMLSelectElement).value),
      },
        PRIORITY_OPTIONS.map((opt) =>
          h("option", { key: opt.value, value: opt.value }, opt.label),
        ),
      ),
    ),

    // Actions
    h("div", { class: "rex-add-form-actions" },
      h("button", {
        type: "button",
        class: "rex-add-form-btn rex-add-form-btn-cancel",
        onClick: onCancel,
      }, "Cancel"),
      h("button", {
        type: "submit",
        class: "rex-add-form-btn rex-add-form-btn-submit",
        disabled: submitting || !title.trim(),
      }, submitting ? "Adding..." : `Add ${levelLabel}`),
    ),
  );
}
