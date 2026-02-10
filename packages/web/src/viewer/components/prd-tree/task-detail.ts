/**
 * Task detail panel for PRD items.
 *
 * Renders inside the existing DetailPanel when a PRD item is selected.
 * Shows description, acceptance criteria, metadata, and provides
 * controls for updating status, priority, and tags.
 */

import { h, Fragment } from "preact";
import { useState, useCallback } from "preact/hooks";
import type { PRDItemData, ItemStatus, Priority } from "./types.js";
import { formatTimestamp } from "./compute.js";

// ── Types ────────────────────────────────────────────────────────────

export interface TaskDetailProps {
  item: PRDItemData;
  /** All items in the document, for resolving dependency references. */
  allItems: PRDItemData[];
  /** Called when an item is updated via the API. */
  onUpdate?: (id: string, updates: Partial<PRDItemData>) => void;
  /** Called to navigate to a different item in the tree. */
  onNavigateToItem?: (id: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────

const STATUS_OPTIONS: Array<{ value: ItemStatus; label: string; icon: string }> = [
  { value: "pending", label: "Pending", icon: "○" },
  { value: "in_progress", label: "In Progress", icon: "◐" },
  { value: "completed", label: "Completed", icon: "●" },
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

const LEVEL_LABELS: Record<string, string> = {
  epic: "Epic",
  feature: "Feature",
  task: "Task",
  subtask: "Subtask",
};

// ── Helpers ──────────────────────────────────────────────────────────

function findItemById(items: PRDItemData[], id: string): PRDItemData | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findItemById(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

// ── Sub-components ───────────────────────────────────────────────────

/** Status selector — rendered as a row of buttons. */
function StatusSelector({
  current,
  onChange,
}: {
  current: ItemStatus;
  onChange: (status: ItemStatus) => void;
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
          onClick: () => onChange(opt.value),
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
            ? h("span", { class: `prd-level-badge prd-level-${dep.level}` }, LEVEL_LABELS[dep.level] || dep.level)
            : null,
        );
      }),
    ),
  );
}

/** Acceptance criteria checklist (read-only display). */
function AcceptanceCriteria({ criteria }: { criteria: string[] }) {
  if (criteria.length === 0) return null;

  return h(
    "div",
    { class: "task-acceptance-criteria" },
    h("div", { class: "task-section-label" }, "Acceptance Criteria"),
    h(
      "ul",
      { class: "task-criteria-list" },
      criteria.map((criterion, i) =>
        h("li", { key: i, class: "task-criterion" }, criterion),
      ),
    ),
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
          h("span", { class: `prd-level-badge prd-level-${child.level}` }, LEVEL_LABELS[child.level] || child.level),
          h("span", { class: "task-child-title" }, child.title),
        ),
      ),
    ),
  );
}

// ── Main component ───────────────────────────────────────────────────

export function TaskDetail({ item, allItems, onUpdate, onNavigateToItem }: TaskDetailProps) {
  const [saving, setSaving] = useState(false);

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
      h("span", { class: `prd-level-badge prd-level-${item.level}` }, LEVEL_LABELS[item.level] || item.level),
      h("span", { class: "task-id" }, item.id.slice(0, 8)),
    ),

    // Status selector
    h(
      "div",
      { class: "task-section" },
      h("div", { class: "task-section-label" }, saving ? "Status (saving...)" : "Status"),
      h(StatusSelector, { current: item.status, onChange: handleStatusChange }),
    ),

    // Description
    item.description
      ? h(
          "div",
          { class: "task-section" },
          h("div", { class: "task-section-label" }, "Description"),
          h("div", { class: "task-description" }, item.description),
        )
      : null,

    // Acceptance criteria
    item.acceptanceCriteria && item.acceptanceCriteria.length > 0
      ? h(
          "div",
          { class: "task-section" },
          h(AcceptanceCriteria, { criteria: item.acceptanceCriteria }),
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

    // Children
    item.children && item.children.length > 0
      ? h(
          "div",
          { class: "task-section" },
          h(ChildrenSummary, {
            children: item.children,
            onNavigate: onNavigateToItem,
          }),
        )
      : null,

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
  );
}
