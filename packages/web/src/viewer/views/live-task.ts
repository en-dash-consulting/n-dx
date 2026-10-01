/**
 * The running-task page (`/live/task/:taskId`, under `/w/<key>/` for another
 * worktree): one hench run of a task, followed step by step.
 *
 * Header: where this is, run n of m (a picker when the task has several),
 * the title, chips — running and elapsed, epic chain, priority, turn, tokens,
 * model, heartbeat — and Copy link, Mark stuck and Stop. The main card has
 * Work, Log and (for a run with an adversarial review) Review tabs; Work is
 * the progress event stream, one line per step, with the log's last lines
 * under it. The side column has the task and its criteria, its runs, where
 * the run is, what it has spent, and what happens after it.
 *
 * The selected run is in the URL (`?run=<id>`); picking another replaces it
 * without a reload. Reading the data is `live-task-model.ts`.
 *
 * @module web/viewer/views/live-task
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import type { NavigateTo } from "../types.js";
import {
  useLiveTask,
  useTick,
  type LiveTaskRun,
  type LiveTaskSnapshot,
  type RunEventLine,
} from "../hooks/index.js";
import { WorkspaceWriteStrip } from "../components/index.js";
import { fmtDuration, formatSince, formatTokenCount } from "../utils/format.js";
import { formatUsd } from "./live-model.js";
import { LogTab } from "./live-log.js";
import {
  afterRunItems,
  criteriaRows,
  editedFiles,
  hasReview,
  headerChips,
  readRunParam,
  runPosition,
  selectRun,
  stepRows,
  withRunParam,
  type StepRow,
} from "./live-task-model.js";

export interface LiveTaskViewProps {
  taskId: string;
  navigateTo: NavigateTo;
}

type TabId = "work" | "log" | "review";

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? `${fallback} (HTTP ${res.status})`;
}

function elapsed(startedAt: string): string {
  return fmtDuration(startedAt, new Date().toISOString());
}

function Elapsed({ startedAt }: { startedAt: string }) {
  return h("span", null, useTick(startedAt, elapsed));
}

function shortSha(sha: string | null): string | null {
  return sha ? sha.slice(0, 10) : null;
}

// ── Header ───────────────────────────────────────────────────────────

interface HeaderProps {
  taskId: string;
  snapshot: LiveTaskSnapshot;
  run: LiveTaskRun | null;
  onPick: (runId: string) => void;
  navigateTo: NavigateTo;
  refresh: () => Promise<void>;
}

function Header({ taskId, snapshot, run, onPick, navigateTo, refresh }: HeaderProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"stop" | "stuck" | null>(null);
  const running = run?.status === "running";
  const position = run ? runPosition(snapshot.runs, run.runId) : null;

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setNotice("Link copied");
    } catch {
      setNotice("Could not copy the link");
    }
  }, []);

  const act = useCallback(async (kind: "stop" | "stuck") => {
    if (!run) return;
    if (kind === "stop" && !window.confirm(
      run.startedFrom === "terminal"
        ? `Stop this run? It was started from a terminal; its process (pid ${run.pid ?? "unknown"}) is sent a stop signal.`
        : "Stop this run? The agent process is terminated and the run is marked failed.",
    )) return;
    setBusy(kind);
    setNotice(null);
    try {
      const url = kind === "stop"
        ? `/api/hench/execute/${encodeURIComponent(taskId)}/terminate`
        : `/api/hench/runs/${encodeURIComponent(run.runId)}/mark-stuck`;
      const res = await fetch(url, { method: "POST" });
      setNotice(res.ok ? (kind === "stop" ? "Stopped" : "Marked stuck") : await errorOf(res, kind === "stop" ? "Could not stop" : "Could not mark stuck"));
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }, [run, taskId, refresh]);

  const title = snapshot.task?.title ?? run?.runId ?? taskId;
  return h("header", { class: "live-task-header" },
    h("nav", { class: "live-task-route", "aria-label": "Location" },
      h("a", {
        href: "#",
        onClick: (e: MouseEvent) => { e.preventDefault(); navigateTo("live"); },
      }, "Live"),
      h("span", { "aria-hidden": "true" }, " / "),
      h("span", null, "Task"),
      position ? h("span", { class: "live-task-position" }, ` · run ${position.n} of ${position.m}`) : null,
      snapshot.runs.length > 1 && run
        ? h("select", {
          class: "live-task-picker",
          "aria-label": "Run",
          value: run.runId,
          onChange: (e: Event) => onPick((e.target as HTMLSelectElement).value),
        }, snapshot.runs.map((r, i) => h("option", { key: r.runId, value: r.runId },
          `Run ${snapshot.runs.length - i} · ${r.status}${r.startedAt ? ` · ${formatSince(r.startedAt) ?? ""}` : ""}`)))
        : null,
    ),
    h("div", { class: "live-header" },
      h("h2", { class: "live-task-title" }, title),
      h("div", { class: "live-actions" },
        h("button", { type: "button", class: "cmd-btn cmd-btn-secondary", onClick: copyLink }, "Copy link"),
        running ? h("button", {
          type: "button", class: "cmd-btn cmd-btn-secondary", disabled: busy !== null, onClick: () => { void act("stuck"); },
        }, busy === "stuck" ? "Marking…" : "Mark stuck") : null,
        running ? h("button", {
          type: "button", class: "cmd-btn cmd-btn-secondary live-stop", disabled: busy !== null, onClick: () => { void act("stop"); },
        }, busy === "stop" ? "Stopping…" : "Stop") : null,
        notice ? h("span", { class: "live-notice", role: "status" }, notice) : null,
      ),
    ),
    run ? h(Chips, { run, snapshot }) : null,
  );
}

function Chips({ run, snapshot }: { run: LiveTaskRun; snapshot: LiveTaskSnapshot }) {
  const running = run.status === "running";
  return h("div", { class: "live-card-meta live-task-chips" },
    h("span", { class: `live-chip live-task-status live-task-status-${running ? (run.stale ? "stuck" : "running") : run.status}` },
      running ? (run.stale ? "stuck" : "running") : run.status,
      run.startedAt ? [" · ", running ? h(Elapsed, { key: "e", startedAt: run.startedAt }) : fmtDuration(run.startedAt, run.finishedAt ?? undefined)] : null),
    headerChips(run, snapshot.task, snapshot.maxTurns, Date.now()).map((chip) =>
      h("span", { key: chip.key, class: `live-chip${chip.warn ? " live-chip-warn" : ""}` }, chip.label)),
  );
}

// ── Work tab ─────────────────────────────────────────────────────────

function StepList({ rows }: { rows: StepRow[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [following, setFollowing] = useState(true);
  const programmatic = useRef(false);

  // Following keeps the newest (current) step in view as steps arrive.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !following) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
  }, [rows.length, following]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (programmatic.current) { programmatic.current = false; return; }
    // Scrolling up to read stops following; reaching the bottom resumes it.
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 8);
  }, []);

  return h("div", { class: "live-steps-wrap" },
    h("ol", { class: "live-steps", ref: listRef, onScroll, "aria-label": "Steps", "aria-live": "polite" },
      rows.map((row) => h("li", {
        key: row.key,
        class: `live-step${row.current ? " live-step-current" : ""}`,
        "aria-current": row.current ? "step" : undefined,
      },
        h("time", { class: "live-step-time", dateTime: row.at }, row.time),
        h("span", { class: `live-step-dot live-step-dot-${row.status}`, "aria-hidden": "true" }),
        h("span", { class: "live-step-text" },
          h("span", { class: "live-step-summary" }, row.summary),
          row.detail ? h("span", { class: "live-step-detail" }, row.detail) : null,
        ),
      )),
    ),
    following ? null : h("button", {
      type: "button", class: "cmd-btn cmd-btn-secondary live-follow", onClick: () => setFollowing(true),
    }, "Follow"),
  );
}

function LegacyRun({ run }: { run: LiveTaskRun }) {
  return h("div", { class: "live-task-legacy" },
    h("dl", { class: "live-facts" },
      h("dt", null, "Turns"), h("dd", null, run.turns ?? "—"),
      h("dt", null, "Tokens"), h("dd", null, formatTokenCount(run.tokens.total)),
      h("dt", null, "Last heartbeat"), h("dd", null, run.lastActivityAt ? formatSince(run.lastActivityAt) ?? run.lastActivityAt : "none recorded"),
    ),
    h("p", { class: "live-muted" }, "Step detail unavailable for this run: it was recorded before runs wrote a progress event stream."),
  );
}

function WorkTab({ run, events, eventsAvailable, onOpenLog }: {
  run: LiveTaskRun;
  events: RunEventLine[];
  eventsAvailable: boolean | null;
  onOpenLog: () => void;
}) {
  const running = run.status === "running";
  const body = eventsAvailable === false
    ? h(LegacyRun, { run })
    : events.length === 0
      ? h("p", { class: "live-muted", role: "status" }, eventsAvailable === null ? "Loading steps…" : running ? "Waiting for the first step…" : "This run recorded no steps.")
      : h(StepList, { rows: stepRows(events, running) });
  return h("div", { class: "live-work" },
    body,
    h("div", { class: "live-log-tail" },
      h("div", { class: "live-log-tail-head" },
        h("span", { class: "live-side-title" }, "Log"),
        h("a", { href: "#", class: "live-more", onClick: (e: MouseEvent) => { e.preventDefault(); onOpenLog(); } }, "Open the log"),
      ),
      run.logTail.length > 0
        ? h("pre", { class: "live-log-lines" }, run.logTail.join("\n"))
        : h("p", { class: "live-muted" }, "No log output yet."),
    ),
  );
}

// ── Log and Review tabs ──────────────────────────────────────────────

function ReviewTab({ run, events }: { run: LiveTaskRun; events: RunEventLine[] }) {
  const item = afterRunItems(run, events).find((i) => i.key === "review");
  const lines = events.filter((e) => e.kind === "review_started" || e.kind === "review_report");
  return h("div", { class: "live-work" },
    item ? h("p", null, h("strong", null, item.label), ` — ${item.detail ?? item.state}`) : null,
    lines.length > 0 ? h(StepList, { rows: stepRows(lines, run.status === "running") }) : null,
  );
}

// ── Side column ──────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children?: ComponentChildren }) {
  return h("section", { class: "live-side-section", "aria-labelledby": id },
    h("h3", { id, class: "live-side-title" }, title),
    children,
  );
}

function TaskSection({ snapshot }: { snapshot: LiveTaskSnapshot }) {
  const task = snapshot.task;
  if (!task) return h(Section, { id: "lt-task-h", title: "Task" }, h("p", { class: "live-muted" }, "This worktree's PRD does not have this task."));
  const criteria = criteriaRows(task);
  return h(Section, { id: "lt-task-h", title: "Task" },
    task.description ? h("p", { class: "live-task-desc" }, task.description) : null,
    criteria.length > 0
      ? h("ul", { class: "live-criteria", "aria-label": "Acceptance criteria" }, criteria.map((c, i) =>
        h("li", { key: i, class: `live-criterion live-criterion-${c.met ? "met" : "open"}` },
          h("span", { class: "live-criterion-mark", "aria-hidden": "true" }, c.met ? "✓" : "○"),
          h("span", null, c.text),
          h("span", { class: "sr-only" }, c.met ? " (met)" : " (not yet met)"),
        )))
      : h("p", { class: "live-muted" }, "No acceptance criteria."),
  );
}

function RunsSection({ snapshot, run, onPick }: { snapshot: LiveTaskSnapshot; run: LiveTaskRun | null; onPick: (id: string) => void }) {
  return h(Section, { id: "lt-runs-h", title: "Runs of this task" },
    h("ul", { class: "live-recent" }, snapshot.runs.map((r, i) => {
      const current = r.runId === run?.runId;
      return h("li", { key: r.runId, class: `live-task-run${current ? " live-task-run-current" : ""}`, "aria-current": current ? "true" : undefined },
        h("span", { class: "live-card-title" }, `Run ${snapshot.runs.length - i}`),
        h("span", { class: "live-card-chain" }, [r.status, formatSince(r.finishedAt ?? r.startedAt)].filter(Boolean).join(" · ")),
        r.outcome ? h("span", { class: "live-card-chain live-task-outcome" }, r.outcome) : null,
        current ? null : h("a", {
          href: withRunParam(location.search, r.runId),
          class: "live-more",
          onClick: (e: MouseEvent) => { e.preventDefault(); onPick(r.runId); },
        }, "View"),
      );
    })),
  );
}

function WhereSection({ run, events }: { run: LiveTaskRun; events: RunEventLine[] }) {
  const files = editedFiles(events);
  const running = run.status === "running";
  return h(Section, { id: "lt-where-h", title: "Where it runs" },
    h("dl", { class: "live-facts" },
      h("dt", null, "Worktree"), h("dd", { class: "live-mono" }, run.worktreeRoot ?? "—"),
      h("dt", null, "Branch"), h("dd", { class: "live-mono" }, run.branch ?? "detached"),
      h("dt", null, "Start commit"), h("dd", { class: "live-mono" }, shortSha(run.startHead) ?? "—"),
      h("dt", null, running ? "Files changed so far" : "Files changed"),
      h("dd", { title: files.join("\n") || undefined }, String(files.length)),
      running ? [
        h("dt", { key: "pt" }, "Process"),
        h("dd", { key: "pd" }, `${run.pid !== null ? `pid ${run.pid}` : "pid unknown"} · started from ${run.startedFrom === "dashboard" ? "the dashboard" : "a terminal"}`),
      ] : null,
    ),
  );
}

function SpendSection({ run }: { run: LiveTaskRun }) {
  return h(Section, { id: "lt-spend-h", title: run.status === "running" ? "Spend so far" : "Spend" },
    h("dl", { class: "live-facts" },
      h("dt", null, "Input"), h("dd", null, formatTokenCount(run.tokens.input)),
      h("dt", null, "Output"), h("dd", null, formatTokenCount(run.tokens.output)),
      h("dt", null, "Cache read"), h("dd", null, formatTokenCount(run.tokens.cacheReadInput)),
      h("dt", null, "Cost"), h("dd", null, formatUsd(run.costUsd)),
    ),
  );
}

function AfterSection({ run, events }: { run: LiveTaskRun; events: RunEventLine[] }) {
  return h(Section, { id: "lt-after-h", title: "After the run" },
    h("ul", { class: "live-recent" }, afterRunItems(run, events).map((item) =>
      h("li", { key: item.key, class: "live-after-item" },
        h("span", { class: `live-step-dot live-step-dot-${item.state === "running" ? "active" : item.state === "pending" ? "info" : item.state}`, "aria-hidden": "true" }),
        h("span", { class: "live-step-text" },
          h("span", { class: "live-card-title" }, item.label),
          item.detail ? h("span", { class: "live-step-detail" }, item.detail) : null,
        ),
      ))),
  );
}

// ── View ─────────────────────────────────────────────────────────────

export function LiveTaskView({ taskId, navigateTo }: LiveTaskViewProps) {
  const [requested, setRequested] = useState<string | null>(() => readRunParam(location.search));
  const [tab, setTab] = useState<TabId>("work");
  const pick = useCallback((s: LiveTaskSnapshot) => selectRun(s.runs, requested), [requested]);
  const { snapshot, run, error, events, eventsAvailable, refresh } = useLiveTask(taskId, pick);

  // The URL records the run on show, so a copied link opens this run even
  // when it was reached as the task's default.
  const shownRunId = run?.runId ?? null;
  useEffect(() => {
    if (!shownRunId || readRunParam(location.search) === shownRunId) return;
    history.replaceState(history.state, "", `${location.pathname}${withRunParam(location.search, shownRunId)}${location.hash}`);
  }, [shownRunId]);

  const onPick = useCallback((runId: string) => {
    setRequested(runId);
    setTab("work");
  }, []);

  const review = run ? hasReview(run, events) : false;
  const activeTab: TabId = tab === "review" && !review ? "work" : tab;
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "work", label: "Work" },
    { id: "log", label: "Log" },
    ...(review ? [{ id: "review" as const, label: "Review" }] : []),
  ];

  return h("div", { class: "live-container live-task" },
    h(WorkspaceWriteStrip, null),
    snapshot === null
      ? h("p", { class: "live-muted", role: "status" }, error ?? "Loading…")
      : [
        h(Header, { key: "header", taskId, snapshot, run, onPick, navigateTo, refresh }),
        run && run.status !== "running"
          ? h("p", { key: "done", class: "live-task-finished", role: "status" },
            `This run ${run.status === "completed" ? "finished" : `ended: ${run.status}`}${run.finishedAt ? ` ${formatSince(run.finishedAt) ?? ""}` : ""}. `,
            h("a", {
              href: "#",
              onClick: (e: MouseEvent) => { e.preventDefault(); navigateTo("hench-runs", { runId: run.runId }); },
            }, "Open its run detail in Work"))
          : null,
        run === null
          ? h("p", { key: "none", class: "live-muted" }, "This task has no runs in this worktree.")
          : h("div", { key: "body", class: "live-body" },
            h("section", { class: "live-main live-task-card", "aria-label": "Run" },
              h("div", { class: "live-tabs", role: "tablist" }, tabs.map((t) => h("button", {
                key: t.id,
                type: "button",
                role: "tab",
                id: `live-task-tab-${t.id}`,
                "aria-selected": activeTab === t.id,
                "aria-controls": "live-task-panel",
                class: `live-tab${activeTab === t.id ? " live-tab-active" : ""}`,
                onClick: () => setTab(t.id),
              }, t.label))),
              h("div", { id: "live-task-panel", role: "tabpanel", "aria-labelledby": `live-task-tab-${activeTab}`, class: "live-task-panel" },
                activeTab === "work"
                  ? h(WorkTab, { run, events, eventsAvailable, onOpenLog: () => setTab("log") })
                  : activeTab === "log"
                    ? h(LogTab, { run, taskId })
                    : h(ReviewTab, { run, events }),
              ),
            ),
            h("aside", { class: "live-side", "aria-label": "Task and run" },
              h(TaskSection, { snapshot }),
              h(RunsSection, { snapshot, run, onPick }),
              h(WhereSection, { run, events }),
              h(SpendSection, { run }),
              h(AfterSection, { run, events }),
            ),
          ),
      ],
  );
}
