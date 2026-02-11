/**
 * Task detail panel for PRD items.
 *
 * Renders inside the existing DetailPanel when a PRD item is selected.
 * Shows description, acceptance criteria, metadata, and provides
 * controls for updating status, priority, and tags.
 */

import { h, Fragment } from "preact";
import { useState, useCallback } from "preact/hooks";
import type { PRDItemData, ItemStatus, Priority, RequirementData, RequirementCategory, RequirementValidationType } from "./types.js";
import { formatTimestamp } from "./compute.js";
import { findItemById } from "./tree-utils.js";

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

const LEVEL_LABELS: Record<string, string> = {
  epic: "Epic",
  feature: "Feature",
  task: "Task",
  subtask: "Subtask",
};

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

// ── Main component ───────────────────────────────────────────────────

export function TaskDetail({ item, allItems, onUpdate, onNavigateToItem }: TaskDetailProps) {
  const [saving, setSaving] = useState(false);
  const [pendingFailStatus, setPendingFailStatus] = useState(false);
  const [failureReason, setFailureReason] = useState("");
  const [editingFailureReason, setEditingFailureReason] = useState(false);

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
      h("span", { class: `prd-level-badge prd-level-${item.level}` }, LEVEL_LABELS[item.level] || item.level),
      h("span", { class: "task-id" }, item.id.slice(0, 8)),
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
