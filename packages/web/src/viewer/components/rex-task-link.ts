/**
 * RexTaskLink — reusable component for rendering clickable Rex task references.
 *
 * Provides a consistent visual pattern for task links across the dashboard,
 * Hench runs view, and any other location that references a Rex task.
 *
 * Features:
 * - Status icon with color coding
 * - Clickable with hover/focus states
 * - Right-click context menu for quick actions (status change, view detail)
 * - Keyboard accessible (Enter/Space to click)
 * - Consistent styling via `.rex-task-link` CSS class
 */

import { h } from "preact";
import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import type { ViewId } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────

export interface TaskRef {
  id: string;
  title: string;
  status: string;
  level?: string;
  priority?: string;
}

export interface RexTaskLinkProps {
  task: TaskRef;
  /** Navigate to a view. Used to go to the PRD view on click. */
  navigateTo?: (view: ViewId) => void;
  /** Optional additional CSS class. */
  class?: string;
  /** Show the level badge (e.g. "Epic", "Task"). Default: false */
  showLevel?: boolean;
  /** Show the priority badge. Default: false */
  showPriority?: boolean;
  /** Show the status icon. Default: true */
  showStatus?: boolean;
  /** Compact mode — smaller text, less padding. Default: false */
  compact?: boolean;
  /** Additional click handler (called alongside navigation). */
  onClick?: () => void;
}

// ── Status config ────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { icon: string; label: string; cssClass: string }> = {
  completed: { icon: "●", label: "Completed", cssClass: "prd-status-completed" },
  in_progress: { icon: "◐", label: "In Progress", cssClass: "prd-status-in-progress" },
  pending: { icon: "○", label: "Pending", cssClass: "prd-status-pending" },
  deferred: { icon: "◌", label: "Deferred", cssClass: "prd-status-deferred" },
  blocked: { icon: "⊘", label: "Blocked", cssClass: "prd-status-blocked" },
  deleted: { icon: "✕", label: "Deleted", cssClass: "prd-status-deleted" },
};

const LEVEL_LABELS: Record<string, string> = {
  epic: "Epic",
  feature: "Feature",
  task: "Task",
  subtask: "Subtask",
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { icon: "○", label: status, cssClass: "prd-status-pending" };
}

// ── Context menu ─────────────────────────────────────────────────────

interface ContextMenuProps {
  task: TaskRef;
  x: number;
  y: number;
  onClose: () => void;
  navigateTo?: (view: ViewId) => void;
  onStatusChange?: (taskId: string, status: string) => void;
}

const QUICK_STATUSES = [
  { status: "in_progress", icon: "◐", label: "Start", cssClass: "prd-status-in-progress" },
  { status: "completed", icon: "●", label: "Complete", cssClass: "prd-status-completed" },
  { status: "blocked", icon: "⊘", label: "Block", cssClass: "prd-status-blocked" },
  { status: "deferred", icon: "◌", label: "Defer", cssClass: "prd-status-deferred" },
];

function TaskContextMenu({ task, x, y, onClose, navigateTo, onStatusChange }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Clamp position so menu doesn't overflow viewport
  const style: Record<string, string> = {
    position: "fixed",
    left: `${Math.min(x, window.innerWidth - 200)}px`,
    top: `${Math.min(y, window.innerHeight - 240)}px`,
    zIndex: "9999",
  };

  const handleViewDetail = () => {
    if (navigateTo) navigateTo("prd" as ViewId);
    onClose();
  };

  const handleStatusClick = async (newStatus: string) => {
    if (onStatusChange) {
      onStatusChange(task.id, newStatus);
    } else {
      // Direct API call as fallback
      try {
        await fetch(`/api/rex/items/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
      } catch {
        // silently fail — user can retry from detail view
      }
    }
    onClose();
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(task.id).catch(() => {});
    onClose();
  };

  return h("div", { ref, class: "rex-context-menu", style, role: "menu" },
    // Header
    h("div", { class: "rex-context-menu-header" },
      h("span", { class: "rex-context-menu-title" }, task.title),
    ),

    h("div", { class: "rex-context-menu-divider" }),

    // View detail
    navigateTo
      ? h("button", {
          class: "rex-context-menu-item",
          role: "menuitem",
          onClick: handleViewDetail,
        }, "View in PRD Tree")
      : null,

    // Quick status changes
    h("div", { class: "rex-context-menu-section-label" }, "Set Status"),
    ...QUICK_STATUSES.filter((s) => s.status !== task.status).map((s) =>
      h("button", {
        key: s.status,
        class: "rex-context-menu-item",
        role: "menuitem",
        onClick: () => handleStatusClick(s.status),
      },
        h("span", { class: `rex-context-menu-status-icon ${s.cssClass}` }, s.icon),
        s.label,
      ),
    ),

    h("div", { class: "rex-context-menu-divider" }),

    // Copy ID
    h("button", {
      class: "rex-context-menu-item",
      role: "menuitem",
      onClick: handleCopyId,
    }, "Copy Task ID"),
  );
}

// ── RexTaskLink ──────────────────────────────────────────────────────

export function RexTaskLink({
  task,
  navigateTo,
  class: className,
  showLevel = false,
  showPriority = false,
  showStatus = true,
  compact = false,
  onClick,
}: RexTaskLinkProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const status = getStatusConfig(task.status);

  const handleClick = useCallback((e: MouseEvent) => {
    // Stop propagation so parent clickable elements (e.g. run cards) don't also fire
    e.stopPropagation();
    if (onClick) onClick();
    if (navigateTo) navigateTo("prd" as ViewId);
  }, [onClick, navigateTo]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (onClick) onClick();
      if (navigateTo) navigateTo("prd" as ViewId);
    }
  }, [onClick, navigateTo]);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const classes = [
    "rex-task-link",
    compact ? "rex-task-link-compact" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return h("span", {
    class: classes,
    role: "button",
    tabIndex: 0,
    onClick: handleClick,
    onKeyDown: handleKeyDown,
    onContextMenu: handleContextMenu,
    title: `${status.label}: ${task.title}`,
    "aria-label": `${task.title} — ${status.label}`,
  },
    // Status icon
    showStatus
      ? h("span", {
          class: `rex-task-link-status ${status.cssClass}`,
          "aria-hidden": "true",
        }, status.icon)
      : null,

    // Level badge
    showLevel && task.level
      ? h("span", { class: `prd-level-badge prd-level-${task.level}` },
          LEVEL_LABELS[task.level] ?? task.level,
        )
      : null,

    // Title
    h("span", { class: "rex-task-link-title" }, task.title),

    // Priority badge
    showPriority && task.priority
      ? h("span", { class: `prd-priority-badge prd-priority-${task.priority}` },
          task.priority,
        )
      : null,

    // Link indicator
    h("span", { class: "rex-task-link-arrow", "aria-hidden": "true" }, "→"),

    // Context menu
    contextMenu
      ? h(TaskContextMenu, {
          task,
          x: contextMenu.x,
          y: contextMenu.y,
          onClose: () => setContextMenu(null),
          navigateTo,
        })
      : null,
  );
}
