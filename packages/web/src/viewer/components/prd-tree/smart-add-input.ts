/**
 * Smart add input — natural language input with debounced proposal generation.
 *
 * Provides a text input field that sends debounced requests to the
 * smart-add-preview API endpoint. Displays loading states, structured
 * proposal previews with hierarchy, and confidence indicators.
 * Includes context selection (scope proposals under an epic/feature),
 * real-time character count, and example prompts for better input.
 * Proposals can be sent to the ProposalEditor for review or accepted directly.
 *
 * The `bar` layout is a single input row (no header, scope or examples) for
 * a stage page's lead section, where the full form crowded out the PRD.
 * Switching `bar` on an already-mounted instance keeps what has been typed.
 *
 * On a v2 PRD (`layout: "v2"`) there is no LLM breakdown: `rex add` makes one
 * change per text, titled from its first line, with the full text as its
 * description, in the Inbox. The panel says so instead of promising
 * proposals — see {@link V2_COPY}.
 */

import { h, Fragment } from "preact";
import type { ComponentChildren } from "preact";
import { useState, useCallback, useRef, useEffect, useMemo } from "preact/hooks";
import { ProposalEditor } from "./proposal-editor.js";
import type { RawProposal } from "./proposal-editor.js";
import { isContainerType, isRootType, itemTypeLabel, itemTypeOf } from "../../external.js";

// ── Types ────────────────────────────────────────────────────────────

export interface SmartAddInputProps {
  /** Called when proposals are accepted and PRD should be refreshed. */
  onPrdChanged: () => void;
  /** One input row: hides the header, scope selector and example prompts. */
  bar?: boolean;
  /** Rendered after Generate in the `bar` row (e.g. a "More" toggle). */
  barAction?: ComponentChildren;
  /** The served PRD's layout; v2 captures a change into the Inbox. Defaults to v1. */
  layout?: "v1" | "v2";
}

interface QualityIssue {
  level: string;
  path: string;
  message: string;
}

/** One ranked capability or constraint the change could be placed on. */
interface PlacementCandidate {
  /** Id of the target; `title` names it when the server could resolve it. */
  target: string;
  relation: string;
  title?: string;
  displayId?: string;
}

/**
 * A change `rex add` would create on a v2 PRD, as the preview forwards it.
 *
 * A v2 tree has no levels, so there is nothing to render as an epic/feature/task
 * proposal: every add is one change, landing in the Inbox until it is placed.
 */
export interface PreviewChange {
  id: string;
  type: string;
  title: string;
  /** The full text, when the title had to be cut from it. */
  description?: string;
  needsPlacement?: boolean;
  placement?: { relation: string; shortlist: PlacementCandidate[] };
}

type PreviewState = "idle" | "loading" | "done" | "error";

/** Flattened scope option for the context dropdown. */
interface ScopeOption {
  id: string;
  title: string;
  itemType: string;
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

/** The panel's words. v1 generates proposals with an LLM; v2 captures a change. */
interface PanelCopy {
  title: string;
  subtitle: string;
  barPlaceholder: string;
  placeholder: string;
  inputLabel: string;
  wholeProject: string;
  scopeLabel: string;
  moreToGo: string;
  action: string;
  actionLabel: string;
  busy: string;
  loadingText: string;
}

const V1_COPY: PanelCopy = {
  title: "Smart Add",
  subtitle: "Describe what you want to build, then click Generate.",
  barPlaceholder: "Describe what to add to the plan…",
  placeholder: "Describe a feature, improvement, or idea...",
  inputLabel: "Smart add description",
  wholeProject: "Entire project (new epics)",
  scopeLabel: "Scope proposals under an existing epic or feature",
  moreToGo: "more to generate proposals",
  action: "Generate",
  actionLabel: "Generate proposals",
  busy: "Generating...",
  loadingText: "Analyzing description and generating proposals...",
};

/** What comes after a v2 capture: the change waits in the Inbox until placed. */
const V2_NEXT_STEP =
  "Next: place it on the capability it changes, then add its tasks from its detail panel.";

const V2_COPY: PanelCopy = {
  title: "Add to Inbox",
  subtitle: "Your text becomes one change in the Inbox: the first line is its title and the full text its description.",
  barPlaceholder: "Describe a change for the Inbox…",
  placeholder: "Describe a change: the first line becomes its title...",
  inputLabel: "Change description",
  wholeProject: "Inbox (new change)",
  scopeLabel: "Add under an existing change",
  moreToGo: "more to preview",
  action: "Preview",
  actionLabel: "Preview the change",
  busy: "Previewing...",
  loadingText: "Preparing the change...",
};

// ── Component ────────────────────────────────────────────────────────

export function SmartAddInput({ onPrdChanged, bar, barAction, layout }: SmartAddInputProps) {
  const copy = layout === "v2" ? V2_COPY : V1_COPY;
  const [input, setInput] = useState("");
  const [state, setState] = useState<PreviewState>("idle");
  const [proposals, setProposals] = useState<RawProposal[]>([]);
  const [changes, setChanges] = useState<PreviewChange[]>([]);
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

  // What the last preview was generated from. A v2 accept re-runs the same
  // request with --accept, so it must replay what was previewed rather than
  // whatever the input and scope hold by the time Add is clicked.
  const previewedRef = useRef<{ text: string; parentId?: string } | null>(null);

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
        function walk(items: Array<{ id: string; title: string; type?: string; level?: string; children?: unknown[] }>, depth: number) {
          for (const item of items) {
            const itemType = itemTypeOf(item);
            if (isContainerType(itemType)) {
              options.push({ id: item.id, title: item.title, itemType, depth });
              if (isRootType(itemType) && Array.isArray(item.children)) {
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
      // A v2 PRD previews changes instead of proposals.
      setChanges(data.preview ? (data.changes ?? []) : []);
      setConfidence(data.confidence ?? 0);
      setQualityIssues(data.qualityIssues ?? []);
      setState("done");
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
    // The bar layout hides the scope selector, so a scope picked before
    // switching to it must not silently apply.
    const parentId = (!bar && selectedScope) || undefined;
    previewedRef.current = { text, ...(parentId ? { parentId } : {}) };
    triggerPreview(text, reqId, parentId);
  }, [input, triggerPreview, selectedScope, bar]);

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
      // Build the payload in the edited-proposals format (all selected).
      // Forward `existingId` from smart-placement so the server nests the new
      // work under the matched epic/feature instead of duplicating it.
      const payload = proposals.map((p) => ({
        epic: {
          title: p.epic.title,
          description: p.epic.description,
          ...(p.epic.existingId ? { existingId: p.epic.existingId } : {}),
        },
        features: p.features.map((f) => ({
          title: f.title,
          description: f.description,
          ...(f.existingId ? { existingId: f.existingId } : {}),
          tasks: f.tasks.map((t) => ({
            title: t.title,
            description: t.description,
            ...(t.acceptanceCriteria && t.acceptanceCriteria.length > 0
              ? { acceptanceCriteria: t.acceptanceCriteria }
              : {}),
            priority: t.priority,
            tags: t.tags,
            loe: t.loe,
            loeRationale: t.loeRationale,
            loeConfidence: t.loeConfidence,
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

  // ── Accept changes (v2 PRD) ──────────────────────────────────────

  const handleAcceptChanges = useCallback(async () => {
    const previewed = previewedRef.current;
    if (changes.length === 0 || !previewed) return;

    setAccepting(true);
    try {
      const res = await fetch("/api/rex/smart-add-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(previewed),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Accept failed" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      setInput("");
      setChanges([]);
      setState("idle");
      previewedRef.current = null;
      refreshScopes();
      onPrdChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setAccepting(false);
    }
  }, [changes, onPrdChanged, refreshScopes]);

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
    return opt ? `${opt.itemType}: ${opt.title}` : null;
  }, [selectedScope, scopeOptions]);

  const panelClass = bar ? "smart-add-panel smart-add-panel-bar" : "smart-add-panel";

  return h(
    "div",
    { class: panelClass },

    // Header
    bar
      ? null
      : h("div", { class: "smart-add-header" },
          h("h3", { class: "smart-add-title" }, copy.title),
          h("p", { class: "smart-add-subtitle" }, copy.subtitle),
        ),

    // Context selection dropdown
    !bar && scopeOptions.length > 0
      ? h("div", { class: "smart-add-scope" },
          h("label", { class: "smart-add-scope-label" }, "Scope"),
          h("select", {
            class: "smart-add-scope-select",
            value: selectedScope,
            onChange: (e: Event) => {
              setSelectedScope((e.target as HTMLSelectElement).value);
            },
            "aria-label": copy.scopeLabel,
          },
            h("option", { value: "" }, copy.wholeProject),
            scopeOptions.map((opt) =>
              h("option", { key: opt.id, value: opt.id },
                `${"  ".repeat(opt.depth)}${itemTypeLabel(opt.itemType)}: ${opt.title}`,
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
    !bar && state === "idle" && trimmedLength === 0
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
        placeholder: bar ? copy.barPlaceholder : copy.placeholder,
        onInput: (e: Event) => handleInput((e.target as HTMLTextAreaElement).value),
        rows: bar ? 1 : 4,
        "aria-label": copy.inputLabel,
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
              `${MIN_INPUT_LENGTH - trimmedLength} ${copy.moreToGo}`,
            )
          : null,
        // Loading badge
        state === "loading"
          ? h("span", { class: "smart-add-loading-badge" },
              h("span", { class: "smart-add-spinner", "aria-hidden": "true" }),
              ` ${copy.busy}`,
            )
          : null,
      ),
      // Generate button — sole trigger for proposal generation
      h("button", {
        class: "cmd-btn cmd-btn-primary smart-add-btn-generate",
        type: "button",
        disabled: trimmedLength < MIN_INPUT_LENGTH || state === "loading",
        onClick: handleSubmit,
        "aria-label": copy.actionLabel,
      }, state === "loading" ? copy.busy : copy.action),
      bar ? barAction : null,
    ),

    // Loading state with progress
    state === "loading"
      ? h("div", { class: "smart-add-loading", role: "status", "aria-live": "polite" },
          h("div", { class: "smart-add-loading-bar" },
            h("div", { class: "smart-add-loading-bar-fill" }),
          ),
          h("span", { class: "smart-add-loading-text" },
            copy.loadingText,
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

    // Results: v2 change preview — one change per description, each with the
    // placement the rules suggest. Accepting creates them in the Inbox.
    state === "done" && changes.length > 0
      ? h(Fragment, null,
          h("div", { class: "smart-add-stats" },
            h("span", { class: "smart-add-stat" },
              h("span", { class: "smart-add-stat-count" }, String(changes.length)),
              ` change${changes.length !== 1 ? "s" : ""}`,
            ),
          ),

          h("div", { class: "smart-add-preview" },
            changes.map((change, ci) =>
              h(ChangePreviewCard, { key: change.id ?? ci, change }),
            ),
          ),

          h("p", { class: "smart-add-preview-desc smart-add-next-step" }, V2_NEXT_STEP),

          h("div", { class: "smart-add-actions" },
            h("button", {
              class: "cmd-btn cmd-btn-primary smart-add-btn-accept",
              onClick: handleAcceptChanges,
              disabled: accepting,
              type: "button",
            }, accepting
              ? "Adding..."
              : `Add ${changes.length} change${changes.length !== 1 ? "s" : ""}`,
            ),
          ),
        )
      : null,

    // Results: proposal preview
    state === "done" && proposals.length === 0 && changes.length === 0
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
              class: "cmd-btn cmd-btn-secondary smart-add-btn-review",
              onClick: () => setEditing(true),
              disabled: accepting,
              type: "button",
            }, "\u270E Review & Edit"),
            h("button", {
              class: "cmd-btn cmd-btn-primary smart-add-btn-accept",
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

// ── Change Preview Card (v2 PRD) ────────────────────────────────────

interface ChangePreviewCardProps {
  change: PreviewChange;
}

function ChangePreviewCard({ change }: ChangePreviewCardProps) {
  const shortlist = change.placement?.shortlist ?? [];

  return h(
    "div",
    { class: "smart-add-preview-card" },

    h("div", { class: "smart-add-preview-epic" },
      h("span", { class: "prd-level-badge prd-level-epic" }, "Change"),
      h("span", { class: "smart-add-preview-title smart-add-preview-title--wrap" }, change.title),
      change.needsPlacement
        ? h("span", { class: "smart-add-preview-count" }, "Inbox")
        : null,
    ),

    h("div", { class: "smart-add-preview-body" },
      change.description
        ? h("p", { class: "smart-add-preview-desc smart-add-preview-full-text" }, change.description)
        : null,
      shortlist.length > 0
        ? h(Fragment, null,
            h("p", { class: "smart-add-preview-desc" }, "Suggested placement"),
            h("div", { class: "smart-add-preview-tasks" },
              shortlist.map((candidate, ci) =>
                h("div", { key: ci, class: "smart-add-preview-task" },
                  h("span", { class: "smart-add-preview-ac-badge" }, candidate.relation),
                  h("span", { class: "smart-add-preview-task-title smart-add-preview-task-title--wrap" },
                    [candidate.displayId, candidate.title ?? candidate.target]
                      .filter(Boolean).join(" "),
                  ),
                ),
              ),
            ),
          )
        : h("p", { class: "smart-add-preview-desc" },
            "No placement suggested — it waits in the Inbox until one is recorded.",
          ),
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
