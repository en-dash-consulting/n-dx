/**
 * Hench Runs view — execution history showing past agent runs.
 *
 * Displays a list of runs with task name, status, duration, turns,
 * and token usage. Clicking a run shows the full summary/detail.
 * Each run links back to its Rex task.
 *
 * Data comes from GET /api/hench/runs (list) and
 * GET /api/hench/runs/:id (detail).
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useMemo, useRef } from "preact/hooks";
import { MetricCard } from "../visualization/index.js";
import {
  BrandedHeader,
  RexTaskLink,
  CopyLinkButton,
  ActiveTasksPanel,
  ConcurrencyPanel,
  MemoryPanel,
  WsHealthPanel,
  ThrottleControlsPanel,
} from "../components/index.js";
import { CollapsibleSection } from "../components/data-display/collapsible-section.js";
import type { ActiveRun } from "../components/index.js";
import { usePolling } from "../hooks/index.js";
import type { NavigateTo } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────

interface RunSummary {
  id: string;
  taskId: string;
  taskTitle: string;
  taskStatus?: string;
  startedAt: string;
  finishedAt?: string;
  lastActivityAt?: string;
  status: string;
  turns: number;
  summary?: string;
  error?: string;
  model: string;
  tokenUsage: {
    input: number;
    output: number;
    cacheCreationInput?: number;
    cacheReadInput?: number;
  };
  structuredSummary?: {
    counts?: {
      filesRead: number;
      filesChanged: number;
      commandsExecuted: number;
      testsRun: number;
      toolCallsTotal: number;
    };
  };
  /** Vendor active for this run (e.g. "claude", "codex"). */
  vendor?: string;
  /** Token diagnostic status: complete, partial, or unavailable. */
  tokenDiagnosticStatus?: "complete" | "partial" | "unavailable";
  /** Invocation context: "cli" for CLI, "api" for HTTP/MCP. */
  invocationContext?: "cli" | "api";
}

interface RunDiagnosticsData {
  tokenDiagnosticStatus: "complete" | "partial" | "unavailable";
  parseMode: string;
  notes: string[];
  promptSections?: Array<{ name: string; byteLength: number }>;
  vendor?: string;
  sandbox?: string;
  approvals?: string;
}

interface RunDetail extends RunSummary {
  toolCalls?: Array<{ tool: string; input?: unknown; output?: unknown }>;
  turnTokenUsage?: Array<{
    turn: number;
    input: number;
    output: number;
    cacheCreationInput?: number;
    cacheReadInput?: number;
  }>;
  diagnostics?: RunDiagnosticsData;
  /** Invocation context: "cli" for CLI, "api" for HTTP/MCP. */
  invocationContext?: "cli" | "api";
  /** Files changed with git status codes (A/M/D/R/C/T). Format: "STATUS\tPATH". */
  fileChangesWithStatus?: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(start: string, end?: string): string {
  if (!end) return "running…";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "—";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  // If within last 24 hours, show relative time
  if (diffHours < 1) {
    const mins = Math.floor(diffMs / (1000 * 60));
    return mins <= 0 ? "just now" : `${mins}m ago`;
  }
  if (diffHours < 24) {
    return `${Math.floor(diffHours)}h ago`;
  }
  // If within last 7 days, show day + time
  if (diffHours < 168) {
    return d.toLocaleDateString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  // Otherwise full date
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const STATUS_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  completed: { icon: "●", label: "Completed", color: "var(--green)" },
  failed: { icon: "✕", label: "Failed", color: "var(--red)" },
  running: { icon: "◐", label: "Running", color: "var(--accent)" },
  in_progress: { icon: "◐", label: "Running", color: "var(--accent)" },
  error: { icon: "✕", label: "Error", color: "var(--red)" },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { icon: "○", label: status, color: "var(--text-dim)" };
}

const TOKEN_DIAG_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  complete: { icon: "●", label: "Complete", color: "var(--green)" },
  partial: { icon: "◐", label: "Partial", color: "var(--orange)" },
  unavailable: { icon: "○", label: "Unavailable", color: "var(--text-dim)" },
};

function getTokenDiagConfig(status?: string) {
  if (!status) return null;
  return TOKEN_DIAG_CONFIG[status] ?? null;
}

function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} KB`;
  return `${n} B`;
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

function isStaleRun(run: RunSummary): boolean {
  if (run.status !== "running") return false;
  if (!run.lastActivityAt) return true; // Legacy run without timestamp
  return Date.now() - new Date(run.lastActivityAt).getTime() > STALE_THRESHOLD_MS;
}

// ── File change classification ───────────────────────────────────────

type FileCategory = "code" | "docs" | "config" | "metadata" | "test" | "other";

interface FileChangeEntry {
  status: string;
  path: string;
  category: FileCategory;
}

function classifyFilePath(filePath: string): FileCategory {
  // Metadata (PRD-related)
  if (filePath.includes(".rex/") || filePath === "prd.json") return "metadata";

  // Tests (path or extension)
  if (filePath.includes(".test.") || filePath.includes(".spec.") ||
      filePath.includes("/__tests__/") || filePath.includes("/tests/")) {
    return "test";
  }

  // Documentation
  if (/\.(md|mdx|txt|rst)$/.test(filePath)) return "docs";

  // Config files
  if (/\.(json|yaml|yml|toml|ini|env)$/.test(filePath) ||
      filePath.endsWith(".config.js") || filePath.endsWith(".config.ts")) {
    return "config";
  }

  // Everything else is code
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|java|rb|php|swift|kt)$/.test(filePath)) {
    return "code";
  }

  return "other";
}

function parseFileChanges(fileChangesWithStatus?: string[]): FileChangeEntry[] {
  if (!fileChangesWithStatus || !Array.isArray(fileChangesWithStatus)) return [];

  return fileChangesWithStatus
    .map((entry) => {
      const [status, ...pathParts] = entry.split("\t");
      const path = pathParts.join("\t");
      return {
        status: status || "?",
        path: path || "(unknown)",
        category: classifyFilePath(path),
      };
    });
}

function getChangeClassification(changes: FileChangeEntry[]): { label: string; color: string } {
  if (changes.length === 0) return { label: "no changes", color: "var(--text-dim)" };

  const categories = new Set(changes.map((c) => c.category));
  const hasCode = categories.has("code");
  const hasDocs = categories.has("docs");
  const hasConfig = categories.has("config");
  const hasMetadata = categories.has("metadata");
  const hasTest = categories.has("test");

  // If only one non-test category, use that
  const nonTestCategories = Array.from(categories).filter((c) => c !== "test");
  if (nonTestCategories.length === 1) {
    const cat = nonTestCategories[0];
    if (cat === "code") return { label: "code", color: "var(--brand-teal)" };
    if (cat === "docs") return { label: "docs", color: "var(--brand-purple)" };
    if (cat === "config") return { label: "config", color: "var(--orange)" };
    if (cat === "metadata") return { label: "metadata", color: "var(--text-dim)" };
  }

  // Multiple categories = mixed
  return { label: "mixed", color: "var(--orange)" };
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    A: "Added",
    M: "Modified",
    D: "Deleted",
    R: "Renamed",
    C: "Copied",
    T: "Type Changed",
  };
  return labels[status] || status;
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    A: "var(--green)",
    M: "var(--orange)",
    D: "var(--red)",
    R: "var(--text-dim)",
    C: "var(--text-dim)",
    T: "var(--orange)",
  };
  return colors[status] || "var(--text-secondary)";
}

// ── Sub-components ───────────────────────────────────────────────────

/** Aggregate metrics shown above the runs list. */
function RunMetrics({ runs }: { runs: RunSummary[] }) {
  const totalRuns = runs.length;
  const completed = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed" || r.status === "error").length;

  const totalTokens = runs.reduce((sum, r) => {
    const t = r.tokenUsage;
    return sum + (t.input ?? 0) + (t.output ?? 0) + (t.cacheCreationInput ?? 0) + (t.cacheReadInput ?? 0);
  }, 0);

  const totalTurns = runs.reduce((sum, r) => sum + (r.turns ?? 0), 0);

  return h("div", { class: "overview-metrics hench-metrics" },
    h(MetricCard, { value: totalRuns, label: "Total Runs" }),
    h(MetricCard, {
      value: completed,
      label: "Succeeded",
      color: "var(--green)",
    }),
    failed > 0
      ? h(MetricCard, {
          value: failed,
          label: "Failed",
          color: "var(--red)",
        })
      : null,
    h(MetricCard, {
      value: totalTurns,
      label: "Total Turns",
      color: "var(--brand-purple)",
    }),
    h(MetricCard, {
      value: fmtTokens(totalTokens),
      label: "Total Tokens",
      color: "var(--brand-teal)",
    }),
  );
}

/** Individual run card in the list. */
function RunCard({ run, isSelected, isHighlighted, onClick, navigateTo, cardRef }: {
  run: RunSummary;
  isSelected: boolean;
  isHighlighted?: boolean;
  onClick: () => void;
  navigateTo?: NavigateTo;
  cardRef?: (el: HTMLDivElement | null) => void;
}) {
  const status = getStatusConfig(run.status);
  const stale = isStaleRun(run);
  const totalTokens = (run.tokenUsage.input ?? 0)
    + (run.tokenUsage.output ?? 0)
    + (run.tokenUsage.cacheCreationInput ?? 0)
    + (run.tokenUsage.cacheReadInput ?? 0);

  const counts = run.structuredSummary?.counts;

  return h("div", {
    ref: cardRef,
    class: `hench-run-card${isSelected ? " selected" : ""}${run.status === "failed" || run.status === "error" ? " failed" : ""}${stale ? " stale" : ""}${isHighlighted ? " hench-run-highlighted" : ""}`,
    onClick,
    role: "button",
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    },
  },
    // Top row: status + task link + timestamp
    h("div", { class: "hench-run-header" },
      h("span", {
        class: "hench-run-status",
        style: `color: ${status.color}`,
        title: status.label,
      }, status.icon),
      navigateTo && run.taskId
        ? h(RexTaskLink, {
            task: {
              id: run.taskId,
              title: run.taskTitle,
              status: run.taskStatus ?? "pending",
            },
            navigateTo,
            compact: true,
            showStatus: false,
            class: "hench-run-task-link",
          })
        : h("span", { class: "hench-run-title" }, run.taskTitle),
      h("span", { class: "hench-run-time" }, fmtTimestamp(run.startedAt)),
    ),

    // Bottom row: metadata chips
    h("div", { class: "hench-run-meta" },
      h("span", { class: "hench-run-chip" }, fmtDuration(run.startedAt, run.finishedAt)),
      h("span", { class: "hench-run-chip" }, `${run.turns} turns`),
      h("span", { class: "hench-run-chip" }, fmtTokens(totalTokens) + " tokens"),
      h("span", { class: `hench-run-model hench-run-model-${run.model}` }, run.model),
      run.vendor
        ? h("span", { class: `hench-run-vendor hench-run-vendor-${run.vendor}` }, run.vendor)
        : null,
      (() => {
        const diag = getTokenDiagConfig(run.tokenDiagnosticStatus);
        return diag
          ? h("span", {
              class: `hench-run-token-diag hench-run-token-diag-${run.tokenDiagnosticStatus}`,
              title: `Token data: ${diag.label}`,
            }, `${diag.icon} ${diag.label}`)
          : null;
      })(),
      counts && counts.filesChanged > 0
        ? h("span", { class: "hench-run-chip" },
            `${counts.filesChanged} file${counts.filesChanged === 1 ? "" : "s"} changed`,
          )
        : null,
      run.lastActivityAt && run.status === "running"
        ? h("span", { class: "hench-run-chip" }, `Active ${fmtTimestamp(run.lastActivityAt)}`)
        : null,
      stale
        ? h("span", { class: "hench-run-chip hench-run-chip-warning" }, "Possibly stuck")
        : null,
    ),
  );
}

/** File changes list with collapsible details. */
function FileChangesList({ fileChangesWithStatus }: { fileChangesWithStatus?: string[] }) {
  const changes = parseFileChanges(fileChangesWithStatus);
  if (changes.length === 0) {
    return h("div", { class: "hench-no-changes-message" }, "No changes");
  }

  const classification = getChangeClassification(changes);

  return h("div", { class: "hench-detail-section" },
    h("div", { class: "hench-file-changes-header" },
      h("h3", null, "Files Changed"),
      h("span", { class: `hench-change-classification hench-change-classification-${classification.label.replace(" ", "-")}`, style: `color: ${classification.color}` },
        `${classification.label}`,
      ),
    ),
    h(CollapsibleSection, {
      title: `${changes.length} file${changes.length === 1 ? "" : "s"}`,
      count: changes.length,
      threshold: 8,
      storageKey: "hench-file-changes-expanded",
      children: changes.map((change) =>
        h("div", { class: "hench-file-change-item", key: change.path },
          h("span", { class: "hench-file-status", style: `color: ${getStatusColor(change.status)}`, title: getStatusLabel(change.status) },
            change.status,
          ),
          h("span", { class: "hench-file-path" }, change.path),
          h("span", { class: "hench-file-action" }, getStatusLabel(change.status)),
        ),
      ),
    }),
  );
}

/** Detail panel for the selected run. */
function RunDetailView({ run, onBack, navigateTo }: { run: RunDetail; onBack: () => void; navigateTo?: NavigateTo }) {
  const status = getStatusConfig(run.status);
  const totalTokens = (run.tokenUsage.input ?? 0)
    + (run.tokenUsage.output ?? 0)
    + (run.tokenUsage.cacheCreationInput ?? 0)
    + (run.tokenUsage.cacheReadInput ?? 0);
  const counts = run.structuredSummary?.counts;

  return h("div", { class: "hench-run-detail" },
    // Back button + header
    h("div", { class: "hench-detail-header" },
      h("div", { class: "hench-detail-header-top" },
        h("button", {
          class: "hench-back-btn",
          onClick: onBack,
          "aria-label": "Back to runs list",
        }, "\u2190 Back"),
        h(CopyLinkButton, { path: `/hench-runs/${run.id}`, compact: true }),
      ),
      h("div", { class: "hench-detail-title-row" },
        h("span", {
          class: "hench-run-status",
          style: `color: ${status.color}; font-size: 18px`,
        }, status.icon),
        h("h2", null, run.taskTitle),
      ),
    ),

    // Rex Task link — bidirectional navigation
    run.taskId
      ? h("div", { class: "hench-detail-section hench-detail-task-section" },
          h("h3", null, "Rex Task"),
          h("div", { class: "hench-detail-task-card" },
            h(RexTaskLink, {
              task: {
                id: run.taskId,
                title: run.taskTitle,
                status: run.taskStatus ?? "pending",
              },
              navigateTo,
              showStatus: true,
              showLevel: false,
            }),
            h("div", { class: "hench-detail-task-id" }, run.taskId),
          ),
        )
      : null,

    // Info grid
    h("div", { class: "hench-detail-info" },
      h("div", { class: "hench-info-row" },
        h("span", { class: "hench-info-label" }, "Status"),
        h("span", { class: "hench-info-value", style: `color: ${status.color}` }, status.label),
      ),
      h("div", { class: "hench-info-row" },
        h("span", { class: "hench-info-label" }, "Started"),
        h("span", { class: "hench-info-value" }, new Date(run.startedAt).toLocaleString()),
      ),
      run.finishedAt
        ? h("div", { class: "hench-info-row" },
            h("span", { class: "hench-info-label" }, "Duration"),
            h("span", { class: "hench-info-value" }, fmtDuration(run.startedAt, run.finishedAt)),
          )
        : null,
      h("div", { class: "hench-info-row" },
        h("span", { class: "hench-info-label" }, "Model"),
        h("span", { class: "hench-info-value" }, run.model),
      ),
      run.invocationContext
        ? h("div", { class: "hench-info-row" },
            h("span", { class: "hench-info-label" }, "Invocation"),
            h("span", {
              class: `hench-info-value hench-info-invocation hench-info-invocation-${run.invocationContext}`,
            }, run.invocationContext === "cli" ? "CLI" : "API"),
          )
        : null,
      h("div", { class: "hench-info-row" },
        h("span", { class: "hench-info-label" }, "Turns"),
        h("span", { class: "hench-info-value" }, String(run.turns)),
      ),
      h("div", { class: "hench-info-row" },
        h("span", { class: "hench-info-label" }, "Tokens"),
        h("span", { class: "hench-info-value" }, fmtTokens(totalTokens)),
      ),
      h("div", { class: "hench-info-row" },
        h("span", { class: "hench-info-label" }, "Run ID"),
        h("span", { class: "hench-info-value hench-info-mono" }, run.id),
      ),
    ),

    // Activity counts
    counts
      ? h("div", { class: "hench-detail-section" },
          h("h3", null, "Activity"),
          h("div", { class: "hench-activity-grid" },
            counts.filesRead > 0
              ? h("div", { class: "hench-activity-item" },
                  h("span", { class: "hench-activity-val" }, String(counts.filesRead)),
                  h("span", { class: "hench-activity-label" }, "Files Read"),
                )
              : null,
            counts.filesChanged > 0
              ? h("div", { class: "hench-activity-item" },
                  h("span", { class: "hench-activity-val" }, String(counts.filesChanged)),
                  h("span", { class: "hench-activity-label" }, "Files Changed"),
                )
              : null,
            counts.commandsExecuted > 0
              ? h("div", { class: "hench-activity-item" },
                  h("span", { class: "hench-activity-val" }, String(counts.commandsExecuted)),
                  h("span", { class: "hench-activity-label" }, "Commands"),
                )
              : null,
            counts.testsRun > 0
              ? h("div", { class: "hench-activity-item" },
                  h("span", { class: "hench-activity-val" }, String(counts.testsRun)),
                  h("span", { class: "hench-activity-label" }, "Tests Run"),
                )
              : null,
            counts.toolCallsTotal > 0
              ? h("div", { class: "hench-activity-item" },
                  h("span", { class: "hench-activity-val" }, String(counts.toolCallsTotal)),
                  h("span", { class: "hench-activity-label" }, "Tool Calls"),
                )
              : null,
          ),
        )
      : null,

    // File changes details
    run.fileChangesWithStatus || (counts && counts.filesChanged === 0)
      ? h(FileChangesList, { fileChangesWithStatus: run.fileChangesWithStatus })
      : null,

    // Token breakdown
    h("div", { class: "hench-detail-section" },
      h("h3", null, "Token Breakdown"),
      h("div", { class: "hench-token-grid" },
        h("div", { class: "hench-token-item" },
          h("span", { class: "hench-token-val" }, fmtTokens(run.tokenUsage.input ?? 0)),
          h("span", { class: "hench-token-label" }, "Input"),
        ),
        h("div", { class: "hench-token-item" },
          h("span", { class: "hench-token-val" }, fmtTokens(run.tokenUsage.output ?? 0)),
          h("span", { class: "hench-token-label" }, "Output"),
        ),
        run.tokenUsage.cacheCreationInput
          ? h("div", { class: "hench-token-item" },
              h("span", { class: "hench-token-val" }, fmtTokens(run.tokenUsage.cacheCreationInput)),
              h("span", { class: "hench-token-label" }, "Cache Write"),
            )
          : null,
        run.tokenUsage.cacheReadInput
          ? h("div", { class: "hench-token-item" },
              h("span", { class: "hench-token-val" }, fmtTokens(run.tokenUsage.cacheReadInput)),
              h("span", { class: "hench-token-label" }, "Cache Read"),
            )
          : null,
      ),
    ),

    // Vendor Diagnostics
    run.diagnostics
      ? h("div", { class: "hench-detail-section" },
          h("h3", null, "Vendor Diagnostics"),
          h("div", { class: "hench-diagnostics-grid" },
            run.diagnostics.vendor
              ? h("div", { class: "hench-diag-item" },
                  h("span", { class: "hench-diag-label" }, "Vendor"),
                  h("span", { class: `hench-diag-value hench-diag-vendor hench-diag-vendor-${run.diagnostics.vendor}` },
                    run.diagnostics.vendor,
                  ),
                )
              : null,
            h("div", { class: "hench-diag-item" },
              h("span", { class: "hench-diag-label" }, "Token Status"),
              (() => {
                const diag = getTokenDiagConfig(run.diagnostics.tokenDiagnosticStatus);
                return diag
                  ? h("span", {
                      class: `hench-diag-value hench-diag-token-status hench-diag-token-status-${run.diagnostics.tokenDiagnosticStatus}`,
                    }, `${diag.icon} ${diag.label}`)
                  : h("span", { class: "hench-diag-value" }, "—");
              })(),
            ),
            h("div", { class: "hench-diag-item" },
              h("span", { class: "hench-diag-label" }, "Parse Mode"),
              h("span", { class: "hench-diag-value hench-diag-mono" }, run.diagnostics.parseMode),
            ),
            run.diagnostics.sandbox
              ? h("div", { class: "hench-diag-item" },
                  h("span", { class: "hench-diag-label" }, "Sandbox"),
                  h("span", { class: "hench-diag-value" }, run.diagnostics.sandbox),
                )
              : null,
            run.diagnostics.approvals
              ? h("div", { class: "hench-diag-item" },
                  h("span", { class: "hench-diag-label" }, "Approvals"),
                  h("span", { class: "hench-diag-value" }, run.diagnostics.approvals),
                )
              : null,
          ),
          // Diagnostic notes
          run.diagnostics.notes && run.diagnostics.notes.length > 0
            ? h("div", { class: "hench-diag-notes" },
                h("span", { class: "hench-diag-notes-label" }, "Notes"),
                h("ul", { class: "hench-diag-notes-list" },
                  run.diagnostics.notes.map((note, i) =>
                    h("li", { key: i }, note),
                  ),
                ),
              )
            : null,
          // Prompt sections
          run.diagnostics.promptSections && run.diagnostics.promptSections.length > 0
            ? h("div", { class: "hench-diag-prompt-sections" },
                h("span", { class: "hench-diag-prompt-label" }, "Prompt Sections"),
                h("div", { class: "hench-diag-prompt-grid" },
                  run.diagnostics.promptSections.map((section, i) =>
                    h("div", { key: i, class: "hench-diag-prompt-item" },
                      h("span", { class: "hench-diag-prompt-name" }, section.name),
                      h("span", { class: "hench-diag-prompt-size" }, fmtBytes(section.byteLength)),
                    ),
                  ),
                ),
              )
            : null,
        )
      : null,

    // Error message
    run.error
      ? h("div", { class: "hench-detail-section" },
          h("h3", null, "Error"),
          h("pre", { class: "hench-error-box" }, run.error),
        )
      : null,

    // Summary (markdown text rendered as plain text for now)
    run.summary
      ? h("div", { class: "hench-detail-section" },
          h("h3", null, "Summary"),
          h("pre", { class: "hench-summary-box" }, run.summary),
        )
      : null,

    // Mark as stuck button — only for running runs
    run.status === "running"
      ? h("div", { class: "hench-detail-section" },
          h("h3", null, "Actions"),
          h("div", { class: "hench-detail-actions" },
            h("button", {
              class: "btn btn-danger",
              onClick: async () => {
                try {
                  const resp = await fetch(`/api/hench/runs/${run.id}/mark-stuck`, { method: "POST" });
                  if (resp.ok) {
                    onBack(); // Return to list, which will re-fetch
                  }
                } catch {
                  // Silently fail — user can retry
                }
              },
            }, "Mark as Stuck"),
            run.lastActivityAt
              ? h("span", { class: "hench-detail-activity" },
                  `Last activity: ${new Date(run.lastActivityAt).toLocaleString()}`,
                )
              : h("span", { class: "hench-detail-activity hench-detail-activity-unknown" },
                  "No activity timestamp (legacy run)",
                ),
          ),
        )
      : null,
  );
}

// ── Main view ────────────────────────────────────────────────────────

export interface HenchRunsViewProps {
  navigateTo?: NavigateTo;
  /** When set, auto-select this run on mount (from deep-link URL). */
  initialRunId?: string | null;
}

export function HenchRunsView({ navigateTo, initialRunId }: HenchRunsViewProps = {}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);
  /** Tracks the run ID that was deep-linked to, for highlight animation. */
  const [highlightedRunId, setHighlightedRunId] = useState<string | null>(null);
  /** Whether the initial deep-link has been consumed. */
  const deepLinkConsumedRef = useRef(false);

  // Fetch the runs list
  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/hench/runs");
      if (!res.ok) {
        setError(`Failed to load runs (${res.status})`);
        return;
      }
      const json = await res.json();
      setRuns(json.runs ?? []);
      setError(null);
    } catch {
      setError("Could not fetch runs. Is the server running?");
    }
  }, []);

  useEffect(() => {
    fetchRuns().then(() => setLoading(false));
  }, [fetchRuns]);

  // Visibility-aware polling via polling manager
  usePolling("hench-runs", fetchRuns, 10_000);

  // Deep-link: auto-select the target run once runs are loaded
  useEffect(() => {
    if (deepLinkConsumedRef.current || !initialRunId || loading || runs.length === 0) return;
    deepLinkConsumedRef.current = true;

    const targetExists = runs.some((r) => r.id === initialRunId);
    if (!targetExists) {
      setDeepLinkError(`Run "${initialRunId}" not found`);
      // Clean URL back to /hench-runs
      history.replaceState(
        { view: "hench-runs", file: null, zone: null, runId: null },
        "",
        "/hench-runs",
      );
      return;
    }

    // Auto-select and fetch detail
    setSelectedRunId(initialRunId);
    setHighlightedRunId(initialRunId);
    fetchDetail(initialRunId);

    // Clear highlight after animation completes
    const timer = setTimeout(() => setHighlightedRunId(null), 3000);
    return () => clearTimeout(timer);
  }, [initialRunId, loading, runs]);

  // Fetch detail for a specific run
  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/hench/runs/${id}`);
      if (!res.ok) {
        setRunDetail(null);
        if (id === initialRunId) {
          setDeepLinkError(`Failed to load run details (${res.status})`);
        }
        return;
      }
      const json = await res.json();
      setRunDetail(json);
    } catch {
      setRunDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [initialRunId]);

  const handleSelectRun = useCallback((id: string) => {
    setDeepLinkError(null);
    if (selectedRunId === id) {
      // Toggle off — update URL to remove run ID
      setSelectedRunId(null);
      setRunDetail(null);
      history.replaceState(
        { view: "hench-runs", file: null, zone: null, runId: null },
        "",
        "/hench-runs",
      );
    } else {
      setSelectedRunId(id);
      fetchDetail(id);
      // Update URL to include run ID for shareability
      history.replaceState(
        { view: "hench-runs", file: null, zone: null, runId: id },
        "",
        `/hench-runs/${id}`,
      );
    }
  }, [selectedRunId, fetchDetail]);

  const handleBack = useCallback(() => {
    setSelectedRunId(null);
    setRunDetail(null);
    setDeepLinkError(null);
    // Clean URL back to /hench-runs
    history.replaceState(
      { view: "hench-runs", file: null, zone: null, runId: null },
      "",
      "/hench-runs",
    );
  }, []);

  // Filter runs by status, vendor, and model
  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      // Status filter
      if (statusFilter !== "all") {
        if (statusFilter === "failed") {
          if (r.status !== "failed" && r.status !== "error") return false;
        } else if (r.status !== statusFilter) {
          return false;
        }
      }
      // Vendor filter
      if (vendorFilter !== "all") {
        if ((r.vendor ?? "unknown") !== vendorFilter) return false;
      }
      // Model filter
      if (modelFilter !== "all") {
        if (r.model !== modelFilter) return false;
      }
      return true;
    });
  }, [runs, statusFilter, vendorFilter, modelFilter]);

  // Status counts for the filter buttons
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: runs.length, completed: 0, failed: 0, running: 0 };
    for (const r of runs) {
      if (r.status === "completed") counts.completed++;
      else if (r.status === "failed" || r.status === "error") counts.failed++;
      else if (r.status === "running" || r.status === "in_progress") counts.running++;
    }
    return counts;
  }, [runs]);

  // Unique vendors and models for filter dropdowns
  const uniqueVendors = useMemo(() => {
    const vendors = new Set<string>();
    for (const r of runs) vendors.add(r.vendor ?? "unknown");
    return Array.from(vendors).sort();
  }, [runs]);

  const uniqueModels = useMemo(() => {
    const models = new Set<string>();
    for (const r of runs) models.add(r.model);
    return Array.from(models).sort();
  }, [runs]);

  // Scroll the deep-linked run card into view when it renders
  const scrolledRef = useRef(false);
  const deepLinkCardRef = useCallback((el: HTMLDivElement | null) => {
    if (el && !scrolledRef.current) {
      scrolledRef.current = true;
      // Defer so the DOM has settled
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, []);

  // Extract running runs for the active tasks panel
  const activeRuns: ActiveRun[] = useMemo(() => {
    return runs
      .filter((r) => r.status === "running" || r.status === "in_progress")
      .map((r) => ({
        id: r.id,
        taskId: r.taskId,
        taskTitle: r.taskTitle,
        taskStatus: r.taskStatus,
        startedAt: r.startedAt,
        lastActivityAt: r.lastActivityAt,
        status: r.status,
        turns: r.turns,
        model: r.model,
      }));
  }, [runs]);

  // ── Loading state ──
  if (loading) {
    return h("div", { class: "loading" }, "Loading execution history...");
  }

  // ── Error state ──
  if (error) {
    return h("div", { class: "prd-empty" },
      h("p", null, error),
      h("button", { class: "btn", onClick: fetchRuns }, "Retry"),
    );
  }

  // ── Empty state ──
  if (runs.length === 0) {
    return h("div", { class: "hench-runs-container" },
      h("div", { class: "hench-runs-header" },
        h(BrandedHeader, { product: "hench", title: "Hench", class: "branded-header-hench" }),
        h("h2", null, "Execution History"),
      ),
      deepLinkError
        ? h("div", { class: "hench-deep-link-error", role: "alert" },
            h("span", null, deepLinkError),
            h("button", {
              class: "hench-deep-link-error-dismiss",
              onClick: () => setDeepLinkError(null),
              "aria-label": "Dismiss",
            }, "×"),
          )
        : null,
      h("div", { class: "hench-empty" },
        h("div", { class: "hench-empty-icon" }, "▶"),
        h("p", null, "No runs yet."),
        h("p", { class: "hench-empty-hint" }, "Run ", h("code", null, "ndx work"), " to start executing tasks."),
      ),
    );
  }

  // ── Detail view ──
  if (selectedRunId && !detailLoading && runDetail) {
    return h("div", { class: "hench-runs-container" },
      h(RunDetailView, { run: runDetail, onBack: handleBack, navigateTo }),
    );
  }

  if (selectedRunId && detailLoading) {
    return h("div", { class: "hench-runs-container" },
      h("div", { class: "loading" }, "Loading run detail..."),
    );
  }

  // ── List view ──
  return h("div", { class: "hench-runs-container" },
    h("div", { class: "hench-runs-header" },
      h(BrandedHeader, { product: "hench", title: "Hench", class: "branded-header-hench" }),
      h("div", { class: "hench-runs-title-row" },
        h("h2", null, "Execution History"),
        h("div", { class: "hench-runs-count" }, `${runs.length} run${runs.length === 1 ? "" : "s"}`),
      ),
    ),

    // Deep-link error banner
    deepLinkError
      ? h("div", { class: "hench-deep-link-error", role: "alert" },
          h("span", null, deepLinkError),
          h("button", {
            class: "hench-deep-link-error-dismiss",
            onClick: () => setDeepLinkError(null),
            "aria-label": "Dismiss",
          }, "×"),
        )
      : null,

    // Active tasks panel — shown at top when there are running tasks
    h(ActiveTasksPanel, { runs: activeRuns, navigateTo }),

    // Concurrency status — shows process count, limits, and utilization
    h(ConcurrencyPanel, null),

    // Memory and resource health — system memory, per-task memory, health indicators
    h(MemoryPanel, null),

    // WebSocket connection health — active connections, cleanup metrics, broadcast stats
    h(WsHealthPanel, null),

    // Throttle controls — manual concurrency adjustment, pause/resume, emergency stop
    h(ThrottleControlsPanel, null),

    // Aggregate metrics
    h(RunMetrics, { runs }),

    // Filter bar
    h("div", { class: "hench-filter-bar" },
      (["all", "completed", "failed", "running"] as const).map((key) =>
        h("button", {
          key,
          class: `toggle-btn${statusFilter === key ? " active" : ""}`,
          onClick: () => setStatusFilter(key),
        },
          key === "all" ? "All" : key.charAt(0).toUpperCase() + key.slice(1),
          statusCounts[key] > 0
            ? h("span", { class: "hench-filter-count" }, ` (${statusCounts[key]})`)
            : null,
        ),
      ),
      // Vendor filter — only show when multiple vendors exist
      uniqueVendors.length > 1
        ? h("select", {
            class: "hench-filter-select",
            value: vendorFilter,
            onChange: (e: Event) => setVendorFilter((e.target as HTMLSelectElement).value),
            "aria-label": "Filter by vendor",
          },
            h("option", { value: "all" }, "All Vendors"),
            uniqueVendors.map((v) =>
              h("option", { key: v, value: v }, v),
            ),
          )
        : null,
      // Model filter — only show when multiple models exist
      uniqueModels.length > 1
        ? h("select", {
            class: "hench-filter-select",
            value: modelFilter,
            onChange: (e: Event) => setModelFilter((e.target as HTMLSelectElement).value),
            "aria-label": "Filter by model",
          },
            h("option", { value: "all" }, "All Models"),
            uniqueModels.map((m) =>
              h("option", { key: m, value: m }, m),
            ),
          )
        : null,
    ),

    // Runs list
    h("div", { class: "hench-runs-list" },
      filteredRuns.map((run) => {
        const isHL = highlightedRunId === run.id;
        return h(RunCard, {
          key: run.id,
          run,
          isSelected: selectedRunId === run.id,
          isHighlighted: isHL,
          onClick: () => handleSelectRun(run.id),
          navigateTo,
          cardRef: isHL ? deepLinkCardRef : undefined,
        });
      }),
      filteredRuns.length === 0
        ? h("div", { class: "hench-no-results" }, "No runs match the selected filter.")
        : null,
    ),
  );
}
