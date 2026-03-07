/**
 * Pruning interface for PRD items.
 *
 * Provides a dedicated pruning section with:
 *
 * 1. **Criteria configuration**: Age thresholds and completion status filters
 *    let users control which items are eligible for pruning.
 * 2. **Dry-run preview**: Shows exactly which items would be pruned without
 *    executing, including estimated storage savings.
 * 3. **Confirmation flow**: Multi-step confirmation with irreversibility warning,
 *    optional backup, and `confirmCount` staleness protection.
 * 4. **Result display**: Shows pruned count, archive location, and backup path.
 *
 * The criteria are sent as query params to GET /api/rex/prune/preview and as
 * body fields to POST /api/rex/prune, so the server handles all filtering.
 */

import { h } from "preact";
import { useState, useCallback } from "preact/hooks";
import type { ItemLevel } from "./types.js";
import { getLevelLabel, getLevelPlural } from "./levels.js";
import { PruneDiffTree } from "./prune-diff-tree.js";
import type { EpicImpact } from "./prune-diff-tree.js";
// ── Helpers (inlined to avoid cross-zone import from ../../utils) ────

/** Extract the filename from a path (last segment after '/'). */
function basename(path: string): string {
  return path.split("/").pop() || path;
}

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
  completedAt?: string;
}

interface PrunePreview {
  items: PrunableItem[];
  totalItemCount: number;
  hasPrunableItems: boolean;
  estimatedBytes: number;
  totalPrdBytes: number;
  levelBreakdown: Record<string, number>;
  criteria: {
    minAgeDays: number;
    statuses: string[];
  };
  /** All item IDs in prunable subtrees (for visual diff highlighting). */
  prunableIds?: string[];
  /** Per-epic before/after completion impact. */
  epicImpact?: EpicImpact[];
}

interface PruneResult {
  prunedCount: number;
  prunedItems: PrunableItem[];
  archivedTo: string;
  backupPath?: string;
}

/** Criteria for pruning configuration. */
interface PruneCriteria {
  minAgeDays: number;
  statuses: string[];
}

// ── Constants ────────────────────────────────────────────────────────

// Level labels provided by getLevelLabel() from ./levels.ts
// Level icons specific to prune UI (geometric shapes for compact display)
const PRUNE_ICONS: Record<string, string> = {
  epic: "\u25A0",     // ■
  feature: "\u25C6",   // ◆
  task: "\u25CF",      // ●
  subtask: "\u25CB",   // ○
};

const AGE_OPTIONS = [
  { value: 0, label: "Any age" },
  { value: 1, label: "1+ day old" },
  { value: 7, label: "7+ days old" },
  { value: 14, label: "14+ days old" },
  { value: 30, label: "30+ days old" },
  { value: 90, label: "90+ days old" },
];

const STATUS_OPTIONS = [
  { value: "completed", label: "Completed" },
  { value: "deferred", label: "Deferred" },
  { value: "deleted", label: "Deleted" },
];

/** Confirmation flow step. */
type PruneStep = "criteria" | "preview" | "confirm" | "result";

// ── Helpers ──────────────────────────────────────────────────────────

/** Format byte size to human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format age in days to human-readable string. */
function formatAge(completedAt: string | undefined): string {
  if (!completedAt) return "unknown";
  const days = Math.floor((Date.now() - new Date(completedAt).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// ── Component ────────────────────────────────────────────────────────

export function PruneConfirmation({ onPruneComplete, onCancel }: PruneConfirmationProps) {
  const [step, setStep] = useState<PruneStep>("criteria");
  const [preview, setPreview] = useState<PrunePreview | null>(null);
  const [result, setResult] = useState<PruneResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState(true);

  // Criteria state
  const [minAgeDays, setMinAgeDays] = useState(0);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["completed"]);

  // Diff view state: "list" (flat item list) or "diff" (tree diff)
  const [previewView, setPreviewView] = useState<"list" | "diff">("diff");

  // Build criteria object from state
  const buildCriteria = useCallback((): PruneCriteria => ({
    minAgeDays,
    statuses: selectedStatuses,
  }), [minAgeDays, selectedStatuses]);

  // Fetch prune preview with criteria (dry-run)
  const fetchPreview = useCallback(async (criteria?: PruneCriteria) => {
    const c = criteria ?? buildCriteria();
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (c.minAgeDays > 0) params.set("minAge", String(c.minAgeDays));
      if (c.statuses.length > 0) params.set("statuses", c.statuses.join(","));
      const qs = params.toString();

      const res = await fetch(`/api/rex/prune/preview${qs ? `?${qs}` : ""}`);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Preview failed" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setPreview(data);
      setStep("preview");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [buildCriteria]);

  // Toggle status in criteria
  const toggleStatus = useCallback((status: string) => {
    setSelectedStatuses((prev) => {
      if (prev.includes(status)) {
        // Don't allow deselecting all
        if (prev.length === 1) return prev;
        return prev.filter((s) => s !== status);
      }
      return [...prev, status];
    });
  }, []);

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
          criteria: preview.criteria,
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

  // ── Render: Header (shared across all steps) ──────────────────────

  const headerTitle = (() => {
    switch (step) {
      case "criteria": return "Prune Completed Items";
      case "preview": return "Dry-Run Preview";
      case "confirm": return "Confirm Prune";
      case "result": return "Prune Complete";
    }
  })();

  const renderHeader = () =>
    h("div", { class: "prune-confirmation-header" },
      h("h3", null, headerTitle),
      h("button", {
        class: "prune-confirmation-close",
        onClick: onCancel,
        title: "Cancel",
        "aria-label": "Cancel prune",
        disabled: pruning,
      }, "\u00d7"),
    );

  // ── Render: Loading ────────────────────────────────────────────────

  if (loading) {
    return h("div", { class: "prune-confirmation" },
      renderHeader(),
      h("div", { class: "prune-confirmation-loading" },
        h("div", { class: "rex-analyze-spinner" }),
        h("span", null, "Scanning for eligible items..."),
      ),
    );
  }

  // ── Render: Fatal Error ────────────────────────────────────────────

  if (error && !preview && step !== "criteria") {
    return h("div", { class: "prune-confirmation" },
      renderHeader(),
      h("div", { class: "prune-confirmation-error", role: "alert" }, error),
      h("div", { class: "prune-confirmation-actions" },
        h("button", {
          class: "prune-confirmation-btn prune-confirmation-btn-cancel",
          onClick: () => { setError(null); setStep("criteria"); },
        }, "Back to Criteria"),
      ),
    );
  }

  // ── Render: Result ─────────────────────────────────────────────────

  if (step === "result" && result) {
    return h("div", { class: "prune-confirmation" },
      renderHeader(),
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
              h("code", null, basename(result.backupPath)),
            )
          : null,
      ),
    );
  }

  // ── Render: Criteria Configuration ─────────────────────────────────

  if (step === "criteria") {
    return h("div", { class: "prune-confirmation" },
      renderHeader(),

      // Description
      h("p", { class: "prune-criteria-desc" },
        "Configure which completed items are eligible for pruning. Only fully completed subtrees (where all children are also complete) will be included.",
      ),

      // Status filter
      h("div", { class: "prune-criteria-section" },
        h("label", { class: "prune-criteria-label" }, "Eligible statuses"),
        h("div", { class: "prune-criteria-chips" },
          STATUS_OPTIONS.map(({ value, label }) =>
            h("button", {
              key: value,
              class: `prune-criteria-chip${selectedStatuses.includes(value) ? " active" : ""}`,
              onClick: () => toggleStatus(value),
              "aria-pressed": String(selectedStatuses.includes(value)),
            }, label),
          ),
        ),
      ),

      // Age threshold
      h("div", { class: "prune-criteria-section" },
        h("label", { class: "prune-criteria-label" }, "Minimum completion age"),
        h("select", {
          class: "prune-criteria-select",
          value: String(minAgeDays),
          onChange: (e: Event) => setMinAgeDays(Number((e.target as HTMLSelectElement).value)),
        },
          AGE_OPTIONS.map(({ value, label }) =>
            h("option", { key: value, value: String(value) }, label),
          ),
        ),
        h("span", { class: "prune-criteria-hint" },
          minAgeDays === 0
            ? "All completed items are eligible regardless of when they were completed."
            : `Only items completed ${minAgeDays}+ days ago will be included.`,
        ),
      ),

      // Error from a previous failed preview
      error
        ? h("div", { class: "prune-confirmation-error", role: "alert" }, error)
        : null,

      // Actions
      h("div", { class: "prune-confirmation-actions" },
        h("button", {
          class: "prune-confirmation-btn prune-confirmation-btn-cancel",
          onClick: onCancel,
        }, "Cancel"),
        h("button", {
          class: "prune-confirmation-btn prune-confirmation-btn-next",
          onClick: () => fetchPreview(),
          disabled: selectedStatuses.length === 0,
        }, "Dry Run"),
      ),
    );
  }

  // ── Render: Preview (Dry-Run) / Confirm ────────────────────────────

  // Nothing to prune
  if (step === "preview" && preview && !preview.hasPrunableItems) {
    return h("div", { class: "prune-confirmation" },
      renderHeader(),

      // Show active criteria
      h("div", { class: "prune-criteria-active" },
        h("span", { class: "prune-criteria-active-label" }, "Criteria:"),
        h("span", { class: "prune-criteria-active-value" },
          `${preview.criteria.statuses.join(", ")}`,
        ),
        preview.criteria.minAgeDays > 0
          ? h("span", { class: "prune-criteria-active-value" },
              `${preview.criteria.minAgeDays}+ days old`,
            )
          : null,
      ),

      h("div", { class: "prune-confirmation-empty" },
        h("p", null, "Nothing to prune with current criteria."),
        h("p", { class: "prune-confirmation-hint" },
          "Only fully completed subtrees (all children also completed) are eligible. Try adjusting the criteria.",
        ),
      ),
      h("div", { class: "prune-confirmation-actions" },
        h("button", {
          class: "prune-confirmation-btn prune-confirmation-btn-cancel",
          onClick: () => { setStep("criteria"); setPreview(null); },
        }, "Adjust Criteria"),
        h("button", {
          class: "prune-confirmation-btn prune-confirmation-btn-cancel",
          onClick: onCancel,
        }, "Close"),
      ),
    );
  }

  return h("div", { class: "prune-confirmation" },
    // Header
    renderHeader(),

    // Active criteria summary
    preview ? h("div", { class: "prune-criteria-active" },
      h("span", { class: "prune-criteria-active-label" }, "Criteria:"),
      h("span", { class: "prune-criteria-active-value" },
        preview.criteria.statuses.join(", "),
      ),
      preview.criteria.minAgeDays > 0
        ? h("span", { class: "prune-criteria-active-value" },
            `${preview.criteria.minAgeDays}+ days`,
          )
        : null,
      step === "preview"
        ? h("button", {
            class: "prune-criteria-edit-btn",
            onClick: () => { setStep("criteria"); setPreview(null); },
            title: "Edit pruning criteria",
          }, "Edit")
        : null,
    ) : null,

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

    // Dry-run badge (preview step)
    step === "preview"
      ? h("div", { class: "prune-dryrun-badge" },
          h("span", { class: "prune-dryrun-icon" }, "\u25B6"),
          "Dry-run preview \u2014 no changes have been made",
        )
      : null,

    // Impact summary with storage estimation
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
        h("span", null, ` subtree${preview.items.length !== 1 ? "s" : ""}`),
      ),
      // Storage savings estimation
      h("div", { class: "prune-storage-stat" },
        h("span", { class: "prune-storage-savings" },
          formatBytes(preview.estimatedBytes),
        ),
        h("span", null, " estimated savings"),
        preview.totalPrdBytes > 0
          ? h("span", { class: "prune-storage-pct" },
              ` (${Math.round((preview.estimatedBytes / preview.totalPrdBytes) * 100)}% of PRD)`,
            )
          : null,
      ),
      // Level breakdown
      Object.keys(preview.levelBreakdown).length > 0
        ? h("div", { class: "prune-confirmation-breakdown" },
            Object.entries(preview.levelBreakdown).map(([level, count]) =>
              h("span", {
                key: level,
                class: `prune-confirmation-level-chip prd-level-${level}`,
              },
                `${count} ${count !== 1 ? getLevelPlural(level).toLowerCase() : getLevelLabel(level).toLowerCase()}`,
              ),
            ),
          )
        : null,
    ) : null,

    // Preview step — view toggle and details
    step === "preview" && preview ? h("div", { class: "prune-confirmation-items" },
      // View toggle tabs
      h("div", { class: "prune-diff-view-toggle" },
        h("button", {
          class: `prune-diff-view-tab${previewView === "diff" ? " active" : ""}`,
          onClick: () => setPreviewView("diff"),
        }, "\u{1F333} Tree Diff"),
        h("button", {
          class: `prune-diff-view-tab${previewView === "list" ? " active" : ""}`,
          onClick: () => setPreviewView("list"),
        }, "\u{1F4CB} Item List"),
      ),

      // Diff tree view
      previewView === "diff" && preview.prunableIds && preview.epicImpact
        ? h(PruneDiffTree, {
            prunableIds: new Set(preview.prunableIds),
            epicImpact: preview.epicImpact,
          })
        : null,

      // Flat list view (original)
      previewView === "list"
        ? h("div", null,
            h("h4", null, "Items to be pruned:"),
            h("div", { class: "prune-confirmation-item-list" },
              preview.items.map((item) =>
                h("div", {
                  key: item.id,
                  class: "prune-confirmation-item",
                },
                  h("span", { class: `prune-confirmation-item-icon prd-level-${item.level}` },
                    PRUNE_ICONS[item.level] ?? "\u2022",
                  ),
                  h("span", { class: "prune-confirmation-item-title" }, item.title),
                  h("span", { class: `prd-level-badge prd-level-${item.level}` },
                    getLevelLabel(item.level),
                  ),
                  item.totalCount > 1
                    ? h("span", { class: "prune-confirmation-item-count" },
                        `${item.totalCount} items`,
                      )
                    : null,
                  item.completedAt
                    ? h("span", { class: "prune-confirmation-item-age" },
                        formatAge(item.completedAt),
                      )
                    : null,
                ),
              ),
            ),
          )
        : null,
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
        onClick: step === "confirm"
          ? () => setStep("preview")
          : step === "preview"
            ? () => { setStep("criteria"); setPreview(null); }
            : onCancel,
        disabled: pruning,
      }, step === "confirm" ? "Back" : step === "preview" ? "Adjust Criteria" : "Cancel"),

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
