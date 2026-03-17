/**
 * Smart add input — natural language input with debounced proposal generation.
 *
 * Provides a text input field that sends debounced requests to the
 * smart-add-preview API endpoint. Displays loading states, structured
 * proposal previews with hierarchy, and confidence indicators.
 * Includes context selection (scope proposals under an epic/feature),
 * real-time character count, and example prompts for better input.
 * Proposals can be sent to the ProposalEditor for review or accepted directly.
 */

import { h, Fragment } from "preact";
import { useState, useCallback, useRef, useEffect, useMemo } from "preact/hooks";
import { ProposalEditor } from "./proposal-editor.js";
import type { RawProposal } from "./proposal-editor.js";
import { isContainerLevel, isRootLevel, getLevelLabel } from "./levels.js";

// ── Types ────────────────────────────────────────────────────────────

export interface SmartAddInputProps {
  /** Called when proposals are accepted and PRD should be refreshed. */
  onPrdChanged: () => void;
  /** When true, renders in a compact layout suitable for dashboard embedding. */
  compact?: boolean;
}

interface QualityIssue {
  level: string;
  path: string;
  message: string;
}

type PreviewState = "idle" | "loading" | "done" | "error";

/** Flattened scope option for the context dropdown. */
interface ScopeOption {
  id: string;
  title: string;
  level: string;
  depth: number;
}

// ── Constants ────────────────────────────────────────────────────────

/** Minimum input length before allowing submission. */
const MIN_INPUT_LENGTH = 10;

/** Example prompts to guide user input. */
const EXAMPLE_PROMPTS = [
  "Add user authentication with OAuth2 and JWT tokens",
  "Create a settings page with profile editing and notification preferences",
  "Add dark mode support with system preference detection",
  "Implement real-time search with debounced filtering and result highlights",
];

// ── Component ────────────────────────────────────────────────────────

export function SmartAddInput({ onPrdChanged, compact }: SmartAddInputProps) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<PreviewState>("idle");
  const [proposals, setProposals] = useState<RawProposal[]>([]);
  const [confidence, setConfidence] = useState(0);
  const [qualityIssues, setQualityIssues] = useState<QualityIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [accepting, setAccepting] = useState(false);

  // Context selection state
  const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([]);
  const [selectedScope, setSelectedScope] = useState("");
  const [scopeLoaded, setScopeLoaded] = useState(false);

  // Track the latest request to ignore stale responses
  const requestIdRef = useRef(0);

  // Abort controller for cancelling in-flight requests
  const abortRef = useRef<AbortController | null>(null);

  // ── Load scope options (epics & features) ─────────────────────────

  useEffect(() => {
    if (scopeLoaded) return;
    let cancelled = false;

    async function loadScopes() {
      try {
        const res = await fetch("/api/rex/prd");
        if (!res.ok) return;
        const doc = await res.json();
        if (cancelled) return;

        const options: ScopeOption[] = [];
        function walk(items: Array<{ id: string; title: string; level: string; children?: unknown[] }>, depth: number) {
          for (const item of items) {
            if (isContainerLevel(item.level)) {
              options.push({ id: item.id, title: item.title, level: item.level, depth });
              if (isRootLevel(item.level) && Array.isArray(item.children)) {
                walk(item.children as typeof items, depth + 1);
              }
            }
          }
        }
        if (Array.isArray(doc.items)) walk(doc.items, 0);
        setScopeOptions(options);
      } catch {
        // Non-critical — scope selection simply stays empty
      } finally {
        if (!cancelled) setScopeLoaded(true);
      }
    }

    loadScopes();
    return () => { cancelled = true; };
  }, [scopeLoaded]);

  // Refresh scope options when PRD changes
  const refreshScopes = useCallback(() => {
    setScopeLoaded(false);
  }, []);

  // Character count derived state
  const charCount = input.length;
  const trimmedLength = input.trim().length;

  // ── Debounced preview ────────────────────────────────────────────

  const triggerPreview = useCallback(async (text: string, reqId: number, parentId?: string) => {
    // Abort any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setState("loading");
    setError(null);

    try {
      const body: Record<string, string> = { text };
      if (parentId) body.parentId = parentId;

      const res = await fetch("/api/rex/smart-add-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Ignore stale responses
      if (reqId !== requestIdRef.current) return;

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Preview failed" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const data = await res.json();

      // Ignore stale responses (double-check after await)
      if (reqId !== requestIdRef.current) return;

      setProposals(data.proposals ?? []);
      setConfidence(data.confidence ?? 0);
      setQualityIssues(data.qualityIssues ?? []);
      setState(data.proposals?.length > 0 ? "done" : "done");
    } catch (err) {
      // Ignore abort errors
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Ignore stale responses
      if (reqId !== requestIdRef.current) return;
      setError(String(err));
      setState("error");
    }
  }, []);

  const handleInput = useCallback((text: string) => {
    setInput(text);
  }, []);

  /** Explicit submit — only way to trigger proposal generation. */
  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (text.length < MIN_INPUT_LENGTH) return;

    const reqId = ++requestIdRef.current;
    triggerPreview(text, reqId, selectedScope || undefined);
  }, [input, triggerPreview, selectedScope]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // ── Accept proposals ─────────────────────────────────────────────

  const handleAccept = useCallback(async () => {
    if (proposals.length === 0) return;

    setAccepting(true);
    try {
      // Build the payload in the edited-proposals format (all selected)
      const payload = proposals.map((p) => ({
        epic: { title: p.epic.title, description: p.epic.description },
        features: p.features.map((f) => ({
          title: f.title,
          description: f.description,
          tasks: f.tasks.map((t) => ({
            title: t.title,
            description: t.description,
            priority: t.priority,
            tags: t.tags,
            selected: true,
          })),
          selected: true,
        })),
        selected: true,
      }));

      const res = await fetch("/api/rex/proposals/accept-edited", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposals: payload }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Accept failed" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      // Reset state
      setInput("");
      setProposals([]);
      setConfidence(0);
      setState("idle");
      refreshScopes();
      onPrdChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setAccepting(false);
    }
  }, [proposals, onPrdChanged, refreshScopes]);

  // ── Editor callbacks ─────────────────────────────────────────────

  const handleEditorAccepted = useCallback(() => {
    setEditing(false);
    setInput("");
    setProposals([]);
    setConfidence(0);
    setState("idle");
    refreshScopes();
    onPrdChanged();
  }, [onPrdChanged, refreshScopes]);

  // ── Render: Proposal editor mode ─────────────────────────────────

  if (editing && proposals.length > 0) {
    return h(
      "div",
      { class: "smart-add-panel" },
      h(ProposalEditor, {
        proposals,
        onAccepted: handleEditorAccepted,
        onCancel: () => setEditing(false),
      }),
    );
  }

  // ── Render: Input + preview ──────────────────────────────────────

  const taskCount = proposals.reduce(
    (sum, p) => sum + p.features.reduce((fs, f) => fs + f.tasks.length, 0),
    0,
  );
  const featureCount = proposals.reduce((sum, p) => sum + p.features.length, 0);

  // Scope label for display
  const scopeLabel = useMemo(() => {
    if (!selectedScope) return null;
    const opt = scopeOptions.find((o) => o.id === selectedScope);
    return opt ? `${opt.level}: ${opt.title}` : null;
  }, [selectedScope, scopeOptions]);

  const panelClass = compact ? "smart-add-panel smart-add-panel-compact" : "smart-add-panel";

  return h(
    "div",
    { class: panelClass },

    // Header
    h("div", { class: "smart-add-header" },
      h("h3", { class: "smart-add-title" }, "Smart Add"),
      h("p", { class: "smart-add-subtitle" },
        "Describe what you want to build, then click Generate.",
      ),
    ),

    // Context selection dropdown
    scopeOptions.length > 0
      ? h("div", { class: "smart-add-scope" },
          h("label", { class: "smart-add-scope-label" }, "Scope"),
          h("select", {
            class: "smart-add-scope-select",
            value: selectedScope,
            onChange: (e: Event) => {
              setSelectedScope((e.target as HTMLSelectElement).value);
            },
            "aria-label": "Scope proposals under an existing epic or feature",
          },
            h("option", { value: "" }, "Entire project (new epics)"),
            scopeOptions.map((opt) =>
              h("option", { key: opt.id, value: opt.id },
                `${"  ".repeat(opt.depth)}${getLevelLabel(opt.level)}: ${opt.title}`,
              ),
            ),
          ),
          selectedScope
            ? h("span", { class: "smart-add-scope-active" },
                `Adding under ${scopeLabel}`,
              )
            : null,
        )
      : null,

    // Example prompts (shown when idle and no input)
    state === "idle" && trimmedLength === 0
      ? h("div", { class: "smart-add-examples" },
          h("span", { class: "smart-add-examples-label" }, "Try something like:"),
          h("div", { class: "smart-add-examples-list" },
            EXAMPLE_PROMPTS.map((example, i) =>
              h("button", {
                key: i,
                type: "button",
                class: "smart-add-example-chip",
                onClick: () => handleInput(example),
                "aria-label": `Use example: ${example}`,
              }, example),
            ),
          ),
        )
      : null,

    // Input area
    h("div", { class: "smart-add-input-area" },
      h("textarea", {
        class: "smart-add-textarea",
        value: input,
        placeholder: "Describe a feature, improvement, or idea...",
        onInput: (e: Event) => handleInput((e.target as HTMLTextAreaElement).value),
        rows: compact ? 3 : 4,
        "aria-label": "Smart add description",
      }),
      // Character count + status indicator
      h("div", { class: "smart-add-input-status" },
        // Character count (always visible when typing)
        charCount > 0
          ? h("span", {
              class: `smart-add-char-count${trimmedLength < MIN_INPUT_LENGTH ? " smart-add-char-count-warn" : ""}`,
            }, `${charCount} chars`)
          : null,
        // Min length hint
        trimmedLength > 0 && trimmedLength < MIN_INPUT_LENGTH
          ? h("span", { class: "smart-add-hint" },
              `${MIN_INPUT_LENGTH - trimmedLength} more to generate proposals`,
            )
          : null,
        // Loading badge
        state === "loading"
          ? h("span", { class: "smart-add-loading-badge" },
              h("span", { class: "smart-add-spinner", "aria-hidden": "true" }),
              " Generating...",
            )
          : null,
      ),
      // Generate button — sole trigger for proposal generation
      h("button", {
        class: "smart-add-btn smart-add-btn-generate",
        type: "button",
        disabled: trimmedLength < MIN_INPUT_LENGTH || state === "loading",
        onClick: handleSubmit,
        "aria-label": "Generate proposals",
      }, state === "loading" ? "Generating..." : "Generate"),
    ),

    // Loading state with progress
    state === "loading"
      ? h("div", { class: "smart-add-loading", role: "status", "aria-live": "polite" },
          h("div", { class: "smart-add-loading-bar" },
            h("div", { class: "smart-add-loading-bar-fill" }),
          ),
          h("span", { class: "smart-add-loading-text" },
            "Analyzing description and generating proposals...",
          ),
        )
      : null,

    // Error display
    error
      ? h("div", { class: "smart-add-error", role: "alert", "aria-live": "assertive" },
          h("span", { class: "smart-add-error-icon" }, "\u26A0"),
          h("span", null, error),
        )
      : null,

    // Results: proposal preview
    state === "done" && proposals.length === 0
      ? h("div", { class: "smart-add-empty" },
          h("p", null, "No proposals generated."),
          h("p", { class: "smart-add-empty-hint" },
            "Try a more detailed description or different phrasing.",
          ),
        )
      : null,

    state === "done" && proposals.length > 0
      ? h(Fragment, null,
          // Confidence bar
          h(ConfidenceBar, { confidence }),

          // Quality issues (if any)
          qualityIssues.length > 0
            ? h("div", { class: "smart-add-quality-issues" },
                h("span", { class: "smart-add-quality-icon" }, "\u26A0"),
                h("span", null, `${qualityIssues.length} quality warning${qualityIssues.length !== 1 ? "s" : ""}`),
              )
            : null,

          // Summary stats
          h("div", { class: "smart-add-stats" },
            h("span", { class: "smart-add-stat" },
              h("span", { class: "smart-add-stat-count" }, String(proposals.length)),
              ` epic${proposals.length !== 1 ? "s" : ""}`,
            ),
            h("span", { class: "smart-add-stat-sep" }, "\u2022"),
            h("span", { class: "smart-add-stat" },
              h("span", { class: "smart-add-stat-count" }, String(featureCount)),
              ` feature${featureCount !== 1 ? "s" : ""}`,
            ),
            h("span", { class: "smart-add-stat-sep" }, "\u2022"),
            h("span", { class: "smart-add-stat" },
              h("span", { class: "smart-add-stat-count" }, String(taskCount)),
              ` task${taskCount !== 1 ? "s" : ""}`,
            ),
          ),

          // Proposal hierarchy preview
          h("div", { class: "smart-add-preview" },
            proposals.map((proposal, pi) =>
              h(ProposalPreviewCard, { key: pi, proposal, index: pi }),
            ),
          ),

          // Action buttons
          h("div", { class: "smart-add-actions" },
            h("button", {
              class: "smart-add-btn smart-add-btn-review",
              onClick: () => setEditing(true),
              disabled: accepting,
              type: "button",
            }, "\u270E Review & Edit"),
            h("button", {
              class: "smart-add-btn smart-add-btn-accept",
              onClick: handleAccept,
              disabled: accepting,
              type: "button",
            }, accepting
              ? "Accepting..."
              : `Accept All (${proposals.length + featureCount + taskCount} items)`,
            ),
          ),
        )
      : null,
  );
}

// ── Confidence Bar ──────────────────────────────────────────────────

interface ConfidenceBarProps {
  confidence: number;
}

function ConfidenceBar({ confidence }: ConfidenceBarProps) {
  const level =
    confidence >= 80 ? "high" :
    confidence >= 50 ? "medium" :
    "low";

  const label =
    level === "high" ? "High confidence" :
    level === "medium" ? "Moderate confidence" :
    "Low confidence";

  return h(
    "div",
    { class: "smart-add-confidence" },
    h("div", { class: "smart-add-confidence-header" },
      h("span", { class: "smart-add-confidence-label" }, label),
      h("span", { class: `smart-add-confidence-value smart-add-confidence-${level}` },
        `${confidence}%`,
      ),
    ),
    h("div", { class: "smart-add-confidence-track" },
      h("div", {
        class: `smart-add-confidence-fill smart-add-confidence-${level}`,
        style: { width: `${confidence}%` },
        role: "progressbar",
        "aria-valuenow": confidence,
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-label": `Confidence: ${confidence}%`,
      }),
    ),
  );
}

// ── Proposal Preview Card ───────────────────────────────────────────

interface ProposalPreviewCardProps {
  proposal: RawProposal;
  index: number;
}

function ProposalPreviewCard({ proposal, index }: ProposalPreviewCardProps) {
  const [expanded, setExpanded] = useState(true);

  const taskCount = proposal.features.reduce((sum, f) => sum + f.tasks.length, 0);

  return h(
    "div",
    { class: "smart-add-preview-card" },

    // Epic header
    h("div", {
      class: "smart-add-preview-epic",
      onClick: () => setExpanded(!expanded),
      role: "button",
      tabIndex: 0,
      "aria-expanded": expanded,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setExpanded(!expanded);
        }
      },
    },
      h("span", {
        class: `smart-add-preview-expand${expanded ? " open" : ""}`,
        "aria-hidden": "true",
      }, "\u25B6"),
      h("span", { class: "prd-level-badge prd-level-epic" }, "Epic"),
      h("span", { class: "smart-add-preview-title" }, proposal.epic.title),
      h("span", { class: "smart-add-preview-count" },
        `${proposal.features.length}F / ${taskCount}T`,
      ),
    ),

    // Expanded content
    expanded
      ? h("div", { class: "smart-add-preview-body" },
          proposal.epic.description
            ? h("p", { class: "smart-add-preview-desc" }, proposal.epic.description)
            : null,

          proposal.features.map((feature, fi) =>
            h("div", { key: fi, class: "smart-add-preview-feature" },
              h("div", { class: "smart-add-preview-feature-header" },
                h("span", { class: "prd-level-badge prd-level-feature" }, "Feature"),
                h("span", { class: "smart-add-preview-feature-title" }, feature.title),
                feature.description
                  ? h("span", { class: "smart-add-preview-feature-desc" },
                      ` \u2014 ${feature.description}`,
                    )
                  : null,
              ),
              feature.tasks.length > 0
                ? h("div", { class: "smart-add-preview-tasks" },
                    feature.tasks.map((task, ti) =>
                      h("div", { key: ti, class: "smart-add-preview-task" },
                        h("span", { class: "prd-level-badge prd-level-task" }, "Task"),
                        h("span", { class: "smart-add-preview-task-title" }, task.title),
                        task.priority
                          ? h("span", {
                              class: `prd-priority-badge prd-priority-${task.priority}`,
                            }, task.priority)
                          : null,
                        task.acceptanceCriteria && task.acceptanceCriteria.length > 0
                          ? h("span", { class: "smart-add-preview-ac-badge" },
                              `${task.acceptanceCriteria.length} AC`,
                            )
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
