/**
 * Add item form for creating new PRD items.
 *
 * Provides a form with type selection, title input, optional description,
 * priority, and parent constraint. The form validates type/parent
 * relationships and provides real-time feedback.
 */

import { h } from "preact";
import { useState, useCallback, useMemo, useRef, useEffect } from "preact/hooks";
import type { PRDItemData, Priority } from "./types.js";
import { type ItemType, childTypeOf, isRootType, isValidParentType, itemTypeLabel, itemTypeOf, parentTypesOf } from "../../external.js";

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
  type?: string;
  parentId?: string;
  description?: string;
  priority?: string;
  tags?: string[];
  acceptanceCriteria?: string[];
}

// ── Constants ────────────────────────────────────────────────────────

/**
 * The types this form can create. The route behind it writes a v1 store, so
 * the product-layer types are deliberately absent — it would refuse them.
 */
const TYPE_OPTIONS: Array<{ value: ItemType; label: string }> =
  (["epic", "feature", "task", "subtask"] as const).map((value) => ({ value, label: itemTypeLabel(value) }));

const PRIORITY_OPTIONS: Array<{ value: Priority | ""; label: string }> = [
  { value: "", label: "None" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

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

// ── Component ────────────────────────────────────────────────────────

export function AddItemForm({ allItems, onSubmit, onCancel, defaultParentId }: AddItemFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ItemType | "">(defaultParentId ? "" : "epic");
  const [parentId, setParentId] = useState<string>(defaultParentId ?? "");
  const [priority, setPriority] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);

  // Ref for initial autofocus — only fires once on mount
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Flatten items for parent selector
  const flatItems = useMemo(() => flattenItems(allItems), [allItems]);

  // Auto-infer the type when the parent changes
  const effectiveType = useMemo<ItemType | "">(() => {
    if (type) return type;
    if (parentId) {
      const parent = flatItems.find((f) => f.item.id === parentId);
      if (parent) {
        return childTypeOf(itemTypeOf(parent.item)) ?? "";
      }
    }
    return "epic";
  }, [type, parentId, flatItems]);

  // Filter parent options based on the selected type
  const validParents = useMemo(() => {
    if (!effectiveType) return flatItems;
    return flatItems.filter((f) => isValidParentType(effectiveType, itemTypeOf(f.item)));
  }, [effectiveType, flatItems]);

  // Determine if the selected type can be a root item
  const canBeRoot = effectiveType ? isRootType(effectiveType) : true;

  // Title validation state
  const titleError = titleTouched && !title.trim() ? "Title is required" : null;

  const handleSubmit = useCallback(
    async (e: Event) => {
      e.preventDefault();
      setTitleTouched(true);

      if (!title.trim()) {
        setError("Title is required");
        titleRef.current?.focus();
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        await onSubmit({
          title: title.trim(),
          type: effectiveType || undefined,
          parentId: parentId || undefined,
          description: description.trim() || undefined,
          priority: priority || undefined,
        });
        // Reset form on success
        setTitle("");
        setDescription("");
        setType("");
        setParentId("");
        setPriority("");
        setTitleTouched(false);
      } catch (err) {
        setError(String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [title, effectiveType, parentId, description, priority, onSubmit],
  );

  const typeLabel = effectiveType ? itemTypeLabel(effectiveType) : "item";

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

    // Type selector
    h("div", { class: "rex-add-form-field" },
      h("label", { class: "rex-add-form-label", id: "add-form-type-label" }, "Type"),
      h("div", { class: "rex-add-form-level-group", role: "group", "aria-labelledby": "add-form-type-label" },
        TYPE_OPTIONS.map((opt) =>
          h("button", {
            key: opt.value,
            type: "button",
            class: `rex-add-form-level-btn prd-level-${opt.value}${effectiveType === opt.value ? " active" : ""}`,
            "aria-pressed": effectiveType === opt.value ? "true" : "false",
            onClick: () => {
              setType(opt.value);
              // Clear parent if it's incompatible
              if (parentId) {
                const parent = flatItems.find((f) => f.item.id === parentId);
                if (parent && !isValidParentType(opt.value, itemTypeOf(parent.item))) {
                  setParentId("");
                }
              }
              // Clear parent if the type can only sit at the root
              if (isRootType(opt.value) && parentTypesOf(opt.value).length === 0) {
                setParentId("");
              }
            },
          }, opt.label),
        ),
      ),
    ),

    // Parent selector (hidden for a root-only type)
    effectiveType !== "epic"
      ? h("div", { class: "rex-add-form-field" },
          h("label", { class: "rex-add-form-label", for: "add-form-parent" }, "Parent"),
          h("select", {
            id: "add-form-parent",
            class: "rex-add-form-select",
            value: parentId,
            onChange: (e: Event) => {
              const val = (e.target as HTMLSelectElement).value;
              setParentId(val);
              // Auto-infer the type from the parent if not explicitly set
              if (val && !type) {
                const parent = flatItems.find((f) => f.item.id === val);
                if (parent) {
                  const inferred = childTypeOf(itemTypeOf(parent.item));
                  if (inferred) setType(inferred);
                }
              }
            },
          },
            canBeRoot
              ? h("option", { value: "" }, "(root item)")
              : h("option", { value: "", disabled: true }, "Select a parent..."),
            validParents.map((f) =>
              h("option", { key: f.item.id, value: f.item.id },
                `${"  ".repeat(f.depth)}${f.item.title} (${itemTypeOf(f.item)})`,
              ),
            ),
          ),
        )
      : null,

    // Title
    h("div", { class: `rex-add-form-field${titleError ? " rex-add-form-field-error" : ""}` },
      h("label", { class: "rex-add-form-label", for: "add-form-title" }, "Title"),
      h("input", {
        id: "add-form-title",
        class: `rex-add-form-input${titleError ? " rex-add-form-input-error" : ""}`,
        type: "text",
        value: title,
        placeholder: `Enter ${typeLabel} title...`,
        onInput: (e: Event) => setTitle((e.target as HTMLInputElement).value),
        onBlur: () => setTitleTouched(true),
        required: true,
        "aria-required": "true",
        "aria-invalid": titleError ? "true" : undefined,
        "aria-describedby": titleError ? "add-form-title-error" : undefined,
        ref: titleRef,
      }),
      titleError
        ? h("div", { class: "rex-add-form-field-hint rex-add-form-field-hint-error", id: "add-form-title-error", role: "alert" }, titleError)
        : null,
    ),

    // Description
    h("div", { class: "rex-add-form-field" },
      h("label", { class: "rex-add-form-label", for: "add-form-description" },
        "Description ",
        h("span", { class: "rex-add-form-optional" }, "(optional)"),
      ),
      h("textarea", {
        id: "add-form-description",
        class: "rex-add-form-textarea",
        value: description,
        placeholder: "Describe the item...",
        onInput: (e: Event) => setDescription((e.target as HTMLTextAreaElement).value),
        rows: 3,
      }),
    ),

    // Priority
    h("div", { class: "rex-add-form-field" },
      h("label", { class: "rex-add-form-label", for: "add-form-priority" }, "Priority"),
      h("select", {
        id: "add-form-priority",
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
      }, submitting ? "Adding..." : `Add ${typeLabel}`),
    ),
  );
}
