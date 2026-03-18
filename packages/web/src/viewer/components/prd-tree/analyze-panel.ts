/**
 * Analyze panel — triggers Rex analysis and displays proposals.
 *
 * Provides a button to trigger analysis, shows real-time progress,
 * displays resulting proposals, and allows accepting them into the PRD.
 */

import { h, Fragment } from "preact";
import { useState, useCallback, useEffect } from "preact/hooks";
import { ProposalEditor } from "./proposal-editor.js";
import type { RawProposal } from "./proposal-editor.js";
import type { Proposal, ProposalFeature, ProposalTask } from "@n-dx/rex";

// ── Types ────────────────────────────────────────────────────────────

export interface AnalyzePanelProps {
  /** Called when proposals are accepted and PRD should be refreshed. */
  onPrdChanged: () => void;
}

type AnalyzeState = "idle" | "running" | "done" | "error";

// ── Component ────────────────────────────────────────────────────────

export function AnalyzePanel({ onPrdChanged }: AnalyzePanelProps) {
  const [state, setState] = useState<AnalyzeState>("idle");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [noLlm, setNoLlm] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptedIndices, setAcceptedIndices] = useState<Set<number>>(new Set());
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState(false);

  // Load any pending proposals on first render
  const loadPending = useCallback(async () => {
    try {
      const res = await fetch("/api/rex/proposals");
      if (res.ok) {
        const data = await res.json();
        if (data.proposals && data.proposals.length > 0) {
          setProposals(data.proposals);
          setState("done");
          // Pre-select all
          setSelectedIndices(new Set(data.proposals.map((_: Proposal, i: number) => i)));
        }
      }
    } catch {
      // Ignore — will be populated after analysis
    }
  }, []);

  // Load pending on first render
  useEffect(() => { loadPending(); }, []);

  const handleAnalyze = useCallback(async () => {
    setState("running");
    setError(null);
    setProposals([]);
    setAcceptedIndices(new Set());

    try {
      const res = await fetch("/api/rex/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noLlm }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const data = await res.json();

      if (data.proposals && data.proposals.length > 0) {
        setProposals(data.proposals);
        setSelectedIndices(new Set(data.proposals.map((_: Proposal, i: number) => i)));
        setState("done");
      } else {
        // Check for pending proposals after analysis
        const pendingRes = await fetch("/api/rex/proposals");
        if (pendingRes.ok) {
          const pendingData = await pendingRes.json();
          if (pendingData.proposals && pendingData.proposals.length > 0) {
            setProposals(pendingData.proposals);
            setSelectedIndices(new Set(pendingData.proposals.map((_: Proposal, i: number) => i)));
            setState("done");
            return;
          }
        }
        setProposals([]);
        setState("done");
      }
    } catch (err) {
      setError(String(err));
      setState("error");
    }
  }, [noLlm]);

  const handleAccept = useCallback(async () => {
    if (selectedIndices.size === 0) return;

    setAccepting(true);
    try {
      const indices = [...selectedIndices];
      const res = await fetch("/api/rex/proposals/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indices }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Accept failed" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setAcceptedIndices(new Set([...acceptedIndices, ...selectedIndices]));

      // Remove accepted proposals from the list
      const remaining = proposals.filter((_, i) => !selectedIndices.has(i));
      setProposals(remaining);
      setSelectedIndices(new Set());

      if (remaining.length === 0) {
        setState("idle");
      }

      onPrdChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setAccepting(false);
    }
  }, [selectedIndices, proposals, acceptedIndices, onPrdChanged]);

  const toggleProposal = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIndices(new Set(proposals.map((_, i) => i)));
  }, [proposals]);

  const selectNone = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

  const handleEditorAccepted = useCallback(() => {
    setEditing(false);
    setProposals([]);
    setState("idle");
    onPrdChanged();
  }, [onPrdChanged]);

  // When in editing mode, render the ProposalEditor
  if (editing && proposals.length > 0) {
    return h(
      "div",
      { class: "rex-analyze-panel" },
      h(ProposalEditor, {
        proposals: proposals as RawProposal[],
        onAccepted: handleEditorAccepted,
        onCancel: () => setEditing(false),
      }),
    );
  }

  return h(
    "div",
    { class: "rex-analyze-panel" },

    // Header
    h("div", { class: "rex-analyze-header" },
      h("h3", { class: "rex-analyze-title" }, "Analyze Project"),
    ),

    // Controls
    h("div", { class: "rex-analyze-controls" },
      h("label", { class: "rex-analyze-checkbox-label" },
        h("input", {
          type: "checkbox",
          checked: noLlm,
          onChange: () => setNoLlm(!noLlm),
        }),
        " Skip LLM refinement (faster, less refined)",
      ),
      h("button", {
        class: "rex-analyze-btn rex-analyze-btn-run",
        onClick: handleAnalyze,
        disabled: state === "running",
      }, state === "running" ? "Analyzing..." : "Run Analysis"),
    ),

    // Progress indicator
    state === "running"
      ? h("div", { class: "rex-analyze-progress", role: "status", "aria-live": "polite" },
          h("div", { class: "rex-analyze-spinner", "aria-hidden": "true" }),
          h("span", null, "Scanning project and building proposals..."),
        )
      : null,

    // Error display
    error
      ? h("div", { class: "rex-analyze-error", role: "alert", "aria-live": "assertive" }, error)
      : null,

    // Results
    state === "done" && proposals.length === 0
      ? h("div", { class: "rex-analyze-empty" },
          h("p", null, "No new proposals found."),
          h("p", { class: "rex-analyze-hint" }, "The project may already be fully tracked in the PRD."),
        )
      : null,

    state === "done" && proposals.length > 0
      ? h(Fragment, null,
          // Selection controls
          h("div", { class: "rex-analyze-selection" },
            h("span", { class: "rex-analyze-count" },
              `${selectedIndices.size} of ${proposals.length} selected`,
            ),
            h("button", {
              class: "rex-analyze-select-btn",
              onClick: selectAll,
            }, "Select All"),
            h("button", {
              class: "rex-analyze-select-btn",
              onClick: selectNone,
            }, "Select None"),
          ),

          // Proposal list
          h("div", { class: "rex-analyze-proposals" },
            proposals.map((proposal, index) =>
              h(ProposalCard, {
                key: index,
                proposal,
                index,
                selected: selectedIndices.has(index),
                onToggle: () => toggleProposal(index),
              }),
            ),
          ),

          // Accept bar with Review & Edit and Accept buttons
          h("div", { class: "rex-analyze-accept-bar" },
            h("button", {
              class: "rex-analyze-btn rex-analyze-btn-review",
              onClick: () => setEditing(true),
              disabled: accepting,
            }, "\u270E Review & Edit"),
            h("button", {
              class: "rex-analyze-btn rex-analyze-btn-accept",
              onClick: handleAccept,
              disabled: accepting || selectedIndices.size === 0,
            }, accepting
              ? "Accepting..."
              : `Accept ${selectedIndices.size} Proposal${selectedIndices.size !== 1 ? "s" : ""}`,
            ),
          ),
        )
      : null,
  );
}

// ── Proposal Card ────────────────────────────────────────────────────

interface ProposalCardProps {
  proposal: Proposal;
  index: number;
  selected: boolean;
  onToggle: () => void;
}

function ProposalCard({ proposal, index, selected, onToggle }: ProposalCardProps) {
  const [expanded, setExpanded] = useState(false);

  const taskCount = proposal.features.reduce((sum, f) => sum + f.tasks.length, 0);

  return h(
    "div",
    { class: `rex-proposal-card${selected ? " selected" : ""}` },

    // Card header
    h("div", {
      class: "rex-proposal-header",
      onClick: onToggle,
      role: "button",
      tabIndex: 0,
      "aria-label": `${selected ? "Deselect" : "Select"} proposal: ${proposal.epic.title}`,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      },
    },
      h("input", {
        type: "checkbox",
        checked: selected,
        onChange: onToggle,
        onClick: (e: Event) => e.stopPropagation(),
        "aria-label": `Select proposal: ${proposal.epic.title}`,
      }),
      h("div", { class: "rex-proposal-info" },
        h("span", { class: "prd-level-badge prd-level-epic" }, "Epic"),
        h("span", { class: "rex-proposal-title" }, proposal.epic.title),
      ),
      h("span", { class: "rex-proposal-count" },
        `${proposal.features.length} features, ${taskCount} tasks`,
      ),
      h("button", {
        class: `rex-proposal-expand${expanded ? " open" : ""}`,
        onClick: (e: Event) => {
          e.stopPropagation();
          setExpanded(!expanded);
        },
        "aria-label": expanded ? "Collapse" : "Expand",
      }, "\u25B6"),
    ),

    // Expanded details
    expanded
      ? h("div", { class: "rex-proposal-details" },
          proposal.epic.description
            ? h("p", { class: "rex-proposal-desc" }, proposal.epic.description)
            : null,
          proposal.features.map((feature, fi) =>
            h("div", { key: fi, class: "rex-proposal-feature" },
              h("div", { class: "rex-proposal-feature-header" },
                h("span", { class: "prd-level-badge prd-level-feature" }, "Feature"),
                h("span", null, feature.title),
              ),
              feature.tasks.length > 0
                ? h("div", { class: "rex-proposal-tasks" },
                    feature.tasks.map((task, ti) =>
                      h("div", { key: ti, class: "rex-proposal-task" },
                        h("span", { class: "prd-level-badge prd-level-task" }, "Task"),
                        h("span", { class: "rex-proposal-task-title" }, task.title),
                        task.priority
                          ? h("span", { class: `prd-priority-badge prd-priority-${task.priority}` }, task.priority)
                          : null,
                      ),
                    ),
                  )
                : null,
            ),
          ),
        )
      : null,
  );
}
