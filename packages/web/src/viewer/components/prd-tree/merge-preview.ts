/**
 * Merge preview panel for PRD items.
 *
 * Shows a preview of what will happen when items are consolidated:
 * - Which item survives (the target)
 * - Which items are absorbed (removed)
 * - Combined acceptance criteria, tags, description
 * - Children that will be reparented
 * - Dependencies that will be rewritten
 *
 * Lets the user optionally override the merged title/description
 * before confirming.
 */

import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import type { PRDItemData, ItemLevel } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────

export interface MergePreviewProps {
  /** All selected items to merge (must be siblings at the same level). */
  selectedItems: PRDItemData[];
  /** Called after a successful merge (to refresh data). */
  onMergeComplete: () => void;
  /** Called to close the preview without merging. */
  onCancel: () => void;
}

interface MergePreviewData {
  target: {
    id: string;
    title: string;
    description?: string;
    acceptanceCriteria: string[];
    tags: string[];
    blockedBy: string[];
    childCount: number;
  };
  absorbed: Array<{
    id: string;
    title: string;
    level: string;
    status: string;
    childCount: number;
  }>;
  rewrittenDependencyCount: number;
}

// ── Constants ────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  completed: "\u25CF",     // ●
  in_progress: "\u25D0",   // ◐
  pending: "\u25CB",       // ○
  deferred: "\u25CC",      // ◌
  blocked: "\u2298",       // ⊘
  deleted: "\u2715",       // ✕
};

const LEVEL_LABELS: Record<ItemLevel, string> = {
  epic: "Epic",
  feature: "Feature",
  task: "Task",
  subtask: "Subtask",
};

// ── Component ────────────────────────────────────────────────────────

export function MergePreview({ selectedItems, onMergeComplete, onCancel }: MergePreviewProps) {
  const [targetId, setTargetId] = useState<string>(selectedItems[0]?.id ?? "");
  const [customTitle, setCustomTitle] = useState<string>("");
  const [preview, setPreview] = useState<MergePreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const sourceIds = selectedItems.map((item) => item.id);

  // Fetch preview whenever targetId or customTitle changes
  const fetchPreview = useCallback(async () => {
    if (sourceIds.length < 2 || !targetId) return;

    setLoading(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        sourceIds,
        targetId,
        preview: true,
      };
      if (customTitle.trim()) body.title = customTitle.trim();

      const res = await fetch("/api/rex/items/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Preview failed" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setPreview(data.preview);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [sourceIds.join(","), targetId, customTitle]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  // Execute merge
  const handleMerge = useCallback(async () => {
    setMerging(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        sourceIds,
        targetId,
      };
      if (customTitle.trim()) body.title = customTitle.trim();

      const res = await fetch("/api/rex/items/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Merge failed" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const absorbedCount = data.absorbedIds?.length ?? 0;
      setResult(`Merged ${absorbedCount + 1} items successfully`);

      setTimeout(() => {
        onMergeComplete();
      }, 1200);
    } catch (err) {
      setError(String(err));
      setMerging(false);
    }
  }, [sourceIds.join(","), targetId, customTitle, onMergeComplete]);

  if (selectedItems.length < 2) {
    return h("div", { class: "merge-preview-empty" },
      "Select at least 2 sibling items to merge.",
    );
  }

  const targetItem = selectedItems.find((item) => item.id === targetId);

  return h("div", { class: "merge-preview" },
    // Header
    h("div", { class: "merge-preview-header" },
      h("h3", null, "Merge Items"),
      h("button", {
        class: "merge-preview-close",
        onClick: onCancel,
        title: "Cancel",
        "aria-label": "Cancel merge",
      }, "\u00d7"),
    ),

    // Error message
    error
      ? h("div", { class: "merge-preview-error", role: "alert" }, error)
      : null,

    // Success message
    result
      ? h("div", { class: "merge-preview-success", role: "status" }, result)
      : null,

    // Target selection
    !result ? h("div", { class: "merge-preview-section" },
      h("label", { class: "merge-preview-label" }, "Keep (target item):"),
      h("select", {
        class: "merge-preview-select",
        value: targetId,
        onChange: (e: Event) => setTargetId((e.target as HTMLSelectElement).value),
        disabled: merging,
      },
        selectedItems.map((item) =>
          h("option", { key: item.id, value: item.id },
            `${STATUS_ICONS[item.status] ?? "\u25CB"} ${item.title}`,
          ),
        ),
      ),
    ) : null,

    // Custom title override
    !result ? h("div", { class: "merge-preview-section" },
      h("label", { class: "merge-preview-label" }, "Title (optional override):"),
      h("input", {
        class: "merge-preview-input",
        type: "text",
        value: customTitle,
        placeholder: targetItem?.title ?? "Keep original title",
        onInput: (e: Event) => setCustomTitle((e.target as HTMLInputElement).value),
        disabled: merging,
      }),
    ) : null,

    // Preview content
    loading
      ? h("div", { class: "merge-preview-loading" }, "Loading preview...")
      : null,

    preview && !result
      ? h("div", { class: "merge-preview-details" },
          // Target (what survives)
          h("div", { class: "merge-preview-target" },
            h("h4", null, "Result:"),
            h("div", { class: "merge-preview-card merge-preview-card-target" },
              h("div", { class: "merge-preview-card-title" },
                h("span", { class: "merge-preview-card-icon" }, "\u2713"),
                h("strong", null, preview.target.title),
              ),
              preview.target.acceptanceCriteria.length > 0
                ? h("div", { class: "merge-preview-field" },
                    h("span", { class: "merge-preview-field-label" }, "Acceptance Criteria:"),
                    h("ul", { class: "merge-preview-criteria" },
                      preview.target.acceptanceCriteria.map((ac, i) =>
                        h("li", { key: i }, ac),
                      ),
                    ),
                  )
                : null,
              preview.target.tags.length > 0
                ? h("div", { class: "merge-preview-field" },
                    h("span", { class: "merge-preview-field-label" }, "Tags: "),
                    h("span", { class: "merge-preview-tags" },
                      preview.target.tags.map((tag) =>
                        h("span", { key: tag, class: "prd-tag" }, tag),
                      ),
                    ),
                  )
                : null,
              preview.target.childCount > 0
                ? h("div", { class: "merge-preview-field" },
                    h("span", { class: "merge-preview-field-label" },
                      `${preview.target.childCount} child item${preview.target.childCount !== 1 ? "s" : ""}`,
                    ),
                  )
                : null,
            ),
          ),

          // Absorbed (what's removed)
          h("div", { class: "merge-preview-absorbed" },
            h("h4", null, `Absorbed (${preview.absorbed.length} item${preview.absorbed.length !== 1 ? "s" : ""} removed):`),
            preview.absorbed.map((item) =>
              h("div", {
                key: item.id,
                class: "merge-preview-card merge-preview-card-absorbed",
              },
                h("div", { class: "merge-preview-card-title" },
                  h("span", { class: "merge-preview-card-icon absorbed" }, "\u2715"),
                  h("span", null, item.title),
                  h("span", { class: `prd-level-badge prd-level-${item.level}` },
                    LEVEL_LABELS[item.level as ItemLevel] ?? item.level,
                  ),
                ),
                item.childCount > 0
                  ? h("div", { class: "merge-preview-field" },
                      h("span", { class: "merge-preview-field-label" },
                        `${item.childCount} child${item.childCount !== 1 ? "ren" : ""} will be reparented`,
                      ),
                    )
                  : null,
              ),
            ),
          ),

          // Dependency rewrites
          preview.rewrittenDependencyCount > 0
            ? h("div", { class: "merge-preview-deps" },
                h("span", { class: "merge-preview-deps-label" },
                  `${preview.rewrittenDependencyCount} dependency reference${preview.rewrittenDependencyCount !== 1 ? "s" : ""} will be rewritten`,
                ),
              )
            : null,
        )
      : null,

    // Action buttons
    !result ? h("div", { class: "merge-preview-actions" },
      h("button", {
        class: "merge-preview-btn merge-preview-btn-cancel",
        onClick: onCancel,
        disabled: merging,
      }, "Cancel"),
      h("button", {
        class: "merge-preview-btn merge-preview-btn-merge",
        onClick: handleMerge,
        disabled: merging || loading || !preview,
      }, merging ? "Merging..." : "Merge Items"),
    ) : null,
  );
}
