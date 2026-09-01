/**
 * Working-tree status indicator — a persistent bottom-right pill (same
 * interaction pattern as ActiveOperationsTray) that appears only when the
 * git working tree is dirty, and expands into a panel to review per-file
 * diffs and commit everything without leaving the browser.
 *
 * Exists specifically because hench's autonomous-run pre-flight check
 * (performPreRunCommitGateIfNeeded, packages/hench) refuses to start against
 * a dirty tree, and the dashboard had no visibility into that at all — a
 * blocked run looked like an opaque failure. Deliberately narrow: stage-all
 * + commit only, no partial staging, branch switching, or conflict
 * resolution — see routes-git.ts for the full rationale.
 */

import { h, Fragment } from "preact";
import { useState, useCallback } from "preact/hooks";
import type { GitStatus, GitStatusFile } from "../hooks/index.js";

export interface GitStatusBannerProps {
  status: GitStatus | null;
  onCommitted: () => void;
}

interface DiffResult {
  file: string;
  diff: string | null;
  newFile: boolean;
  preview: string | null;
  truncated: boolean;
}

const STATUS_LABEL: Record<GitStatusFile["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
  unmerged: "U",
  other: "•",
};

/** Renders a unified diff with basic +/- coloring. */
function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return h("pre", { class: "git-diff-view" },
    lines.map((line, i) => {
      const cls = line.startsWith("+") && !line.startsWith("+++")
        ? "git-diff-add"
        : line.startsWith("-") && !line.startsWith("---")
          ? "git-diff-del"
          : line.startsWith("@@")
            ? "git-diff-hunk"
            : "git-diff-ctx";
      return h("div", { key: i, class: cls }, line || " ");
    }),
  );
}

function FileRow({ file }: { file: GitStatusFile }) {
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    setExpanded((v) => !v);
    if (!result && !loading) {
      setLoading(true);
      try {
        const res = await fetch(`/api/git/diff?file=${encodeURIComponent(file.path)}`);
        if (res.ok) setResult(await res.json() as DiffResult);
      } catch {
        // Leave result null — row shows "failed to load" via the fallback below.
      } finally {
        setLoading(false);
      }
    }
  }, [file.path, result, loading]);

  return h(Fragment, null,
    h("li", { class: `git-file-row git-file-${file.status}` },
      h("button", { class: "git-file-toggle", type: "button", onClick: toggle },
        h("span", { class: "git-file-code", "aria-hidden": "true" }, STATUS_LABEL[file.status]),
        h("span", { class: "git-file-path" }, file.path),
      ),
    ),
    expanded
      ? h("li", { class: "git-file-diff-container" },
          loading
            ? h("div", { class: "git-diff-loading" }, "Loading diff…")
            : result
              ? result.newFile
                ? h(Fragment, null,
                    h("div", { class: "git-diff-newfile-label" }, "New file"),
                    result.preview
                      ? h("pre", { class: "git-diff-view" }, result.preview)
                      : h("div", { class: "git-diff-loading" }, "(binary or unreadable — no preview)"),
                    result.truncated ? h("div", { class: "git-diff-truncated" }, "Preview truncated.") : null,
                  )
                : h(Fragment, null,
                    result.diff
                      ? h(DiffView, { diff: result.diff })
                      : h("div", { class: "git-diff-loading" }, "No diff available."),
                    result.truncated ? h("div", { class: "git-diff-truncated" }, "Diff truncated.") : null,
                  )
              : h("div", { class: "git-diff-loading" }, "Failed to load diff."),
        )
      : null,
  );
}

function GitStatusPanel({
  status, onCommitted, onClose,
}: { status: GitStatus; onCommitted: () => void; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  const busy = committing || discarding;

  const handleCommit = useCallback(async () => {
    if (!message.trim()) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessage("");
      onCommitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }, [message, onCommitted]);

  const handleDiscard = useCallback(async () => {
    setDiscarding(true);
    setDiscardError(null);
    try {
      const res = await fetch("/api/git/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmCount: status.files.length }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onCommitted();
    } catch (err) {
      setDiscardError(err instanceof Error ? err.message : String(err));
      setConfirmingDiscard(false);
    } finally {
      setDiscarding(false);
    }
  }, [status.files.length, onCommitted]);

  return h("div", { class: "git-status-panel" },
    h("div", { class: "git-status-panel-header" },
      h("strong", null, `${status.files.length} uncommitted file${status.files.length === 1 ? "" : "s"}`),
      status.branch ? h("span", { class: "git-status-branch" }, ` on ${status.branch}`) : null,
      h("button", { class: "git-status-close", type: "button", onClick: onClose, "aria-label": "Close" }, "✕"),
    ),
    h("p", { class: "git-status-hint" },
      "Autonomous runs (Start Working, self-heal, etc.) refuse to start against a dirty tree. Commit here, or from a terminal.",
    ),
    h("ul", { class: "git-file-list" },
      status.files.map((f) => h(FileRow, { key: f.path, file: f })),
    ),

    confirmingDiscard
      ? h("div", { class: "prune-confirmation-warning", role: "alert" },
          h("div", { class: "prune-confirmation-warning-icon" }, "⚠"),
          h("div", null,
            h("strong", null, "This discards every uncommitted change."),
            h("p", null,
              `Modified and deleted tracked files revert to their last commit. Untracked files (new files not yet added to git) are permanently deleted — this does not go through git's history and cannot be undone. ${status.files.length} file${status.files.length === 1 ? "" : "s"} will be affected.`,
            ),
            h("div", { class: "git-discard-confirm-actions" },
              h("button", {
                class: "git-discard-cancel-btn",
                type: "button",
                onClick: () => setConfirmingDiscard(false),
                disabled: discarding,
              }, "Cancel"),
              h("button", {
                class: "git-discard-confirm-btn",
                type: "button",
                onClick: handleDiscard,
                disabled: discarding,
              }, discarding ? "Discarding…" : `Discard ${status.files.length} File${status.files.length === 1 ? "" : "s"}`),
            ),
          ),
        )
      : h("div", { class: "git-commit-form" },
          h("textarea", {
            class: "git-commit-message",
            placeholder: "Commit message…",
            value: message,
            disabled: busy,
            onInput: (e: Event) => setMessage((e.target as HTMLTextAreaElement).value),
            rows: 2,
          }),
          h("div", { class: "git-commit-form-actions" },
            h("button", {
              class: "git-discard-btn",
              type: "button",
              disabled: busy,
              onClick: () => setConfirmingDiscard(true),
            }, "Discard…"),
            h("button", {
              class: "git-commit-btn",
              type: "button",
              disabled: busy || !message.trim(),
              onClick: handleCommit,
            }, committing ? "Committing…" : "Stage All & Commit"),
          ),
        ),
    error ? h("div", { class: "git-commit-error", role: "alert" }, error) : null,
    discardError ? h("div", { class: "git-commit-error", role: "alert" }, discardError) : null,
  );
}

export function GitStatusBanner({ status, onCommitted }: GitStatusBannerProps) {
  const [expanded, setExpanded] = useState(false);

  if (!status || !status.isRepo || !status.dirty) return null;

  return h("div", { class: "git-status-banner", role: "status" },
    !expanded
      ? h("button", {
          class: "git-status-toggle",
          type: "button",
          onClick: () => setExpanded(true),
        },
          h("span", { class: "git-status-badge-icon", "aria-hidden": "true" }, "⚠"),
          h("span", null, `${status.files.length} uncommitted file${status.files.length === 1 ? "" : "s"}`),
        )
      : h(GitStatusPanel, {
          status,
          onCommitted: () => { setExpanded(false); onCommitted(); },
          onClose: () => setExpanded(false),
        }),
  );
}
