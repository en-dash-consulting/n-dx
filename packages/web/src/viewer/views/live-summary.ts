/**
 * The running-task page's Summary tab — what the page becomes once the
 * selected run has finished.
 *
 * In order: the actions (Re-run, Open commit, Capture follow-up), the run's
 * own closing words, what the work changed, what the reviewer found and what
 * was done about it, the run's metrics, and the commits it landed. Reading is
 * `live-summary-model.ts`.
 *
 * Everything here comes from `GET /api/hench/runs/:id`, the route the Work
 * view already uses, plus the task snapshot the page already holds — the
 * summary added no server data of its own.
 *
 * Capture files the follow-up through `POST /api/rex/items` under the task's
 * own parent, with no `type`, so the server fills in whatever child that
 * parent takes. A project whose store refuses the write (a v2 change layer
 * takes no parent here) answers with the command that does work, and that
 * answer is shown verbatim rather than guessed at.
 *
 * @module web/viewer/views/live-summary
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useCallback, useState } from "preact/hooks";
import type { NavigateTo, ViewId } from "../types.js";
import type { LiveTaskRun, LiveTaskSnapshot, RunRecordSummary } from "../hooks/index.js";
import { useProjectMetadata } from "../hooks/index.js";
import { StartTaskButton } from "../components/index.js";
import { commitLinkUrl } from "../utils/commit-link.js";
import { actionLabel, findingTitle, outcomeCounts, severityClass, splitFindings } from "./live-review-model.js";
import {
  NOT_RECORDED,
  fileChanges,
  followUpDescription,
  followUpParentId,
  runCommits,
  runMetrics,
  workCounts,
} from "./live-summary-model.js";

/** Longest first line kept as a captured item's title; the rest stays in the body. */
const MAX_FOLLOW_UP_TITLE = 120;

function Block({ id, title, children }: { id: string; title: string; children?: ComponentChildren }) {
  return h("section", { class: "live-summary-block", "aria-labelledby": id },
    h("h3", { id, class: "live-side-title" }, title),
    children,
  );
}

// ── Actions ──────────────────────────────────────────────────────────

function CaptureFollowUp({ snapshot, run, navigateTo }: {
  snapshot: LiveTaskSnapshot;
  run: LiveTaskRun;
  navigateTo: NavigateTo;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);
  const parentId = followUpParentId(snapshot.task?.epicChain ?? []);

  const submit = useCallback(async () => {
    const text = note.trim();
    if (text.length === 0 || !parentId || !snapshot.task) return;
    const firstLine = text.split("\n")[0].trim();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rex/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: firstLine.slice(0, MAX_FOLLOW_UP_TITLE),
          parentId,
          description: followUpDescription(snapshot.task.title, run.runId, text),
        }),
      });
      const body = await res.json().catch(() => null) as { id?: string; title?: string; error?: string } | null;
      if (!res.ok || !body?.id) {
        setError(body?.error ?? `Could not capture the follow-up (HTTP ${res.status})`);
        return;
      }
      setCreated({ id: body.id, title: body.title ?? firstLine });
      setNote("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not capture the follow-up");
    } finally {
      setBusy(false);
    }
  }, [note, parentId, snapshot.task, run.runId]);

  if (!parentId) {
    return h("span", { class: "live-muted" },
      "A follow-up needs a parent to file under, and this task has no recorded ancestors.");
  }

  return h("div", { class: "live-capture" },
    h("button", {
      type: "button",
      class: "cmd-btn cmd-btn-secondary",
      "aria-expanded": String(open),
      onClick: () => { setOpen(!open); setError(null); },
    }, "Capture follow-up"),
    open
      ? h("div", { class: "live-capture-form" },
        h("label", { class: "sr-only", for: "live-capture-note" }, "What should follow this run"),
        h("textarea", {
          id: "live-capture-note",
          class: "live-capture-note",
          rows: 3,
          value: note,
          placeholder: "What still needs doing? The first line becomes the title.",
          onInput: (e: Event) => setNote((e.target as HTMLTextAreaElement).value),
        }),
        h("button", {
          type: "button",
          class: "cmd-btn",
          disabled: busy || note.trim().length === 0,
          onClick: () => { void submit(); },
        }, busy ? "Capturing…" : "Add to the PRD"),
      )
      : null,
    error ? h("p", { class: "live-capture-error", role: "alert" }, error) : null,
    created
      ? h("p", { class: "live-capture-done", role: "status" },
        "Captured as ",
        h("a", {
          href: "#",
          class: "live-more",
          onClick: (e: MouseEvent) => { e.preventDefault(); navigateTo("prd" as ViewId, { taskId: created.id }); },
        }, created.title))
      : null,
  );
}

function Actions({ snapshot, run, record, navigateTo, onRerun }: {
  snapshot: LiveTaskSnapshot;
  run: LiveTaskRun;
  record: RunRecordSummary | null;
  navigateTo: NavigateTo;
  onRerun: () => void;
}) {
  const remoteUrl = useProjectMetadata()?.git?.remoteUrl ?? null;
  const commits = runCommits(record);
  const first = commits[0] ?? null;
  const url = first ? commitLinkUrl(first.sha, remoteUrl) : null;
  // Another run of this task is already going: starting a second one is what
  // the whole live feed exists to prevent, so Re-run stands down for it.
  const live = snapshot.runs.some((r) => r.status === "running");

  return h("div", { class: "live-actions live-summary-actions" },
    live
      ? h("span", { class: "live-muted" }, "A run of this task is already going.")
      : h(StartTaskButton, {
        taskId: snapshot.taskId,
        label: "Re-run",
        ariaLabel: `Re-run ${snapshot.task?.title ?? snapshot.taskId}`,
        onStarted: onRerun,
        navigateTo,
      }),
    first
      ? url
        ? h("a", {
          class: "cmd-btn cmd-btn-secondary",
          href: url,
          target: "_blank",
          rel: "noopener noreferrer",
          title: first.subject,
        }, `Open commit ${first.shortSha}`)
        : h("span", { class: "live-chip live-mono", title: first.subject }, first.shortSha)
      : null,
    h(CaptureFollowUp, { snapshot, run, navigateTo }),
  );
}

// ── Sections ─────────────────────────────────────────────────────────

function Outcome({ run, record }: { run: LiveTaskRun; record: RunRecordSummary | null }) {
  const error = record?.error ?? null;
  const text = error ?? record?.summary ?? run.outcome;
  if (!text) return h("p", { class: "live-muted" }, "This run recorded no closing summary.");
  return h("p", { class: `live-summary-outcome${error ? " live-summary-outcome-failed" : ""}` }, text);
}

function Work({ record, onOpenWork }: { record: RunRecordSummary | null; onOpenWork: () => void }) {
  const counts = workCounts(record);
  const changes = fileChanges(record);
  return h(Block, { id: "lt-sum-work-h", title: "What the run did" },
    counts.length === 0
      ? h("p", { class: "live-muted" }, "No work summary was recorded for this run.")
      : h("dl", { class: "live-facts" }, counts.flatMap((c) => [
        h("dt", { key: `${c.key}-t` }, c.label),
        h("dd", { key: `${c.key}-d` }, String(c.value)),
      ])),
    changes.length > 0
      ? h("ul", { class: "live-summary-files", "aria-label": "Files changed" }, changes.map((c) =>
        h("li", { key: c.path, class: "live-summary-file" },
          h("span", { class: `live-summary-file-status live-summary-file-status-${c.status}` }, c.status),
          h("span", { class: "live-mono" }, c.path),
        )))
      : null,
    h("a", {
      href: "#",
      class: "live-more",
      onClick: (e: MouseEvent) => { e.preventDefault(); onOpenWork(); },
    }, "See every step"),
  );
}

function Review({ run, onOpenReview }: { run: LiveTaskRun; onOpenReview: () => void }) {
  const report = run.reviewReport;
  const failed = run.review?.failed ?? null;
  if (!report && !failed) return null;
  if (!report) {
    return h(Block, { id: "lt-sum-review-h", title: "What the review found" },
      h("p", { class: "live-review-reason", role: "status" },
        `The review did not run: ${failed}${run.review?.detail ? ` — ${run.review.detail}` : ""}`));
  }
  const { active } = splitFindings(report);
  const counts = outcomeCounts(report);
  return h(Block, { id: "lt-sum-review-h", title: "What the review found" },
    report.summary ? h("p", { class: "live-review-summary" }, report.summary) : null,
    report.findings.length === 0
      ? h("p", { class: "live-muted" }, "The reviewer found nothing.")
      : [
        h("p", { key: "counts", class: "live-summary-counts" }, counts.map((c) =>
          h("span", { key: c.action, class: `live-chip live-finding-action live-finding-action-${c.action}` }, `${c.count} ${c.label}`))),
        h("ul", { key: "list", class: "live-summary-findings", "aria-label": "Review findings" }, active.map((f, i) =>
          h("li", { key: i },
            f.severity ? h("span", { class: `live-sev live-sev-${severityClass(f.severity)}` }, f.severity) : null,
            h("span", { class: "live-step-summary" }, findingTitle(f)),
            f.action ? h("span", { class: "live-step-detail" }, actionLabel(f.action) ?? f.action) : null,
          ))),
      ],
    h("a", {
      href: "#",
      class: "live-more",
      onClick: (e: MouseEvent) => { e.preventDefault(); onOpenReview(); },
    }, "Open the Review tab"),
  );
}

function Metrics({ run, record }: { run: LiveTaskRun; record: RunRecordSummary | null }) {
  return h(Block, { id: "lt-sum-metrics-h", title: "Run metrics" },
    h("dl", { class: "live-facts" }, runMetrics(run, record).flatMap((row) => [
      h("dt", { key: `${row.key}-t` }, row.label),
      h("dd", {
        key: `${row.key}-d`,
        title: row.title,
        class: row.value === NOT_RECORDED ? "live-muted" : undefined,
      }, row.value),
    ])),
  );
}

function Commits({ record }: { record: RunRecordSummary | null }) {
  const remoteUrl = useProjectMetadata()?.git?.remoteUrl ?? null;
  const commits = runCommits(record);
  const uncommitted = record?.uncommittedPaths ?? [];
  if (commits.length === 0 && uncommitted.length === 0) return null;
  return h(Block, { id: "lt-sum-commits-h", title: "What it landed" },
    commits.length === 0
      ? h("p", { class: "live-muted" }, "This run landed no commit.")
      : h("ul", { class: "live-summary-commits" }, commits.map((c) => {
        const url = commitLinkUrl(c.sha, remoteUrl);
        return h("li", { key: c.sha },
          url
            ? h("a", { class: "live-mono", href: url, target: "_blank", rel: "noopener noreferrer" }, c.shortSha)
            : h("span", { class: "live-mono" }, c.shortSha),
          h("span", { class: "live-step-detail" }, c.subject),
        );
      })),
    uncommitted.length > 0
      ? h("p", { class: "live-muted", title: uncommitted.join("\n") },
        `${uncommitted.length} path${uncommitted.length === 1 ? "" : "s"} left uncommitted in the working tree.`)
      : null,
  );
}

// ── Tab ──────────────────────────────────────────────────────────────

export interface SummaryTabProps {
  snapshot: LiveTaskSnapshot;
  run: LiveTaskRun;
  record: RunRecordSummary | null;
  loading: boolean;
  /** Why the record could not be read; the rest of the tab still renders from the snapshot. */
  error: string | null;
  navigateTo: NavigateTo;
  onOpenWork: () => void;
  onOpenReview: () => void;
  onRerun: () => void;
}

export function SummaryTab({
  snapshot, run, record, loading, error, navigateTo, onOpenWork, onOpenReview, onRerun,
}: SummaryTabProps) {
  return h("div", { class: "live-summary" },
    h(Actions, { snapshot, run, record, navigateTo, onRerun }),
    h(Outcome, { run, record }),
    error ? h("p", { class: "live-muted", role: "status" }, `${error} — metrics below come from the task feed alone.`) : null,
    loading ? h("p", { class: "live-muted", role: "status" }, "Loading the run's record…") : null,
    h(Work, { record, onOpenWork }),
    h(Review, { run, onOpenReview }),
    h(Metrics, { run, record }),
    h(Commits, { record }),
  );
}
