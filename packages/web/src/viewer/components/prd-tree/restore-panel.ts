/**
 * Restore panel — slide-out panel listing PRD tree snapshots and restoring one.
 *
 * Snapshots are written automatically before reorganize/prune/reshape/fix run
 * (see packages/rex/src/core/backup-snapshots.ts). This is the in-app undo for
 * those mutations — mirrors the CLI's own `rex restore`, listing from
 * GET /api/rex/backups and restoring via POST /api/rex/restore.
 */

import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";

// ── Types ────────────────────────────────────────────────────────

interface Snapshot {
  id: string;
  timestamp: string;
  files: number;
  isLatest: boolean;
}

export interface RestorePanelProps {
  open: boolean;
  onClose: () => void;
  onRestored?: () => void;
}

type RestoreStep = "list" | "confirm" | "result";

// ── Component ────────────────────────────────────────────────────

export function RestorePanel({ open, onClose, onRestored }: RestorePanelProps) {
  const [step, setStep] = useState<RestoreStep>("list");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredFiles, setRestoredFiles] = useState<number | null>(null);

  const fetchSnapshots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rex/backups");
      if (!res.ok) {
        setError(`Failed to list snapshots (${res.status})`);
        return;
      }
      const data = await res.json();
      setSnapshots(data.snapshots ?? []);
    } catch {
      setError("Could not fetch PRD snapshots.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setStep("list");
      setSelected(null);
      setError(null);
      setRestoredFiles(null);
      fetchSnapshots();
    }
  }, [open, fetchSnapshots]);

  const chooseSnapshot = useCallback((snapshot: Snapshot) => {
    setSelected(snapshot);
    setStep("confirm");
  }, []);

  const handleRestore = useCallback(async () => {
    if (!selected) return;
    setRestoring(true);
    setError(null);
    try {
      const res = await fetch("/api/rex/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, confirmFiles: selected.files }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(errBody.error || `Restore failed (${res.status})`);
        return;
      }
      const data = await res.json();
      setRestoredFiles(data.files ?? selected.files);
      setStep("result");
      onRestored?.();
    } catch {
      setError("Failed to restore snapshot.");
    } finally {
      setRestoring(false);
    }
  }, [selected, onRestored]);

  if (!open) return null;

  return h("div", { class: "reorg-overlay" },
    h("div", { class: "reorg-panel restore-panel" },
      // Header
      h("div", { class: "reorg-header" },
        h("h3", null, "Restore PRD Snapshot"),
        h("button", {
          class: "reorg-close", onClick: onClose, "aria-label": "Close",
          disabled: restoring,
        }, "×"),
      ),

      h("div", { class: "reorg-body restore-panel-body" },

        // ── List step ──────────────────────────────────────────
        step === "list" ? h("div", null,
          h("p", { class: "restore-panel-desc" },
            "Snapshots are written automatically before Reorganize, Prune, Reshape, or Fix run. Restoring replaces the current PRD tree — changes made after the snapshot was taken will be lost.",
          ),
          error ? h("div", { class: "reorg-error" }, error) : null,
          loading
            ? h("div", { class: "reorg-loading" }, "Loading snapshots...")
            : snapshots.length === 0
              ? h("div", { class: "reorg-empty" },
                  "No PRD snapshots found yet — one will be created the next time Reorganize, Prune, Reshape, or Fix runs.",
                )
              : h("div", { class: "restore-panel-list" },
                  snapshots.map((s) =>
                    h("div", { key: s.id, class: "restore-panel-row" },
                      h("div", { class: "restore-panel-row-info" },
                        h("span", { class: "restore-panel-row-timestamp" }, s.timestamp),
                        s.isLatest ? h("span", { class: "restore-panel-badge" }, "Latest") : null,
                        h("span", { class: "restore-panel-row-files" }, `${s.files} file${s.files !== 1 ? "s" : ""}`),
                      ),
                      h("button", {
                        class: "reorg-btn reorg-btn-secondary",
                        onClick: () => chooseSnapshot(s),
                      }, "Restore"),
                    ),
                  ),
                ),
        ) : null,

        // ── Confirm step ───────────────────────────────────────
        step === "confirm" && selected ? h("div", null,
          h("div", { class: "prune-confirmation-warning", role: "alert" },
            h("div", { class: "prune-confirmation-warning-icon" }, "⚠"),
            h("div", null,
              h("strong", null, "This replaces the current PRD tree."),
              h("p", null,
                `Restoring snapshot ${selected.timestamp} (${selected.files} files) will overwrite .rex/prd_tree/. Any change made after that snapshot was taken will be lost. The snapshot itself is not consumed — you can restore it again later.`,
              ),
            ),
          ),
          error ? h("div", { class: "reorg-error" }, error) : null,
          h("div", { class: "reorg-footer restore-panel-footer" },
            h("button", {
              class: "reorg-btn reorg-btn-secondary",
              onClick: () => { setStep("list"); setSelected(null); },
              disabled: restoring,
            }, "Back"),
            h("button", {
              class: "reorg-btn reorg-btn-primary",
              onClick: handleRestore,
              disabled: restoring,
            }, restoring ? "Restoring..." : `Restore ${selected.files} File${selected.files !== 1 ? "s" : ""}`),
          ),
        ) : null,

        // ── Result step ────────────────────────────────────────
        step === "result" ? h("div", null,
          h("div", { class: "reorg-success", role: "status" },
            `Restored ${restoredFiles ?? 0} file${restoredFiles !== 1 ? "s" : ""} from snapshot.`,
          ),
          h("div", { class: "reorg-footer restore-panel-footer" },
            h("button", {
              class: "reorg-btn reorg-btn-primary",
              onClick: onClose,
            }, "Done"),
          ),
        ) : null,
      ),
    ),
  );
}
