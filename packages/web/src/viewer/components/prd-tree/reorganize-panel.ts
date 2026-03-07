/**
 * Reorganize panel — slide-out panel for reviewing and applying
 * structural and LLM-powered reorganization proposals.
 *
 * Fetches proposals from /api/rex/reorganize and allows selective
 * or bulk application via /api/rex/reorganize/apply.
 */

import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";

// ── Types ────────────────────────────────────────────────────────

interface ReorganizationProposal {
  id: number;
  type: string;
  description: string;
  risk: "low" | "medium" | "high";
  confidence: number;
  items: string[];
}

interface LlmProposal {
  id: string;
  action: string;
  reason: string;
}

interface ReorganizePanelProps {
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  merge: "⊕",
  move: "→",
  split: "⑂",
  delete: "✕",
  prune: "✂",
  collapse: "⊟",
};

const LLM_ACTION_ICONS: Record<string, string> = {
  merge: "⊕",
  update: "✎",
  reparent: "→",
  obsolete: "✕",
  split: "⑂",
};

const RISK_CLASSES: Record<string, string> = {
  low: "reorg-risk-low",
  medium: "reorg-risk-medium",
  high: "reorg-risk-high",
};

// ── Component ────────────────────────────────────────────────────

export function ReorganizePanel({ open, onClose, onApplied }: ReorganizePanelProps) {
  const [proposals, setProposals] = useState<ReorganizationProposal[]>([]);
  const [llmProposals, setLlmProposals] = useState<LlmProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedLlm, setSelectedLlm] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rex/reorganize?mode=fast");
      if (!res.ok) {
        setError(`Failed to fetch proposals (${res.status})`);
        return;
      }
      const data = await res.json();
      // Support both old format (data.proposals) and new format (data.structural)
      const structural = data.structural ?? data;
      setProposals(structural.proposals ?? []);
      setLlmProposals(data.llm ?? []);
      setSelected(new Set());
      setSelectedLlm(new Set());
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

  const toggleLlmSelection = useCallback((id: string) => {
    setSelectedLlm((prev) => {
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
    if (selected.size === 0 && selectedLlm.size === 0) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/rex/reorganize/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalIds: [...selected],
          llmProposalIds: [...selectedLlm],
        }),
      });
      if (!res.ok) {
        setError(`Apply failed (${res.status})`);
        return;
      }
      const data = await res.json();
      setResult(`Applied ${data.applied} proposal(s)${data.failed > 0 ? `, ${data.failed} failed` : ""}`);
      if (data.applied > 0) {
        onApplied?.();
        await fetchProposals();
      }
    } catch {
      setError("Failed to apply proposals.");
    } finally {
      setApplying(false);
    }
  }, [selected, selectedLlm, onApplied, fetchProposals]);

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
  const totalSelected = selected.size + selectedLlm.size;
  const hasProposals = proposals.length > 0;
  const hasLlmProposals = llmProposals.length > 0;

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
          : !hasProposals && !hasLlmProposals
            ? h("div", { class: "reorg-empty" }, "No structural issues detected.")
            : h("div", { class: "reorg-list" },
                // Structural proposals section
                hasProposals
                  ? h("div", null,
                      h("div", { class: "reorg-section-header" }, "Structural Proposals"),
                      proposals.map((p) =>
                        h("label", {
                          key: `s-${p.id}`,
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
                    )
                  : null,

                // LLM proposals section
                hasLlmProposals
                  ? h("div", null,
                      h("div", { class: "reorg-section-header" }, "LLM Proposals"),
                      llmProposals.map((p) =>
                        h("label", {
                          key: `l-${p.id}`,
                          class: `reorg-card ${selectedLlm.has(p.id) ? "reorg-card-selected" : ""} reorg-card-llm`,
                        },
                          h("input", {
                            type: "checkbox",
                            checked: selectedLlm.has(p.id),
                            onChange: () => toggleLlmSelection(p.id),
                            class: "reorg-checkbox",
                          }),
                          h("div", { class: "reorg-card-content" },
                            h("div", { class: "reorg-card-top" },
                              h("span", { class: "reorg-type-icon" }, LLM_ACTION_ICONS[p.action] ?? "?"),
                              h("span", { class: "reorg-type-label" }, p.action),
                              h("span", { class: "reorg-source-badge" }, "LLM"),
                            ),
                            h("div", { class: "reorg-description" }, p.reason),
                          ),
                        ),
                      ),
                    )
                  : null,
              ),
      ),

      // Footer
      (hasProposals || hasLlmProposals)
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
              disabled: applying || totalSelected === 0,
            }, applying ? "Applying..." : `Apply Selected (${totalSelected})`),
          )
        : null,
    ),
  );
}
