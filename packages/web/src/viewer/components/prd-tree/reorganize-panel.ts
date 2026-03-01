/**
 * Reorganize panel — slide-out panel for reviewing and applying
 * structural reorganization proposals.
 *
 * Fetches proposals from /api/rex/reorganize and allows selective
 * or bulk application via /api/rex/reorganize/apply.
 */

import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";

// ── Types ────────────────────────────────────────────────────────────

interface ReorganizationProposal {
  id: number;
  type: string;
  description: string;
  risk: "low" | "medium" | "high";
  confidence: number;
  items: string[];
}

interface ReorganizePanelProps {
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  merge: "⊕",
  move: "→",
  split: "⑂",
  delete: "✕",
  prune: "✂",
  collapse: "⊟",
};

const RISK_CLASSES: Record<string, string> = {
  low: "reorg-risk-low",
  medium: "reorg-risk-medium",
  high: "reorg-risk-high",
};

// ── Component ────────────────────────────────────────────────────────

export function ReorganizePanel({ open, onClose, onApplied }: ReorganizePanelProps) {
  const [proposals, setProposals] = useState<ReorganizationProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rex/reorganize");
      if (!res.ok) {
        setError(`Failed to fetch proposals (${res.status})`);
        return;
      }
      const data = await res.json();
      setProposals(data.proposals ?? []);
      setSelected(new Set());
    } catch {
      setError("Could not fetch reorganization proposals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchProposals();
      setResult(null);
    }
  }, [open, fetchProposals]);

  const toggleSelection = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const applySelected = useCallback(async () => {
    if (selected.size === 0) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/rex/reorganize/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalIds: [...selected] }),
      });
      if (!res.ok) {
        setError(`Apply failed (${res.status})`);
        return;
      }
      const data = await res.json();
      setResult(`Applied ${data.applied} proposal(s)${data.failed > 0 ? `, ${data.failed} failed` : ""}`);
      if (data.applied > 0) {
        onApplied?.();
        // Refresh proposals after applying
        await fetchProposals();
      }
    } catch {
      setError("Failed to apply proposals.");
    } finally {
      setApplying(false);
    }
  }, [selected, onApplied, fetchProposals]);

  const applyAllLowRisk = useCallback(async () => {
    const lowRiskIds = proposals.filter((p) => p.risk === "low").map((p) => p.id);
    if (lowRiskIds.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/rex/reorganize/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalIds: lowRiskIds }),
      });
      if (!res.ok) {
        setError(`Apply failed (${res.status})`);
        return;
      }
      const data = await res.json();
      setResult(`Applied ${data.applied} low-risk proposal(s)`);
      if (data.applied > 0) {
        onApplied?.();
        await fetchProposals();
      }
    } catch {
      setError("Failed to apply proposals.");
    } finally {
      setApplying(false);
    }
  }, [proposals, onApplied, fetchProposals]);

  if (!open) return null;

  const lowRiskCount = proposals.filter((p) => p.risk === "low").length;

  return h("div", { class: "reorg-overlay" },
    h("div", { class: "reorg-panel" },
      // Header
      h("div", { class: "reorg-header" },
        h("h3", null, "Reorganize PRD"),
        h("button", { class: "reorg-close", onClick: onClose, "aria-label": "Close" }, "×"),
      ),

      // Content
      h("div", { class: "reorg-body" },
        error ? h("div", { class: "reorg-error" }, error) : null,
        result ? h("div", { class: "reorg-success" }, result) : null,

        loading
          ? h("div", { class: "reorg-loading" }, "Analyzing structure...")
          : proposals.length === 0
            ? h("div", { class: "reorg-empty" }, "No structural issues detected.")
            : h("div", { class: "reorg-list" },
                proposals.map((p) =>
                  h("label", {
                    key: p.id,
                    class: `reorg-card ${selected.has(p.id) ? "reorg-card-selected" : ""}`,
                  },
                    h("input", {
                      type: "checkbox",
                      checked: selected.has(p.id),
                      onChange: () => toggleSelection(p.id),
                      class: "reorg-checkbox",
                    }),
                    h("div", { class: "reorg-card-content" },
                      h("div", { class: "reorg-card-top" },
                        h("span", { class: "reorg-type-icon" }, TYPE_ICONS[p.type] ?? "?"),
                        h("span", { class: "reorg-type-label" }, p.type),
                        h("span", { class: `reorg-risk ${RISK_CLASSES[p.risk] ?? ""}` }, p.risk),
                        h("span", { class: "reorg-confidence" }, `${Math.round(p.confidence * 100)}%`),
                      ),
                      h("div", { class: "reorg-description" }, p.description),
                      p.items.length > 0
                        ? h("div", { class: "reorg-affected" },
                            `Affects: ${p.items.join(", ")}`,
                          )
                        : null,
                    ),
                  ),
                ),
              ),
      ),

      // Footer
      proposals.length > 0
        ? h("div", { class: "reorg-footer" },
            lowRiskCount > 0
              ? h("button", {
                  class: "reorg-btn reorg-btn-secondary",
                  onClick: applyAllLowRisk,
                  disabled: applying,
                }, `Apply All Low-Risk (${lowRiskCount})`)
              : null,
            h("button", {
              class: "reorg-btn reorg-btn-primary",
              onClick: applySelected,
              disabled: applying || selected.size === 0,
            }, applying ? "Applying..." : `Apply Selected (${selected.size})`),
          )
        : null,
    ),
  );
}
