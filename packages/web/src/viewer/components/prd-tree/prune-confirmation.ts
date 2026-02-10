/**
 * Prune confirmation panel for PRD items.
 *
 * Implements a multi-step confirmation flow for destructive pruning operations:
 *
 * 1. **Preview**: Shows prunable items with impact summary (count, levels affected).
 * 2. **Confirm**: Requires explicit confirmation with clear irreversibility warning.
 *    Offers optional backup before pruning.
 * 3. **Result**: Shows what was pruned and archive location.
 *
 * The confirmation uses a `confirmCount` token to prevent stale operations —
 * if the PRD changes between preview and confirm, the server rejects the request.
 */

import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import type { ItemLevel } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────

export interface PruneConfirmationProps {
  /** Called after a successful prune (to refresh data). */
  onPruneComplete: () => void;
  /** Called to close the panel without pruning. */
  onCancel: () => void;
}

interface PrunableItem {
  id: string;
  title: string;
  level: string;
  status: string;
  childCount: number;
  totalCount: number;
}

interface PrunePreview {
  items: PrunableItem[];
  totalItemCount: number;
  hasPrunableItems: boolean;
}

interface PruneResult {
  prunedCount: number;
  prunedItems: PrunableItem[];
  archivedTo: string;
  backupPath?: string;
}

// ── Constants ────────────────────────────────────────────────────────

const LEVEL_LABELS: Record<ItemLevel, string> = {
  epic: "Epic",
  feature: "Feature",
  task: "Task",
  subtask: "Subtask",
};

const LEVEL_ICONS: Record<string, string> = {
  epic: "\u25A0",     // ■
  feature: "\u25C6",   // ◆
  task: "\u25CF",      // ●
  subtask: "\u25CB",   // ○
};

/** Confirmation flow step. */
type PruneStep = "preview" | "confirm" | "result";

// ── Component ────────────────────────────────────────────────────────

export function PruneConfirmation({ onPruneComplete, onCancel }: PruneConfirmationProps) {
  const [step, setStep] = useState<PruneStep>("preview");
  const [preview, setPreview] = useState<PrunePreview | null>(null);
  const [result, setResult] = useState<PruneResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState(true);

  // Fetch prune preview
  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/rex/prune/preview");
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Preview failed" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setPreview(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  // Compute level breakdown for display
  const levelBreakdown = preview?.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.level] = (acc[item.level] || 0) + 1;
    return acc;
  }, {}) ?? {};

  // Execute prune
  const handlePrune = useCallback(async () => {
    if (!preview) return;

    setPruning(true);
    setError(null);

    try {
      const res = await fetch("/api/rex/prune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backup,
          confirmCount: preview.totalItemCount,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Prune failed" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setResult(data);
      setStep("result");

      // Notify parent after brief delay to show result
      setTimeout(() => {
        onPruneComplete();
      }, 2000);
    } catch (err) {
      setError(String(err));
      setPruning(false);
    }
  }, [preview, backup, onPruneComplete]);

  // ── Render: Loading ──────────────────────────────────────────────

  if (loading) {
    return h("div", { class: "prune-confirmation" },
      h("div", { class: "prune-confirmation-header" },
        h("h3", null, "Prune Completed Items"),
        h("button", {
          class: "prune-confirmation-close",
          onClick: onCancel,
          title: "Cancel",
          "aria-label": "Cancel prune",
        }, "\u00d7"),
      ),
      h("div", { class: "prune-confirmation-loading" },
        h("div", { class: "rex-analyze-spinner" }),
        h("span", null, "Scanning for completed items..."),
      ),
    );
  }

  // ── Render: Error ────────────────────────────────────────────────

  if (error && !preview) {
    return h("div", { class: "prune-confirmation" },
      h("div", { class: "prune-confirmation-header" },
        h("h3", null, "Prune Completed Items"),
        h("button", {
          class: "prune-confirmation-close",
          onClick: onCancel,
          title: "Cancel",
          "aria-label": "Cancel prune",
        }, "\u00d7"),
      ),
      h("div", { class: "prune-confirmation-error", role: "alert" }, error),
      h("div", { class: "prune-confirmation-actions" },
        h("button", {
          class: "prune-confirmation-btn prune-confirmation-btn-cancel",
          onClick: onCancel,
        }, "Close"),
      ),
    );
  }

  // ── Render: Nothing to prune ─────────────────────────────────────

  if (preview && !preview.hasPrunableItems) {
    return h("div", { class: "prune-confirmation" },
      h("div", { class: "prune-confirmation-header" },
        h("h3", null, "Prune Completed Items"),
        h("button", {
          class: "prune-confirmation-close",
          onClick: onCancel,
          title: "Cancel",
          "aria-label": "Cancel prune",
        }, "\u00d7"),
      ),
      h("div", { class: "prune-confirmation-empty" },
        h("p", null, "Nothing to prune."),
        h("p", { class: "prune-confirmation-hint" },
          "Only fully completed subtrees (all children also completed) are eligible for pruning.",
        ),
      ),
      h("div", { class: "prune-confirmation-actions" },
        h("button", {
          class: "prune-confirmation-btn prune-confirmation-btn-cancel",
          onClick: onCancel,
        }, "Close"),
      ),
    );
  }

  // ── Render: Result ───────────────────────────────────────────────

  if (step === "result" && result) {
    return h("div", { class: "prune-confirmation" },
      h("div", { class: "prune-confirmation-header" },
        h("h3", null, "Prune Complete"),
        h("button", {
          class: "prune-confirmation-close",
          onClick: onCancel,
          title: "Close",
          "aria-label": "Close",
        }, "\u00d7"),
      ),
      h("div", { class: "prune-confirmation-success", role: "status" },
        `Pruned ${result.prunedCount} item${result.prunedCount !== 1 ? "s" : ""} successfully.`,
      ),
      h("div", { class: "prune-confirmation-result-details" },
        h("div", { class: "prune-confirmation-field" },
          h("span", { class: "prune-confirmation-field-label" }, "Archived to: "),
          h("code", null, result.archivedTo),
        ),
        result.backupPath
          ? h("div", { class: "prune-confirmation-field" },
              h("span", { class: "prune-confirmation-field-label" }, "Backup saved: "),
              h("code", null, result.backupPath.split("/").pop()),
            )
          : null,
      ),
    );
  }

  // ── Render: Preview / Confirm ────────────────────────────────────

  return h("div", { class: "prune-confirmation" },
    // Header
    h("div", { class: "prune-confirmation-header" },
      h("h3", null, step === "preview" ? "Prune Completed Items" : "Confirm Prune"),
      h("button", {
        class: "prune-confirmation-close",
        onClick: onCancel,
        title: "Cancel",
        "aria-label": "Cancel prune",
        disabled: pruning,
      }, "\u00d7"),
    ),

    // Error
    error
      ? h("div", { class: "prune-confirmation-error", role: "alert" }, error)
      : null,

    // Warning banner (confirm step)
    step === "confirm"
      ? h("div", { class: "prune-confirmation-warning", role: "alert" },
          h("div", { class: "prune-confirmation-warning-icon" }, "\u26A0"),
          h("div", null,
            h("strong", null, "This action is irreversible."),
            h("p", null, "Pruned items will be removed from the PRD and archived. They cannot be restored from the UI."),
          ),
        )
      : null,

    // Impact summary
    preview ? h("div", { class: "prune-confirmation-summary" },
      h("div", { class: "prune-confirmation-summary-stat" },
        h("span", { class: "prune-confirmation-summary-num" },
          String(preview.totalItemCount),
        ),
        h("span", null, ` item${preview.totalItemCount !== 1 ? "s" : ""} will be removed`),
      ),
      h("div", { class: "prune-confirmation-summary-stat" },
        h("span", { class: "prune-confirmation-summary-num" },
          String(preview.items.length),
        ),
        h("span", null, ` completed subtree${preview.items.length !== 1 ? "s" : ""}`),
      ),
      Object.keys(levelBreakdown).length > 0
        ? h("div", { class: "prune-confirmation-breakdown" },
            Object.entries(levelBreakdown).map(([level, count]) =>
              h("span", {
                key: level,
                class: `prune-confirmation-level-chip prd-level-${level}`,
              },
                `${count} ${LEVEL_LABELS[level as ItemLevel] ?? level}${count !== 1 ? "s" : ""}`,
              ),
            ),
          )
        : null,
    ) : null,

    // Prunable items list
    step === "preview" && preview ? h("div", { class: "prune-confirmation-items" },
      h("h4", null, "Items to be pruned:"),
      h("div", { class: "prune-confirmation-item-list" },
        preview.items.map((item) =>
          h("div", {
            key: item.id,
            class: "prune-confirmation-item",
          },
            h("span", { class: `prune-confirmation-item-icon prd-level-${item.level}` },
              LEVEL_ICONS[item.level] ?? "\u2022",
            ),
            h("span", { class: "prune-confirmation-item-title" }, item.title),
            h("span", { class: `prd-level-badge prd-level-${item.level}` },
              LEVEL_LABELS[item.level as ItemLevel] ?? item.level,
            ),
            item.totalCount > 1
              ? h("span", { class: "prune-confirmation-item-count" },
                  `${item.totalCount} items`,
                )
              : null,
          ),
        ),
      ),
    ) : null,

    // Backup option (confirm step)
    step === "confirm" ? h("div", { class: "prune-confirmation-option" },
      h("label", { class: "prune-confirmation-option-label" },
        h("input", {
          type: "checkbox",
          checked: backup,
          onChange: (e: Event) => setBackup((e.target as HTMLInputElement).checked),
          disabled: pruning,
          class: "prune-confirmation-checkbox",
        }),
        h("span", null, "Create backup before pruning"),
      ),
      h("span", { class: "prune-confirmation-option-hint" },
        "Saves a copy of the current PRD to .rex/",
      ),
    ) : null,

    // Action buttons
    h("div", { class: "prune-confirmation-actions" },
      h("button", {
        class: "prune-confirmation-btn prune-confirmation-btn-cancel",
        onClick: step === "confirm" ? () => setStep("preview") : onCancel,
        disabled: pruning,
      }, step === "confirm" ? "Back" : "Cancel"),

      step === "preview"
        ? h("button", {
            class: "prune-confirmation-btn prune-confirmation-btn-next",
            onClick: () => setStep("confirm"),
          }, "Review & Confirm")
        : h("button", {
            class: "prune-confirmation-btn prune-confirmation-btn-prune",
            onClick: handlePrune,
            disabled: pruning,
          }, pruning ? "Pruning..." : `Prune ${preview?.totalItemCount ?? 0} Items`),
    ),
  );
}
