/**
 * Task detail panel for PRD items.
 *
 * Renders inside the existing DetailPanel when a PRD item is selected.
 * Shows description, acceptance criteria, metadata, and provides
 * controls for updating status, priority, and tags.
 */

import { h, Fragment } from "preact";
import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import type { PRDItemData, ItemStatus, Priority, ItemLevel, RequirementData, RequirementCategory, RequirementValidationType, TaskUsageSummary, WeeklyBudgetResolution } from "./types.js";
import type { NavigateTo } from "../../types.js";
import { formatTimestamp } from "./compute.js";
import { findItemById } from "./tree-utils.js";
import { CopyLinkButton } from "../copy-link-button.js";
import { resolveTaskUtilization } from "./task-utilization.js";
import { isWorkItem, getLevelLabel, getChildLevel } from "./levels.js";
import { useIndexMd } from "../../hooks/index.js";
import { IndexMdSectionsPanel } from "./index-md-sections.js";

// ── Types ────────────────────────────────────────────────────────────

export interface TaskDetailProps {
  item: PRDItemData;
  /** Aggregated token usage for this task across associated runs. */
  taskUsage?: TaskUsageSummary;
  /** Shared resolved weekly budget used for deterministic utilization display. */
  weeklyBudget?: WeeklyBudgetResolution | null;
  /** Whether to show token budget UI (budget bar, percentage, limit label). */
  showTokenBudget?: boolean;
  /** All items in the document, for resolving dependency references. */
  allItems: PRDItemData[];
  /** Called when an item is updated via the API. */
  onUpdate?: (id: string, updates: Partial<PRDItemData>) => void;
  /** Called to navigate to a different item in the tree. */
  onNavigateToItem?: (id: string) => void;
  /** Called to trigger Hench execution for this task. */
  onExecuteTask?: (taskId: string) => Promise<void>;
  /** Called when PRD data may have changed (e.g. after execution completes). */
  onPrdChanged?: () => void;
  /** Called to add a child item under the current item. */
  onAddChild?: (data: { title: string; parentId: string; level: ItemLevel; description?: string; priority?: string }) => Promise<void>;
  /** Called to remove/delete the current item and all its descendants. */
  onRemove?: (id: string) => Promise<void>;
  /** Navigation callback for deep-linking to other views (e.g. hench-runs). */
  navigateTo?: NavigateTo;
}

// ── Constants ────────────────────────────────────────────────────────

const STATUS_OPTIONS: Array<{ value: ItemStatus; label: string; icon: string }> = [
  { value: "pending", label: "Pending", icon: "○" },
  { value: "in_progress", label: "In Progress", icon: "◐" },
  { value: "completed", label: "Completed", icon: "●" },
  { value: "failing", label: "Failing", icon: "⚠" },
  { value: "blocked", label: "Blocked", icon: "⊘" },
  { value: "deferred", label: "Deferred", icon: "◌" },
  { value: "deleted", label: "Deleted", icon: "✕" },
];

const PRIORITY_OPTIONS: Array<{ value: Priority; label: string }> = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

// Level labels now provided by getLevelLabel() from ./levels.ts

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Sub-components ───────────────────────────────────────────────────

/** Status selector — rendered as a row of buttons. */
function StatusSelector({
  current,
  onChange,
  onRequestReason,
}: {
  current: ItemStatus;
  onChange: (status: ItemStatus) => void;
  onRequestReason?: (status: ItemStatus) => void;
}) {
  return h(
    "div",
    { class: "task-status-selector", role: "radiogroup", "aria-label": "Task status" },
    STATUS_OPTIONS.map((opt) =>
      h(
        "button",
        {
          key: opt.value,
          class: `task-status-btn prd-status-${opt.value}${current === opt.value ? " active" : ""}`,
          onClick: () => {
            if (opt.value === "failing" && onRequestReason) {
              onRequestReason(opt.value);
            } else {
              onChange(opt.value);
            }
          },
          role: "radio",
          "aria-checked": String(current === opt.value),
          title: opt.label,
        },
        h("span", { class: "task-status-btn-icon" }, opt.icon),
        h("span", { class: "task-status-btn-label" }, opt.label),
      ),
    ),
  );
}

/** Priority selector — rendered as a dropdown. */
function PrioritySelector({
  current,
  onChange,
}: {
  current: Priority | undefined;
  onChange: (priority: Priority) => void;
}) {
  return h(
    "select",
    {
      class: `task-priority-select${current ? ` prd-priority-${current}` : ""}`,
      value: current || "",
      onChange: (e: Event) => {
        const value = (e.target as HTMLSelectElement).value;
        if (value) onChange(value as Priority);
      },
      "aria-label": "Task priority",
    },
    h("option", { value: "", disabled: true }, "Set priority"),
    PRIORITY_OPTIONS.map((opt) =>
      h("option", { key: opt.value, value: opt.value }, opt.label),
    ),
  );
}

/** Inline tag editor. */
function TagEditor({
  tags,
  onUpdate,
}: {
  tags: string[];
  onUpdate: (tags: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newTag, setNewTag] = useState("");

  const handleAdd = useCallback(() => {
    const trimmed = newTag.trim().toLowerCase().replace(/\s+/g, "-");
    if (trimmed && !tags.includes(trimmed)) {
      onUpdate([...tags, trimmed]);
    }
    setNewTag("");
    setAdding(false);
  }, [newTag, tags, onUpdate]);

  const handleRemove = useCallback(
    (tag: string) => {
      onUpdate(tags.filter((t) => t !== tag));
    },
    [tags, onUpdate],
  );

  return h(
    "div",
    { class: "task-tag-editor" },
    tags.map((tag) =>
      h(
        "span",
        { key: tag, class: "task-tag" },
        tag,
        h(
          "button",
          {
            class: "task-tag-remove",
            onClick: () => handleRemove(tag),
            "aria-label": `Remove tag ${tag}`,
            title: "Remove",
          },
          "\u00d7",
        ),
      ),
    ),
    adding
      ? h(
          "span",
          { class: "task-tag-input-wrapper" },
          h("input", {
            class: "task-tag-input",
            type: "text",
            value: newTag,
            placeholder: "tag name",
            onInput: (e: Event) => setNewTag((e.target as HTMLInputElement).value),
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
              if (e.key === "Escape") { setAdding(false); setNewTag(""); }
            },
            // Auto-focus when shown
            ref: (el: HTMLInputElement | null) => el?.focus(),
          }),
          h(
            "button",
            { class: "task-tag-confirm", onClick: handleAdd, title: "Add tag" },
            "\u2713",
          ),
        )
      : h(
          "button",
          {
            class: "task-tag-add-btn",
            onClick: () => setAdding(true),
            title: "Add tag",
          },
          "+ tag",
        ),
  );
}

/** Dependency (blockedBy) display with navigation. */
function DependencyList({
  blockedBy,
  allItems,
  onNavigate,
}: {
  blockedBy: string[];
  allItems: PRDItemData[];
  onNavigate?: (id: string) => void;
}) {
  if (blockedBy.length === 0) return null;

  return h(
    "div",
    { class: "task-dependencies" },
    h("div", { class: "task-section-label" }, "Blocked By"),
    h(
      "div",
      { class: "task-dependency-list" },
      blockedBy.map((depId) => {
        const dep = findItemById(allItems, depId);
        const isResolved = dep?.status === "completed";

        return h(
          "div",
          {
            key: depId,
            class: `task-dependency-item${isResolved ? " resolved" : ""}`,
            onClick: onNavigate ? () => onNavigate(depId) : undefined,
            role: onNavigate ? "button" : undefined,
            tabIndex: onNavigate ? 0 : undefined,
          },
          h(
            "span",
            { class: `task-dep-status${isResolved ? " prd-status-completed" : " prd-status-blocked"}` },
            isResolved ? "●" : "⊘",
          ),
          h("span", { class: "task-dep-title" }, dep ? dep.title : depId),
          dep
            ? h("span", { class: `prd-level-badge prd-level-${dep.level}` }, getLevelLabel(dep.level))
            : null,
        );
      }),
    ),
  );
}

/** Editable title — click to edit inline. */
function EditableTitle({
  title,
  onUpdate,
}: {
  title: string;
  onUpdate?: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  // Sync draft when item changes externally
  useEffect(() => { setDraft(title); }, [title]);

  const handleSave = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title && onUpdate) {
      onUpdate(trimmed);
    }
    setEditing(false);
  }, [draft, title, onUpdate]);

  if (!onUpdate) {
    return h("div", { class: "task-title-display" }, title);
  }

  if (editing) {
    return h("div", { class: "task-title-edit" },
      h("input", {
        class: "task-title-input",
        type: "text",
        value: draft,
        onInput: (e: Event) => setDraft((e.target as HTMLInputElement).value),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter") { e.preventDefault(); handleSave(); }
          if (e.key === "Escape") { setDraft(title); setEditing(false); }
        },
        onBlur: handleSave,
        ref: (el: HTMLInputElement | null) => el?.focus(),
      }),
    );
  }

  return h("div", {
    class: "task-title-display editable",
    onClick: () => { setDraft(title); setEditing(true); },
    title: "Click to edit title",
    role: "button",
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDraft(title); setEditing(true); }
    },
  }, title, h("span", { class: "task-edit-icon" }, "\u270e"));
}

/** Editable description — click to edit with textarea. */
function EditableDescription({
  description,
  onUpdate,
}: {
  description?: string;
  onUpdate?: (description: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? "");

  // Sync draft when item changes externally
  useEffect(() => { setDraft(description ?? ""); }, [description]);

  const handleSave = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed !== (description ?? "") && onUpdate) {
      onUpdate(trimmed);
    }
    setEditing(false);
  }, [draft, description, onUpdate]);

  if (!onUpdate) {
    return description
      ? h("div", { class: "task-description" }, description)
      : null;
  }

  if (editing) {
    return h("div", { class: "task-description-edit" },
      h("textarea", {
        class: "task-description-textarea",
        value: draft,
        rows: Math.max(3, (draft.match(/\n/g) ?? []).length + 2),
        onInput: (e: Event) => setDraft((e.target as HTMLTextAreaElement).value),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSave(); }
          if (e.key === "Escape") { setDraft(description ?? ""); setEditing(false); }
        },
        ref: (el: HTMLTextAreaElement | null) => el?.focus(),
      }),
      h("div", { class: "task-edit-actions" },
        h("button", { class: "task-edit-save", onClick: handleSave }, "Save"),
        h("button", { class: "task-edit-cancel", onClick: () => { setDraft(description ?? ""); setEditing(false); } }, "Cancel"),
        h("span", { class: "task-edit-hint" }, "Ctrl+Enter to save"),
      ),
    );
  }

  if (!description) {
    return h("button", {
      class: "task-add-description-btn",
      onClick: () => { setDraft(""); setEditing(true); },
    }, "+ Add description");
  }

  return h("div", {
    class: "task-description editable",
    onClick: () => { setDraft(description ?? ""); setEditing(true); },
    title: "Click to edit description",
    role: "button",
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDraft(description ?? ""); setEditing(true); }
    },
  }, description, h("span", { class: "task-edit-icon" }, "\u270e"));
}

/** Editable acceptance criteria — add, edit, remove individual items. */
function EditableAcceptanceCriteria({
  criteria,
  onUpdate,
}: {
  criteria: string[];
  onUpdate?: (criteria: string[]) => void;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState("");

  const handleStartEdit = useCallback((i: number) => {
    setEditingIndex(i);
    setEditDraft(criteria[i]);
  }, [criteria]);

  const handleSaveEdit = useCallback(() => {
    if (editingIndex === null || !onUpdate) return;
    const trimmed = editDraft.trim();
    if (!trimmed) {
      // Empty means remove
      onUpdate(criteria.filter((_, i) => i !== editingIndex));
    } else if (trimmed !== criteria[editingIndex]) {
      const updated = [...criteria];
      updated[editingIndex] = trimmed;
      onUpdate(updated);
    }
    setEditingIndex(null);
    setEditDraft("");
  }, [editingIndex, editDraft, criteria, onUpdate]);

  const handleRemove = useCallback((i: number) => {
    if (!onUpdate) return;
    onUpdate(criteria.filter((_, idx) => idx !== i));
  }, [criteria, onUpdate]);

  const handleAdd = useCallback(() => {
    const trimmed = addDraft.trim();
    if (trimmed && onUpdate) {
      onUpdate([...criteria, trimmed]);
    }
    setAddDraft("");
    setAdding(false);
  }, [addDraft, criteria, onUpdate]);

  if (criteria.length === 0 && !onUpdate) return null;

  return h(
    "div",
    { class: "task-acceptance-criteria" },
    h("div", { class: "task-section-label" }, "Acceptance Criteria"),
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
                  class: `task-criterion${onUpdate ? " editable" : ""}`,
                  onClick: onUpdate ? () => handleStartEdit(i) : undefined,
                  role: onUpdate ? "button" : undefined,
                  tabIndex: onUpdate ? 0 : undefined,
                  onKeyDown: onUpdate
                    ? (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleStartEdit(i); } }
                    : undefined,
                },
                  h("span", { class: "task-criterion-text" }, criterion),
                  onUpdate
                    ? h("button", {
                        class: "task-criterion-remove",
                        onClick: (e: Event) => { e.stopPropagation(); handleRemove(i); },
                        "aria-label": `Remove criterion ${i + 1}`,
                        title: "Remove",
                      }, "\u00d7")
                    : null,
                ),
          ),
        )
      : null,
    // Add new criterion
    onUpdate
      ? adding
        ? h("div", { class: "task-criterion-add-form" },
            h("input", {
              class: "task-criterion-add-input",
              type: "text",
              value: addDraft,
              placeholder: "New acceptance criterion...",
              onInput: (e: Event) => setAddDraft((e.target as HTMLInputElement).value),
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === "Enter" && addDraft.trim()) { e.preventDefault(); handleAdd(); }
                if (e.key === "Escape") { setAdding(false); setAddDraft(""); }
              },
              ref: (el: HTMLInputElement | null) => el?.focus(),
            }),
            h("button", { class: "task-criterion-add-confirm", onClick: handleAdd, disabled: !addDraft.trim() }, "\u2713"),
            h("button", { class: "task-criterion-add-cancel", onClick: () => { setAdding(false); setAddDraft(""); } }, "\u00d7"),
          )
        : h("button", { class: "task-criterion-add-btn", onClick: () => setAdding(true) }, "+ criterion")
      : null,
  );
}

/** Children summary — shows direct children with their status. */
function ChildrenSummary({
  children,
  onNavigate,
}: {
  children: PRDItemData[];
  onNavigate?: (id: string) => void;
}) {
  if (children.length === 0) return null;

  const statusIcons: Record<string, string> = {
    completed: "●",
    in_progress: "◐",
    pending: "○",
    blocked: "⊘",
    deferred: "◌",
  };

  return h(
    "div",
    { class: "task-children-summary" },
    h("div", { class: "task-section-label" }, `Children (${children.length})`),
    h(
      "div",
      { class: "task-children-list" },
      children.map((child) =>
        h(
          "div",
          {
            key: child.id,
            class: "task-child-item",
            onClick: onNavigate ? () => onNavigate(child.id) : undefined,
            role: onNavigate ? "button" : undefined,
            tabIndex: onNavigate ? 0 : undefined,
          },
          h("span", { class: `prd-status-icon prd-status-${child.status}` }, statusIcons[child.status] || "○"),
          h("span", { class: `prd-level-badge prd-level-${child.level}` }, getLevelLabel(child.level)),
          h("span", { class: "task-child-title" }, child.title),
        ),
      ),
    ),
  );
}

// ── Add Child Form ────────────────────────────────────────────────────

// Child level inference now provided by getChildLevel() from ./levels.ts

/** Inline form for adding a child item within the detail panel. */
function AddChildForm({
  parentId,
  parentLevel,
  onSubmit,
  onCancel,
}: {
  parentId: string;
  parentLevel: ItemLevel;
  onSubmit: (data: { title: string; parentId: string; level: ItemLevel; description?: string; priority?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExtra, setShowExtra] = useState(false);

  const childLevel = getChildLevel(parentLevel);
  if (!childLevel) return null;

  const childLabel = getLevelLabel(childLevel);

  const handleSubmit = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required");
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
  }, [title, description, priority, parentId, childLevel, onSubmit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [onCancel, handleSubmit],
  );

  const handleTitleKeyDown = useCallback(
    (e: KeyboardEvent) => {
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
    { class: "task-add-child-form", onKeyDown: handleKeyDown },

    // Error display
    error
      ? h("div", { class: "task-add-child-error", role: "alert" }, error)
      : null,

    // Main input row
    h("div", { class: "task-add-child-row" },
      h("span", { class: `prd-level-badge prd-level-${childLevel}` }, childLabel),
      h("input", {
        class: "task-add-child-title",
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
        ref: (el: HTMLInputElement | null) => el?.focus(),
      }),
    ),

    // Extra fields toggle + actions row
    h("div", { class: "task-add-child-actions" },
      h("button", {
        type: "button",
        class: `task-add-child-more${showExtra ? " active" : ""}`,
        onClick: () => setShowExtra(!showExtra),
        title: showExtra ? "Hide extra fields" : "Show description & priority",
        disabled: submitting,
      }, "\u22ef"),
      h("button", {
        type: "button",
        class: "task-add-child-submit",
        onClick: handleSubmit,
        disabled: submitting || !title.trim(),
        title: `Add ${childLabel.toLowerCase()}`,
      }, submitting ? "\u2026" : `Add ${childLabel}`),
      h("button", {
        type: "button",
        class: "task-add-child-cancel",
        onClick: onCancel,
        disabled: submitting,
        title: "Cancel (Esc)",
      }, "Cancel"),
    ),

    // Extra fields
    showExtra
      ? h("div", { class: "task-add-child-extra" },
          h("textarea", {
            class: "task-add-child-description",
            value: description,
            placeholder: "Description (optional)",
            onInput: (e: Event) => setDescription((e.target as HTMLTextAreaElement).value),
            onKeyDown: handleKeyDown,
            rows: 2,
            disabled: submitting,
          }),
          h("div", { class: "task-add-child-priority-row" },
            h("span", { class: "task-add-child-priority-label" }, "Priority:"),
            h("select", {
              class: "task-add-child-priority",
              value: priority,
              onChange: (e: Event) => setPriority((e.target as HTMLSelectElement).value),
              disabled: submitting,
            },
              h("option", { value: "" }, "None"),
              PRIORITY_OPTIONS.map((opt) =>
                h("option", { key: opt.value, value: opt.value }, opt.label),
              ),
            ),
          ),
        )
      : null,
  );
}

// ── Requirements components ───────────────────────────────────────────

const CATEGORY_LABELS: Record<RequirementCategory, string> = {
  technical: "Technical",
  performance: "Performance",
  security: "Security",
  accessibility: "Accessibility",
  compatibility: "Compatibility",
  quality: "Quality",
};

const CATEGORY_ICONS: Record<RequirementCategory, string> = {
  technical: "\u2699",   // gear
  performance: "\u26a1", // lightning
  security: "\ud83d\udd12",   // lock
  accessibility: "\u267f",  // wheelchair
  compatibility: "\ud83d\udd17", // link
  quality: "\u2605",   // star
};

const VALIDATION_TYPE_LABELS: Record<RequirementValidationType, string> = {
  automated: "Automated",
  manual: "Manual",
  metric: "Metric",
};

const CATEGORY_OPTIONS: RequirementCategory[] = [
  "technical", "performance", "security", "accessibility", "compatibility", "quality",
];

const VALIDATION_TYPE_OPTIONS: RequirementValidationType[] = [
  "automated", "manual", "metric",
];

/** Display a single requirement with category badge and validation type. */
function RequirementItem({ req }: { req: RequirementData }) {
  return h(
    "div",
    { class: `task-requirement-item req-category-${req.category}` },
    h(
      "div",
      { class: "task-requirement-header" },
      h("span", { class: `req-category-badge req-cat-${req.category}` },
        CATEGORY_ICONS[req.category] || "",
        " ",
        CATEGORY_LABELS[req.category] || req.category,
      ),
      h("span", { class: `req-validation-badge req-val-${req.validationType}` },
        VALIDATION_TYPE_LABELS[req.validationType] || req.validationType,
      ),
      req.priority
        ? h("span", { class: `prd-priority-badge prd-priority-${req.priority}` }, req.priority)
        : null,
    ),
    h("div", { class: "task-requirement-title" }, req.title),
    req.description
      ? h("div", { class: "task-requirement-description" }, req.description)
      : null,
    req.acceptanceCriteria && req.acceptanceCriteria.length > 0
      ? h(
          "ul",
          { class: "task-requirement-criteria" },
          req.acceptanceCriteria.map((c, i) =>
            h("li", { key: i }, c),
          ),
        )
      : null,
    req.validationCommand
      ? h("div", { class: "task-requirement-command" },
          h("span", { class: "label" }, "Validation: "),
          h("code", null, req.validationCommand),
          req.threshold !== undefined
            ? h("span", { class: "req-threshold" }, ` (threshold: ${req.threshold})`)
            : null,
        )
      : null,
  );
}

/** Requirements list with optional add button. */
function RequirementsList({
  requirements,
  onAdd,
  onRemove,
}: {
  requirements: RequirementData[];
  onAdd?: (req: Omit<RequirementData, "id">) => void;
  onRemove?: (reqId: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState<RequirementCategory>("technical");
  const [newValidationType, setNewValidationType] = useState<RequirementValidationType>("automated");
  const [newDescription, setNewDescription] = useState("");
  const [newCriteria, setNewCriteria] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [newPriority, setNewPriority] = useState<Priority | "">("medium");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const handleSubmit = useCallback(() => {
    if (!newTitle.trim() || !onAdd) return;
    const criteria = newCriteria
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean);

    const req: Omit<RequirementData, "id"> = {
      title: newTitle.trim(),
      category: newCategory,
      validationType: newValidationType,
      acceptanceCriteria: criteria,
    };
    if (newDescription.trim()) req.description = newDescription.trim();
    if (newCommand.trim()) req.validationCommand = newCommand.trim();
    if (newPriority) req.priority = newPriority as Priority;

    onAdd(req);
    setNewTitle("");
    setNewDescription("");
    setNewCriteria("");
    setNewCommand("");
    setNewPriority("medium");
    setShowAdd(false);
  }, [newTitle, newCategory, newValidationType, newDescription, newCriteria, newCommand, newPriority, onAdd]);

  const filteredReqs = filterCategory === "all"
    ? requirements
    : requirements.filter((r) => r.category === filterCategory);

  if (requirements.length === 0 && !showAdd) {
    return h(
      "div",
      { class: "task-requirements-empty" },
      onAdd
        ? h(
            "button",
            { class: "task-req-add-btn", onClick: () => setShowAdd(true) },
            "+ Add requirement",
          )
        : h("span", { class: "task-requirements-none" }, "No requirements"),
    );
  }

  return h(
    "div",
    { class: "task-requirements-list" },

    // Filter bar (only if more than 2 requirements)
    requirements.length > 2
      ? h(
          "div",
          { class: "task-req-filter" },
          h(
            "select",
            {
              class: "task-req-filter-select",
              value: filterCategory,
              onChange: (e: Event) => setFilterCategory((e.target as HTMLSelectElement).value),
              "aria-label": "Filter requirements by category",
            },
            h("option", { value: "all" }, `All (${requirements.length})`),
            ...CATEGORY_OPTIONS
              .filter((cat) => requirements.some((r) => r.category === cat))
              .map((cat) =>
                h("option", { key: cat, value: cat },
                  `${CATEGORY_LABELS[cat]} (${requirements.filter((r) => r.category === cat).length})`,
                ),
              ),
          ),
        )
      : null,

    // Requirements list
    filteredReqs.map((req) =>
      h(
        "div",
        { key: req.id, class: "task-requirement-wrapper" },
        h(RequirementItem, { req }),
        onRemove
          ? h(
              "button",
              {
                class: "task-req-remove-btn",
                onClick: () => onRemove(req.id),
                "aria-label": `Remove requirement ${req.title}`,
                title: "Remove",
              },
              "\u00d7",
            )
          : null,
      ),
    ),

    // Add button / form
    onAdd
      ? showAdd
        ? h(
            "div",
            { class: "task-req-add-form" },
            h("div", { class: "task-section-label" }, "New Requirement"),
            h("input", {
              class: "task-req-input",
              type: "text",
              placeholder: "Requirement title",
              value: newTitle,
              onInput: (e: Event) => setNewTitle((e.target as HTMLInputElement).value),
              ref: (el: HTMLInputElement | null) => el?.focus(),
            }),
            h(
              "div",
              { class: "task-req-selectors" },
              h(
                "select",
                {
                  class: "task-req-select",
                  value: newCategory,
                  onChange: (e: Event) => setNewCategory((e.target as HTMLSelectElement).value as RequirementCategory),
                  "aria-label": "Requirement category",
                },
                CATEGORY_OPTIONS.map((cat) =>
                  h("option", { key: cat, value: cat }, CATEGORY_LABELS[cat]),
                ),
              ),
              h(
                "select",
                {
                  class: "task-req-select",
                  value: newValidationType,
                  onChange: (e: Event) => setNewValidationType((e.target as HTMLSelectElement).value as RequirementValidationType),
                  "aria-label": "Validation type",
                },
                VALIDATION_TYPE_OPTIONS.map((vt) =>
                  h("option", { key: vt, value: vt }, VALIDATION_TYPE_LABELS[vt]),
                ),
              ),
              h(
                "select",
                {
                  class: "task-req-select",
                  value: newPriority,
                  onChange: (e: Event) => setNewPriority((e.target as HTMLSelectElement).value as Priority | ""),
                  "aria-label": "Requirement priority",
                },
                h("option", { value: "" }, "No priority"),
                PRIORITY_OPTIONS.map((opt) =>
                  h("option", { key: opt.value, value: opt.value }, opt.label),
                ),
              ),
            ),
            h("textarea", {
              class: "task-req-textarea",
              placeholder: "Description (optional)",
              value: newDescription,
              onInput: (e: Event) => setNewDescription((e.target as HTMLTextAreaElement).value),
              rows: 2,
            }),
            h("textarea", {
              class: "task-req-textarea",
              placeholder: "Acceptance criteria (one per line)",
              value: newCriteria,
              onInput: (e: Event) => setNewCriteria((e.target as HTMLTextAreaElement).value),
              rows: 3,
            }),
            h("input", {
              class: "task-req-input",
              type: "text",
              placeholder: "Validation command (optional)",
              value: newCommand,
              onInput: (e: Event) => setNewCommand((e.target as HTMLInputElement).value),
            }),
            h(
              "div",
              { class: "task-req-form-actions" },
              h("button", {
                class: "task-req-submit-btn",
                onClick: handleSubmit,
                disabled: !newTitle.trim(),
              }, "Add"),
              h("button", {
                class: "task-req-cancel-btn",
                onClick: () => setShowAdd(false),
              }, "Cancel"),
            ),
          )
        : h(
            "button",
            { class: "task-req-add-btn", onClick: () => setShowAdd(true) },
            "+ Add requirement",
          )
      : null,
  );
}

/** Statuses that allow triggering Hench execution. */
const TRIGGERABLE_STATUSES: Set<ItemStatus> = new Set(["pending", "blocked"]);

/** Execution progress state received from WebSocket. */
interface ExecProgress {
  taskId: string;
  taskTitle: string;
  runId: string;
  status: "starting" | "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  lastOutput?: string;
  error?: string;
}

/** Status labels for the execution progress indicator. */
const EXEC_STATUS_LABELS: Record<string, string> = {
  starting: "Starting\u2026",
  running: "Running\u2026",
  completed: "Completed",
  failed: "Failed",
};

/** Status icons for the execution progress indicator. */
const EXEC_STATUS_ICONS: Record<string, string> = {
  starting: "\u25d0",  // ◐
  running: "\u25d0",   // ◐
  completed: "\u25cf", // ●
  failed: "\u2716",    // ✖
};

/** Execute task button with real-time progress tracking via WebSocket. */
function ExecuteTaskButton({
  item,
  onExecute,
  onPrdChanged,
}: {
  item: PRDItemData;
  onExecute?: (taskId: string) => Promise<void>;
  onPrdChanged?: () => void;
}) {
  const [executing, setExecuting] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [execProgress, setExecProgress] = useState<ExecProgress | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isTriggerable = TRIGGERABLE_STATUSES.has(item.status);
  const isTaskLevel = isWorkItem(item.level);

  // Check initial execution status on mount (handles page refresh during execution)
  useEffect(() => {
    if (!isTaskLevel) return;
    fetch(`/api/hench/execute/status/${item.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.execution && (data.execution.status === "starting" || data.execution.status === "running")) {
          setExecProgress(data.execution);
          setExecuting(true);
        }
      })
      .catch(() => { /* ignore */ });
  }, [item.id, isTaskLevel]);

  // Connect to WebSocket for live progress when executing
  useEffect(() => {
    if (!executing) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}`;
    let ws: WebSocket;

    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "hench:task-execution-progress" && msg.state) {
            const state = msg.state as ExecProgress;
            if (state.taskId !== item.id) return;

            setExecProgress(state);

            if (state.status === "completed") {
              setExecuting(false);
              setResultMessage("Execution completed");
              // Notify parent to refresh PRD data
              if (onPrdChanged) onPrdChanged();
              resultTimerRef.current = setTimeout(() => {
                setResultMessage(null);
                setExecProgress(null);
              }, 5000);
            } else if (state.status === "failed") {
              setExecuting(false);
              setResultMessage(state.error || "Execution failed");
              if (onPrdChanged) onPrdChanged();
              resultTimerRef.current = setTimeout(() => {
                setResultMessage(null);
                setExecProgress(null);
              }, 8000);
            }
          }
          // Also listen for PRD changes during execution
          if (msg.type === "rex:prd-changed" && onPrdChanged) {
            onPrdChanged();
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    } catch {
      // WebSocket not available — fall back to polling
    }

    // Polling fallback: check execution status every 3s
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/hench/execute/status/${item.id}`);
        const data = await res.json();
        if (data.execution) {
          setExecProgress(data.execution);
          if (data.execution.status === "completed" || data.execution.status === "failed") {
            setExecuting(false);
            const isSuccess = data.execution.status === "completed";
            setResultMessage(isSuccess ? "Execution completed" : (data.execution.error || "Execution failed"));
            if (onPrdChanged) onPrdChanged();
            resultTimerRef.current = setTimeout(() => {
              setResultMessage(null);
              setExecProgress(null);
            }, isSuccess ? 5000 : 8000);
          }
        } else if (executing) {
          // No active execution found — may have completed between polls
          setExecuting(false);
          setExecProgress(null);
          if (onPrdChanged) onPrdChanged();
        }
      } catch {
        // ignore
      }
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
    };
  }, [executing, item.id, onPrdChanged]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    };
  }, []);

  if (!onExecute || !isTaskLevel) return null;

  const handleClick = useCallback(async () => {
    if (executing || !isTriggerable) return;
    setExecuting(true);
    setResultMessage(null);
    setExecProgress(null);
    if (resultTimerRef.current) {
      clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
    try {
      await onExecute(item.id);
      // Initial state will be set via WebSocket / polling
    } catch (err) {
      setExecuting(false);
      setResultMessage(err instanceof Error ? err.message : "Failed to start");
      resultTimerRef.current = setTimeout(() => setResultMessage(null), 5000);
    }
  }, [item.id, executing, isTriggerable, onExecute]);

  const isActive = execProgress && (execProgress.status === "starting" || execProgress.status === "running");
  const isDone = execProgress && (execProgress.status === "completed" || execProgress.status === "failed");

  return h(
    "div",
    { class: "task-execute-section" },

    // Execute / progress button
    h(
      "button",
      {
        class: `task-execute-btn${executing ? " executing" : ""}${!isTriggerable && !executing ? " disabled" : ""}`,
        onClick: handleClick,
        disabled: !isTriggerable || executing,
        title: !isTriggerable && !executing
          ? `Cannot execute: task is ${item.status}`
          : executing
            ? "Execution in progress\u2026"
            : "Run Hench agent on this task",
        "aria-label": "Execute task with Hench",
      },
      h("span", { class: "task-execute-icon" },
        isActive ? EXEC_STATUS_ICONS[execProgress!.status] : executing ? "\u25d0" : "\u25b6",
      ),
      h("span", { class: "task-execute-label" },
        isActive ? EXEC_STATUS_LABELS[execProgress!.status] : executing ? "Starting\u2026" : "Execute",
      ),
    ),

    // Result message (shown briefly after completion)
    resultMessage && !isActive
      ? h("span", {
          class: `task-execute-result${
            resultMessage.startsWith("Execution completed") ? " success" : " error"
          }`,
        }, resultMessage)
      : null,

    // Live progress indicator (shown during execution)
    isActive
      ? h("div", { class: "task-exec-progress" },
          // Animated progress bar
          h("div", { class: "task-exec-progress-bar" },
            h("div", { class: "task-exec-progress-fill" }),
          ),
          // Status text
          h("span", { class: `task-exec-status task-exec-status-${execProgress!.status}` },
            execProgress!.status === "running" ? "Agent is working\u2026" : "Initializing\u2026",
          ),
          // Last output snippet
          execProgress!.lastOutput
            ? h("div", { class: "task-exec-output" },
                h("code", null, execProgress!.lastOutput),
              )
            : null,
        )
      : null,

    // Completion summary
    isDone
      ? h("div", { class: `task-exec-done task-exec-done-${execProgress!.status}` },
          h("span", { class: "task-exec-done-icon" },
            execProgress!.status === "completed" ? "\u2713" : "\u2717",
          ),
          h("span", { class: "task-exec-done-text" },
            execProgress!.status === "completed"
              ? "Task execution completed"
              : `Failed: ${execProgress!.error || "Unknown error"}`,
          ),
        )
      : null,
  );
}

// ── Hench Runs list ──────────────────────────────────────────────────

/** Summary of a hench run, matching the server's RunSummary shape. */
interface RunEntry {
  id: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  turns: number;
  tokenUsage: {
    input: number;
    output: number;
    cacheCreationInput?: number;
    cacheReadInput?: number;
  };
}

function runTotalTokens(r: RunEntry): number {
  return (r.tokenUsage.input ?? 0)
    + (r.tokenUsage.output ?? 0)
    + (r.tokenUsage.cacheCreationInput ?? 0)
    + (r.tokenUsage.cacheReadInput ?? 0);
}

function fmtDuration(start: string, end?: string): string {
  if (!end) return "running\u2026";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "\u2014";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

function fmtRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 1) {
    const mins = Math.floor(diffMs / (1000 * 60));
    return mins <= 0 ? "just now" : `${mins}m ago`;
  }
  if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
  if (diffHours < 168) {
    return new Date(iso).toLocaleDateString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const RUN_STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  completed: { icon: "\u25cf", color: "var(--green)" },
  failed: { icon: "\u2715", color: "var(--red)" },
  error: { icon: "\u2715", color: "var(--red)" },
  running: { icon: "\u25d0", color: "var(--accent)" },
  in_progress: { icon: "\u25d0", color: "var(--accent)" },
};

function getRunStatusConfig(status: string) {
  return RUN_STATUS_ICONS[status] ?? { icon: "\u25cb", color: "var(--text-dim)" };
}

/** Fetches and displays hench runs associated with a task. */
function HenchRunsList({
  taskId,
  navigateTo,
}: {
  taskId: string;
  navigateTo?: NavigateTo;
}) {
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    fetch(`/api/hench/runs?taskId=${encodeURIComponent(taskId)}`)
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          setRuns(json.runs ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [taskId]);

  // Don't render the section at all while loading on first mount, or if no runs
  if (loading) return null;
  if (error) return null;
  if (runs.length === 0) return null;

  return h(
    "div",
    { class: "task-section task-runs-section" },
    h("div", { class: "task-section-label" }, `Hench Runs (${runs.length})`),
    h(
      "div",
      { class: "task-runs-list" },
      runs.map((run) => {
        const st = getRunStatusConfig(run.status);
        const tokens = runTotalTokens(run);

        return h(
          "div",
          {
            key: run.id,
            class: `task-run-entry${navigateTo ? " clickable" : ""}`,
            onClick: navigateTo
              ? () => navigateTo("hench-runs", { runId: run.id })
              : undefined,
            role: navigateTo ? "button" : undefined,
            tabIndex: navigateTo ? 0 : undefined,
            onKeyDown: navigateTo
              ? (e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigateTo("hench-runs", { runId: run.id });
                  }
                }
              : undefined,
            title: navigateTo ? "View run details" : undefined,
          },
          // Status icon + timestamp
          h("div", { class: "task-run-header" },
            h("span", { class: "task-run-status", style: `color: ${st.color}` }, st.icon),
            h("span", { class: "task-run-time" }, fmtRelativeTime(run.startedAt)),
          ),
          // Metadata chips: duration, turns, tokens
          h("div", { class: "task-run-meta" },
            h("span", { class: "task-run-chip" }, fmtDuration(run.startedAt, run.finishedAt)),
            h("span", { class: "task-run-chip" }, `${run.turns} turns`),
            h("span", { class: "task-run-chip task-run-chip-tokens" }, formatTokenCount(tokens) + " tokens"),
          ),
        );
      }),
    ),
  );
}

// ── Index.md Sections Renderer ───────────────────────────────────────────────

/** Wrapper component that fetches and renders index.md schema sections. */
function IndexMdSectionsRenderer({ itemId }: { itemId: string }) {
  const { sections, loading, error } = useIndexMd(itemId);

  // No sections available yet (index.md not generated or 404)
  if (!loading && (!sections || Object.keys(sections).length === 0)) {
    return null;
  }

  // Show error if parsing failed
  if (error) {
    return h(
      "div",
      { class: "task-section task-index-md-error" },
      h("div", { class: "task-section-label" }, "Schema Error"),
      h("p", { class: "error-message" }, error),
    );
  }

  // Render sections
  return h("div", { class: "task-index-md-sections" },
    h(IndexMdSectionsPanel, { sections: sections || {}, gitRemoteUrl: undefined }),
  );
}

// ── Main component ───────────────────────────────────────────────────

export function TaskDetail({ item, taskUsage, weeklyBudget, showTokenBudget, allItems, onUpdate, onNavigateToItem, onExecuteTask, onPrdChanged, onAddChild, onRemove, navigateTo }: TaskDetailProps) {
  const [saving, setSaving] = useState(false);
  const [pendingFailStatus, setPendingFailStatus] = useState(false);
  const [failureReason, setFailureReason] = useState("");
  const [editingFailureReason, setEditingFailureReason] = useState(false);
  const [showAddChild, setShowAddChild] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const usageSummary = taskUsage ?? {
    totalTokens: 0,
    runCount: 0,
    utilization: resolveTaskUtilization(0, weeklyBudget),
  };
  const utilization = usageSummary.utilization ?? resolveTaskUtilization(usageSummary.totalTokens, weeklyBudget);

  // Determine if this item can have children added
  const canAddChild = onAddChild != null && getChildLevel(item.level) != null;

  // Reset add-child form and remove confirmation when item changes
  useEffect(() => {
    setShowAddChild(false);
    setConfirmingRemove(false);
    setRemoving(false);
  }, [item.id]);

  const handleStatusChange = useCallback(
    (status: ItemStatus) => {
      if (!onUpdate || status === item.status) return;
      setSaving(true);
      onUpdate(item.id, { status });
      // Reset saving indicator after brief delay (optimistic)
      setTimeout(() => setSaving(false), 500);
    },
    [item.id, item.status, onUpdate],
  );

  const handleRequestReason = useCallback(
    (status: ItemStatus) => {
      if (!onUpdate || (status === item.status && !item.failureReason)) return;
      setPendingFailStatus(true);
      setFailureReason("");
    },
    [item.status, item.failureReason, onUpdate],
  );

  const handleFailureSubmit = useCallback(() => {
    if (!onUpdate || !failureReason.trim()) return;
    setSaving(true);
    onUpdate(item.id, { status: "failing" as ItemStatus, failureReason: failureReason.trim() });
    setPendingFailStatus(false);
    setEditingFailureReason(false);
    setFailureReason("");
    setTimeout(() => setSaving(false), 500);
  }, [item.id, failureReason, onUpdate]);

  const handleFailureCancel = useCallback(() => {
    setPendingFailStatus(false);
    setEditingFailureReason(false);
    setFailureReason("");
  }, []);

  const handleEditFailureReason = useCallback(() => {
    setEditingFailureReason(true);
    setFailureReason(item.failureReason || "");
  }, [item.failureReason]);

  const handlePriorityChange = useCallback(
    (priority: Priority) => {
      if (!onUpdate || priority === item.priority) return;
      onUpdate(item.id, { priority });
    },
    [item.id, item.priority, onUpdate],
  );

  const handleTagsUpdate = useCallback(
    (tags: string[]) => {
      if (!onUpdate) return;
      onUpdate(item.id, { tags });
    },
    [item.id, onUpdate],
  );

  return h(
    Fragment,
    null,

    // Level + ID header
    h(
      "div",
      { class: "task-meta-header" },
      h("span", { class: `prd-level-badge prd-level-${item.level}` }, getLevelLabel(item.level)),
      h("span", { class: "task-id" }, item.id.slice(0, 8)),
      h(CopyLinkButton, { path: `/prd/${item.id}`, compact: true }),
    ),

    // Editable title
    h(
      "div",
      { class: "task-section" },
      h(EditableTitle, {
        title: item.title,
        onUpdate: onUpdate
          ? (title: string) => onUpdate(item.id, { title })
          : undefined,
      }),
    ),

    // Status selector
    h(
      "div",
      { class: "task-section" },
      h("div", { class: "task-section-label" }, saving ? "Status (saving...)" : "Status"),
      h(StatusSelector, {
        current: item.status,
        onChange: handleStatusChange,
        onRequestReason: onUpdate ? handleRequestReason : undefined,
      }),

      // Execute button (only for tasks/subtasks)
      h(ExecuteTaskButton, { item, onExecute: onExecuteTask, onPrdChanged }),

      // Inline failure reason input form
      (pendingFailStatus || editingFailureReason)
        ? h(
            "div",
            { class: "task-failure-input-form" },
            h("input", {
              class: "task-failure-input",
              type: "text",
              placeholder: "Describe what's failing...",
              value: failureReason,
              onInput: (e: Event) => setFailureReason((e.target as HTMLInputElement).value),
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === "Enter" && failureReason.trim()) { e.preventDefault(); handleFailureSubmit(); }
                if (e.key === "Escape") { handleFailureCancel(); }
              },
              ref: (el: HTMLInputElement | null) => el?.focus(),
            }),
            h(
              "div",
              { class: "task-failure-form-actions" },
              h("button", {
                class: "task-failure-submit-btn",
                onClick: handleFailureSubmit,
                disabled: !failureReason.trim(),
              }, "Set Failing"),
              h("button", {
                class: "task-failure-cancel-btn",
                onClick: handleFailureCancel,
              }, "Cancel"),
            ),
          )
        : null,
    ),

    // Description (editable)
    h(
      "div",
      { class: "task-section" },
      h("div", { class: "task-section-label" }, "Description"),
      h(EditableDescription, {
        description: item.description,
        onUpdate: onUpdate
          ? (description: string) => onUpdate(item.id, { description: description || undefined })
          : undefined,
      }),
    ),

    // Acceptance criteria (editable)
    (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) || onUpdate
      ? h(
          "div",
          { class: "task-section" },
          h(EditableAcceptanceCriteria, {
            criteria: item.acceptanceCriteria ?? [],
            onUpdate: onUpdate
              ? (criteria: string[]) => onUpdate(item.id, { acceptanceCriteria: criteria })
              : undefined,
          }),
        )
      : null,

    // Aggregated token usage across runs
    item.level === "task" || item.level === "subtask"
      ? h(
          "div",
          { class: "task-section task-usage-section" },
          h("div", { class: "task-section-label" }, "Usage"),
          h("div", { class: "task-usage-row" },
            h("span", { class: "label" }, "Total Tokens"),
            h("span", { class: "task-usage-value" }, `${formatTokenCount(usageSummary.totalTokens)} tokens`),
          ),
          // Budget-specific fields: weekly utilization percentage and budget reason
          showTokenBudget
            ? h("div", { class: "task-usage-row" },
                h("span", { class: "label" }, "Weekly Utilization"),
                h(
                  "span",
                  { class: "task-usage-value", "data-utilization-reason": utilization.reason },
                  utilization.label,
                ),
              )
            : null,
          h("div", { class: "task-usage-hint", "data-utilization-reason": showTokenBudget ? utilization.reason : undefined },
            `${usageSummary.runCount} associated run${usageSummary.runCount === 1 ? "" : "s"}${showTokenBudget ? ` | reason: ${utilization.reason}` : ""}`,
          ),
        )
      : null,

    // Associated hench runs (tasks/subtasks only)
    isWorkItem(item.level)
      ? h(HenchRunsList, { taskId: item.id, navigateTo })
      : null,

    // Failure reason
    item.status === "failing" && item.failureReason && !editingFailureReason
      ? h(
          "div",
          { class: "task-section task-failure-reason" },
          h(
            "div",
            { class: "task-failure-reason-header" },
            h("div", { class: "task-section-label prd-status-failing" }, "Failure Reason"),
            onUpdate
              ? h("button", {
                  class: "task-failure-edit-btn",
                  onClick: handleEditFailureReason,
                  title: "Edit reason",
                }, "Edit")
              : null,
          ),
          h("div", { class: "task-failure-text" }, item.failureReason),
        )
      : null,

    // Priority selector
    h(
      "div",
      { class: "task-section" },
      h("div", { class: "task-section-label" }, "Priority"),
      h(PrioritySelector, { current: item.priority, onChange: handlePriorityChange }),
    ),

    // Tags editor
    h(
      "div",
      { class: "task-section" },
      h("div", { class: "task-section-label" }, "Tags"),
      h(TagEditor, { tags: item.tags ?? [], onUpdate: handleTagsUpdate }),
    ),

    // Requirements
    h(
      "div",
      { class: "task-section" },
      h("div", { class: "task-section-label" },
        `Requirements (${(item.requirements ?? []).length})`,
      ),
      h(RequirementsList, {
        requirements: item.requirements ?? [],
        onAdd: onUpdate
          ? (req: Omit<RequirementData, "id">) => {
              // Optimistic update: add with a temporary id
              const tempId = "req-" + Date.now().toString(36);
              const newReq: RequirementData = { ...req, id: tempId };
              const existing = item.requirements ?? [];
              onUpdate(item.id, { requirements: [...existing, newReq] });
            }
          : undefined,
        onRemove: onUpdate
          ? (reqId: string) => {
              const existing = item.requirements ?? [];
              onUpdate(item.id, { requirements: existing.filter((r) => r.id !== reqId) });
            }
          : undefined,
      }),
    ),

    // Dependencies
    item.blockedBy && item.blockedBy.length > 0
      ? h(
          "div",
          { class: "task-section" },
          h(DependencyList, {
            blockedBy: item.blockedBy,
            allItems,
            onNavigate: onNavigateToItem,
          }),
        )
      : null,

    // Children + Add child
    canAddChild || (item.children && item.children.length > 0)
      ? h(
          "div",
          { class: "task-section" },
          item.children && item.children.length > 0
            ? h(ChildrenSummary, {
                children: item.children,
                onNavigate: onNavigateToItem,
              })
            : null,

          // Add child button or form
          canAddChild
            ? showAddChild
              ? h(AddChildForm, {
                  parentId: item.id,
                  parentLevel: item.level,
                  onSubmit: async (data) => {
                    await onAddChild!(data);
                    setShowAddChild(false);
                  },
                  onCancel: () => setShowAddChild(false),
                })
              : h(
                  "button",
                  {
                    class: "task-add-child-btn",
                    onClick: () => setShowAddChild(true),
                    title: `Add ${getLevelLabel(getChildLevel(item.level) ?? "child")} to this ${getLevelLabel(item.level)}`,
                  },
                  `+ Add ${getLevelLabel(getChildLevel(item.level) ?? "child")}`,
                )
            : null,
        )
      : null,

    // Index.md schema sections (Progress table, Commits, Changes, Info)
    h(IndexMdSectionsRenderer, { itemId: item.id }),

    // Timestamps
    (item.startedAt || item.completedAt)
      ? h(
          "div",
          { class: "task-section task-timestamps" },
          h("div", { class: "task-section-label" }, "Timeline"),
          item.startedAt
            ? h("div", { class: "detail-row" },
                h("span", { class: "label" }, "Started"),
                h("span", null, formatTimestamp(item.startedAt)),
              )
            : null,
          item.completedAt
            ? h("div", { class: "detail-row" },
                h("span", { class: "label" }, "Completed"),
                h("span", null, formatTimestamp(item.completedAt)),
              )
            : null,
        )
      : null,

    // Delete / Remove item
    onRemove
      ? h(
          "div",
          { class: "task-section task-danger-zone" },
          h("div", { class: "task-section-label task-danger-label" }, "Danger Zone"),
          confirmingRemove
            ? h(
                "div",
                { class: "task-remove-confirm" },
                h("p", { class: "task-remove-confirm-msg" },
                  `Are you sure you want to delete this ${getLevelLabel(item.level)}`,
                  (item.children && item.children.length > 0)
                    ? ` and all its ${item.children.length} descendant${item.children.length !== 1 ? "s" : ""}?`
                    : "?",
                ),
                h("div", { class: "task-remove-confirm-actions" },
                  h("button", {
                    class: "task-remove-confirm-btn",
                    onClick: async () => {
                      setRemoving(true);
                      try {
                        await onRemove(item.id);
                      } catch {
                        setRemoving(false);
                        setConfirmingRemove(false);
                      }
                    },
                    disabled: removing,
                  }, removing ? "Deleting..." : "Yes, Delete"),
                  h("button", {
                    class: "task-remove-cancel-btn",
                    onClick: () => setConfirmingRemove(false),
                    disabled: removing,
                  }, "Cancel"),
                ),
              )
            : h("button", {
                class: "task-remove-btn",
                onClick: () => setConfirmingRemove(true),
                title: `Delete this ${getLevelLabel(item.level)} and all its descendants`,
              },
                h("span", { class: "task-remove-btn-icon" }, "\u2717"),
                `Delete ${getLevelLabel(item.level)}`,
              ),
        )
      : null,
  );
}
