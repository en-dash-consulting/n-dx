/**
 * Batch import panel — upload or paste multiple ideas for consolidated
 * smart-add processing.
 *
 * Supports:
 * - File uploads (drag & drop or file picker): text, markdown, JSON
 * - Manual text entries with per-entry format selection
 * - Expandable file preview with metadata (lines, words, size)
 * - Stage-based progress indicator during processing
 * - Consolidated proposal preview with confidence scoring
 * - Hands off to ProposalEditor for review before acceptance
 */

import { h, Fragment } from "preact";
import { useState, useCallback, useRef } from "preact/hooks";
import { ProposalEditor } from "./proposal-editor.js";
import type { RawProposal } from "./proposal-editor.js";

// ── Types ────────────────────────────────────────────────────────────

export interface BatchImportPanelProps {
  /** Called when proposals are accepted and PRD should be refreshed. */
  onPrdChanged: () => void;
}

/** An individual item queued for batch processing. */
export interface BatchItem {
  id: string;
  content: string;
  format: "text" | "markdown" | "json";
  source: string;
}

type BatchState = "idle" | "processing" | "done" | "error";

/** Stages of the processing pipeline, shown in the progress indicator. */
type ProcessingStage = "uploading" | "analyzing" | "generating";

const STAGE_LABELS: Record<ProcessingStage, string> = {
  uploading: "Sending files to server...",
  analyzing: "Analyzing content...",
  generating: "Generating proposals...",
};

const STAGE_PROGRESS: Record<ProcessingStage, number> = {
  uploading: 25,
  analyzing: 60,
  generating: 90,
};

// ── Helpers ──────────────────────────────────────────────────────────

/** Infer format from file extension. */
function inferFormat(fileName: string): "text" | "markdown" | "json" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return "text";
}

/** Format byte size to human-readable string. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Count lines in a string. */
function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

/** Count words in a string. */
function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

let nextId = 0;
function genId(): string {
  return `batch-${++nextId}`;
}

// ── Component ────────────────────────────────────────────────────────

export function BatchImportPanel({ onPrdChanged }: BatchImportPanelProps) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [state, setState] = useState<BatchState>("idle");
  const [proposals, setProposals] = useState<RawProposal[]>([]);
  const [confidence, setConfidence] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>("uploading");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File handling ────────────────────────────────────────────────

  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const readers = fileArray.map((file) => {
      return new Promise<BatchItem>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            id: genId(),
            content: reader.result as string,
            format: inferFormat(file.name),
            source: file.name,
          });
        };
        reader.onerror = () => {
          resolve({
            id: genId(),
            content: "",
            format: "text",
            source: `${file.name} (read error)`,
          });
        };
        reader.readAsText(file);
      });
    });

    Promise.all(readers).then((newItems) => {
      setItems((prev) => [...prev, ...newItems.filter((i) => i.content.trim().length > 0)]);
    });
  }, []);

  const handleFileInput = useCallback((e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      addFiles(input.files);
      input.value = ""; // Reset so same file can be added again
    }
  }, [addFiles]);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  // ── Manual text entry ────────────────────────────────────────────

  const addTextEntry = useCallback(() => {
    setItems((prev) => [...prev, {
      id: genId(),
      content: "",
      format: "text" as const,
      source: "Text entry",
    }]);
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<BatchItem>) => {
    setItems((prev) => prev.map((item) =>
      item.id === id ? { ...item, ...updates } : item,
    ));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // ── Processing ───────────────────────────────────────────────────

  const processItems = useCallback(async () => {
    const validItems = items.filter((i) => i.content.trim().length > 0);
    if (validItems.length === 0) return;

    setState("processing");
    setProcessingStage("uploading");
    setError(null);

    try {
      setProcessingStage("uploading");
      const res = await fetch("/api/rex/batch-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: validItems.map((i) => ({
            content: i.content,
            format: i.format,
            source: i.source,
          })),
        }),
      });

      setProcessingStage("analyzing");

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Import failed" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      setProcessingStage("generating");
      const data = await res.json();
      setProposals(data.proposals ?? []);
      setConfidence(data.confidence ?? 0);
      setState(data.proposals?.length > 0 ? "done" : "done");
    } catch (err) {
      setError(String(err));
      setState("error");
    }
  }, [items]);

  // ── Accept proposals ─────────────────────────────────────────────

  const handleAccept = useCallback(async () => {
    if (proposals.length === 0) return;

    setAccepting(true);
    try {
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

      // Reset
      setItems([]);
      setProposals([]);
      setConfidence(0);
      setState("idle");
      onPrdChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setAccepting(false);
    }
  }, [proposals, onPrdChanged]);

  // ── Editor callbacks ─────────────────────────────────────────────

  const handleEditorAccepted = useCallback(() => {
    setEditing(false);
    setItems([]);
    setProposals([]);
    setConfidence(0);
    setState("idle");
    onPrdChanged();
  }, [onPrdChanged]);

  // ── Render: Proposal editor mode ─────────────────────────────────

  if (editing && proposals.length > 0) {
    return h(
      "div",
      { class: "batch-import-panel" },
      h(ProposalEditor, {
        proposals,
        onAccepted: handleEditorAccepted,
        onCancel: () => setEditing(false),
      }),
    );
  }

  // ── Render: Results ──────────────────────────────────────────────

  if (state === "done" && proposals.length > 0) {
    const taskCount = proposals.reduce(
      (sum, p) => sum + p.features.reduce((fs, f) => fs + f.tasks.length, 0),
      0,
    );
    const featureCount = proposals.reduce((sum, p) => sum + p.features.length, 0);

    return h(
      "div",
      { class: "batch-import-panel" },

      // Header
      h("div", { class: "batch-import-header" },
        h("h3", { class: "batch-import-title" }, "Batch Import Results"),
        h("p", { class: "batch-import-subtitle" },
          `Processed ${items.length} item${items.length !== 1 ? "s" : ""}. Review the proposals below.`,
        ),
      ),

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

      // Confidence indicator
      confidence > 0
        ? h("div", { class: "smart-add-confidence" },
            h("div", { class: "smart-add-confidence-header" },
              h("span", { class: "smart-add-confidence-label" },
                confidence >= 80 ? "High confidence" :
                confidence >= 50 ? "Moderate confidence" :
                "Low confidence",
              ),
              h("span", {
                class: `smart-add-confidence-value smart-add-confidence-${confidence >= 80 ? "high" : confidence >= 50 ? "medium" : "low"}`,
              }, `${confidence}%`),
            ),
            h("div", { class: "smart-add-confidence-track" },
              h("div", {
                class: `smart-add-confidence-fill smart-add-confidence-${confidence >= 80 ? "high" : confidence >= 50 ? "medium" : "low"}`,
                style: { width: `${confidence}%` },
                role: "progressbar",
                "aria-valuenow": confidence,
                "aria-valuemin": 0,
                "aria-valuemax": 100,
              }),
            ),
          )
        : null,

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
        h("button", {
          class: "smart-add-btn smart-add-btn-review",
          onClick: () => {
            setProposals([]);
            setConfidence(0);
            setState("idle");
          },
          disabled: accepting,
          type: "button",
        }, "Back to Import"),
      ),
    );
  }

  // ── Render: Input + queue ────────────────────────────────────────

  const validCount = items.filter((i) => i.content.trim().length > 0).length;

  return h(
    "div",
    { class: "batch-import-panel" },

    // Header
    h("div", { class: "batch-import-header" },
      h("h3", { class: "batch-import-title" }, "Batch Import"),
      h("p", { class: "batch-import-subtitle" },
        "Upload files or paste ideas. All items are processed together and deduplicated.",
      ),
    ),

    // Drop zone
    h("div", {
      class: `batch-import-dropzone${dragOver ? " batch-import-dropzone-active" : ""}`,
      onDrop: handleDrop,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
    },
      h("div", { class: "batch-import-dropzone-content" },
        h("span", { class: "batch-import-dropzone-icon" }, "\uD83D\uDCC1"),
        h("p", { class: "batch-import-dropzone-text" },
          "Drop files here or ",
          h("button", {
            class: "batch-import-browse-btn",
            onClick: () => fileInputRef.current?.click(),
            type: "button",
          }, "browse"),
        ),
        h("p", { class: "batch-import-dropzone-hint" },
          "Supports .txt, .md, .json files",
        ),
      ),
      h("input", {
        ref: fileInputRef,
        type: "file",
        multiple: true,
        accept: ".txt,.md,.markdown,.json",
        style: { display: "none" },
        onChange: handleFileInput,
      }),
    ),

    // Add text entry button
    h("button", {
      class: "batch-import-add-text-btn",
      onClick: addTextEntry,
      type: "button",
    }, "+ Add text entry"),

    // Queued items
    items.length > 0
      ? h("div", { class: "batch-import-queue" },
          h("div", { class: "batch-import-queue-header" },
            h("span", { class: "batch-import-queue-title" },
              `${items.length} item${items.length !== 1 ? "s" : ""} queued`,
            ),
            h("button", {
              class: "batch-import-clear-btn",
              onClick: () => setItems([]),
              type: "button",
            }, "Clear all"),
          ),
          items.map((item) =>
            h(BatchItemRow, {
              key: item.id,
              item,
              onUpdate: updateItem,
              onRemove: removeItem,
            }),
          ),
        )
      : null,

    // Error display
    error
      ? h("div", { class: "smart-add-error", role: "alert" },
          h("span", { class: "smart-add-error-icon" }, "\u26A0"),
          h("span", null, error),
        )
      : null,

    // Processing state — stage-based progress
    state === "processing"
      ? h("div", { class: "batch-import-progress", role: "status", "aria-live": "polite" },
          h("div", { class: "batch-import-progress-bar" },
            h("div", {
              class: "batch-import-progress-fill",
              style: { width: `${STAGE_PROGRESS[processingStage]}%` },
              role: "progressbar",
              "aria-valuenow": STAGE_PROGRESS[processingStage],
              "aria-valuemin": 0,
              "aria-valuemax": 100,
            }),
          ),
          h("div", { class: "batch-import-progress-info" },
            h("span", { class: "batch-import-progress-text" },
              STAGE_LABELS[processingStage],
            ),
            h("span", { class: "batch-import-progress-detail" },
              `${validCount} file${validCount !== 1 ? "s" : ""}`,
            ),
          ),
          h("div", { class: "batch-import-progress-stages" },
            (["uploading", "analyzing", "generating"] as ProcessingStage[]).map((stage) => {
              const isCurrent = stage === processingStage;
              const isDone = STAGE_PROGRESS[stage] < STAGE_PROGRESS[processingStage];
              return h("span", {
                key: stage,
                class: `batch-import-stage${isCurrent ? " batch-import-stage-active" : ""}${isDone ? " batch-import-stage-done" : ""}`,
              },
                isDone ? "\u2713 " : isCurrent ? "\u25CF " : "\u25CB ",
                stage === "uploading" ? "Upload" :
                stage === "analyzing" ? "Analyze" : "Generate",
              );
            }),
          ),
        )
      : null,

    // Empty result
    state === "done" && proposals.length === 0
      ? h("div", { class: "smart-add-empty" },
          h("p", null, "No proposals generated from the imported items."),
          h("p", { class: "smart-add-empty-hint" },
            "Try adding more detailed content or different formats.",
          ),
        )
      : null,

    // Process button
    validCount > 0 && state !== "processing"
      ? h("div", { class: "batch-import-process" },
          h("button", {
            class: "smart-add-btn smart-add-btn-accept batch-import-process-btn",
            onClick: processItems,
            type: "button",
          }, `Process ${validCount} Item${validCount !== 1 ? "s" : ""}`),
        )
      : null,
  );
}

// ── Batch Item Row ──────────────────────────────────────────────────

export interface BatchItemRowProps {
  item: BatchItem;
  onUpdate: (id: string, updates: Partial<BatchItem>) => void;
  onRemove: (id: string) => void;
}

export function BatchItemRow({ item, onUpdate, onRemove }: BatchItemRowProps) {
  const isTextEntry = item.source === "Text entry";
  const [expanded, setExpanded] = useState(false);

  const lines = countLines(item.content);
  const words = countWords(item.content);
  const size = new Blob([item.content]).size;

  return h(
    "div",
    { class: "batch-import-item" },

    // Item header
    h("div", { class: "batch-import-item-header" },
      h("span", { class: `batch-import-format-badge batch-import-format-${item.format}` },
        item.format.toUpperCase(),
      ),
      h("span", { class: "batch-import-item-source" }, item.source),
      !isTextEntry
        ? h("span", { class: "batch-import-item-meta" },
            h("span", { class: "batch-import-item-size" }, formatSize(size)),
            h("span", { class: "batch-import-item-meta-sep" }, "\u00B7"),
            h("span", null, `${lines} line${lines !== 1 ? "s" : ""}`),
            h("span", { class: "batch-import-item-meta-sep" }, "\u00B7"),
            h("span", null, `${words} word${words !== 1 ? "s" : ""}`),
          )
        : null,
      h("select", {
        class: "batch-import-format-select",
        value: item.format,
        onChange: (e: Event) => onUpdate(item.id, {
          format: (e.target as HTMLSelectElement).value as BatchItem["format"],
        }),
        "aria-label": "Content format",
      },
        h("option", { value: "text" }, "Text"),
        h("option", { value: "markdown" }, "Markdown"),
        h("option", { value: "json" }, "JSON"),
      ),
      // Expand/collapse toggle for file content
      !isTextEntry
        ? h("button", {
            class: `batch-import-expand-btn${expanded ? " batch-import-expand-btn-active" : ""}`,
            onClick: () => setExpanded((p) => !p),
            type: "button",
            title: expanded ? "Collapse preview" : "Expand preview",
            "aria-label": expanded ? "Collapse preview" : "Expand preview",
            "aria-expanded": expanded ? "true" : "false",
          }, expanded ? "\u25B2" : "\u25BC")
        : null,
      h("button", {
        class: "batch-import-remove-btn",
        onClick: () => onRemove(item.id),
        type: "button",
        title: "Remove item",
        "aria-label": "Remove item",
      }, "\u2715"),
    ),

    // Editable content for text entries
    isTextEntry
      ? h("textarea", {
          class: "batch-import-item-textarea",
          value: item.content,
          placeholder: "Paste or type your idea...",
          onInput: (e: Event) => onUpdate(item.id, {
            content: (e.target as HTMLTextAreaElement).value,
          }),
          rows: 3,
        })
      : // Preview for file content — collapsed or expanded
        h("div", {
          class: `batch-import-item-preview${expanded ? " batch-import-item-preview-expanded" : ""}`,
        },
          expanded
            ? item.content
            : h(Fragment, null,
                item.content.slice(0, 300),
                item.content.length > 300 ? "\u2026" : "",
              ),
        ),
  );
}
