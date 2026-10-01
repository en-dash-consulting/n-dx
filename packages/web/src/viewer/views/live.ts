/**
 * Live overview (`/live`) — everything running across the repository, from
 * one read of `GET /api/live` kept current by the server's `live:changed`
 * frame (see `useLiveFeed`; the poll behind it is the existing 10 s cadence).
 *
 * Top to bottom: title with connection state and "updated N s ago"; the
 * machine strip; stuck runs ("Needs attention", never in "Running now");
 * "Running now" cards, each a link to its item's own Live page; and a side
 * column with the queue, worktrees and runs finished in the last hour. With
 * nothing running the page becomes an idle state that offers the two things
 * worth doing next: start the next task, or refresh the analysis.
 *
 * Reading the answer is `live-model.ts`; this file only lays it out.
 *
 * @module web/viewer/views/live
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useState, useCallback, useEffect } from "preact/hooks";
import type { NavigateTo } from "../types.js";
import {
  analyzeFraction,
  asLiveSnapshot,
  isAnalysisJob,
  useLiveFeed,
  useTick,
  type LiveConnection,
  type LiveJobFull,
  type LiveNextTask,
  type LiveRunFull,
  type LiveSnapshot,
} from "../hooks/index.js";
import type { JobTray } from "../hooks/index.js";
import { PeekLink, StartTaskButton, jobTarget, runTarget } from "../components/index.js";
import { fmtDuration, formatSince, formatTokenCount } from "../utils/format.js";
import {
  chainLabel,
  isIdle,
  jobLabel,
  machineTiles,
  phaseSegments,
  runningItems,
  stuckRuns,
  updatedLabel,
  worktreeRows,
} from "./live-model.js";

export interface LiveViewProps {
  navigateTo: NavigateTo;
  /** `manifest.analyzedAt` — how old the current analysis is. */
  analyzedAt: string | null;
  jobs: JobTray;
}

const CONNECTION_LABEL: Record<LiveConnection, string> = {
  live: "Live",
  polling: "Polling",
  offline: "Offline",
};

function elapsed(startedAt: string): string {
  return fmtDuration(startedAt, new Date().toISOString());
}

function Elapsed({ startedAt }: { startedAt: string }) {
  return h("span", { class: "live-elapsed" }, useTick(startedAt, elapsed));
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? `${fallback} (HTTP ${res.status})`;
}

// ── Header ───────────────────────────────────────────────────────────

function Updated({ generatedAt }: { generatedAt: string }) {
  return h("span", { class: "live-updated" }, useTick(generatedAt, (iso) => updatedLabel(iso, Date.now())));
}

interface HeaderProps {
  snapshot: LiveSnapshot | null;
  connection: LiveConnection;
  refresh: () => Promise<void>;
}

function Header({ snapshot, connection, refresh }: HeaderProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const check = useCallback(async () => {
    await refresh();
    setNotice("Checked just now");
  }, [refresh]);

  const stopAll = useCallback(async () => {
    if (!window.confirm("Stop every task started from this dashboard in this worktree? New tasks stay paused until resumed.")) return;
    setStopping(true);
    setNotice(null);
    try {
      const res = await fetch("/api/hench/throttle/emergency-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      setNotice(res.ok ? "Stopped" : await errorOf(res, "Could not stop"));
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not stop");
    } finally {
      setStopping(false);
    }
  }, [refresh]);

  const running = snapshot ? snapshot.runs.length + snapshot.jobs.length : 0;
  return h("header", { class: "live-header" },
    h("div", { class: "live-title-row" },
      h("h2", { class: "live-title" }, "Live"),
      h("span", { class: `live-connection live-connection-${connection}` }, CONNECTION_LABEL[connection]),
      snapshot ? h(Updated, { generatedAt: snapshot.generatedAt }) : null,
    ),
    h("div", { class: "live-actions" },
      h("button", { type: "button", class: "cmd-btn cmd-btn-secondary", onClick: check }, "Status check"),
      h("button", {
        type: "button",
        class: "cmd-btn cmd-btn-secondary live-stop-all",
        onClick: stopAll,
        disabled: stopping || running === 0,
      }, stopping ? "Stopping…" : "Stop all"),
      notice ? h("span", { class: "live-notice", role: "status" }, notice) : null,
    ),
  );
}

// ── Machine strip ────────────────────────────────────────────────────

function MachineStrip({ snapshot }: { snapshot: LiveSnapshot }) {
  const tiles = machineTiles(snapshot.machine, snapshot.jobs.length, snapshot.queue.starting.length);
  return h("section", { class: "live-machine", "aria-label": "Machine" },
    tiles.map((t) => h("div", { key: t.key, class: `live-tile${t.warn ? " live-tile-warn" : ""}` },
      h("span", { class: "live-tile-label" }, t.label),
      h("span", { class: "live-tile-value" }, t.value),
      t.detail ? h("span", { class: "live-tile-detail" }, t.detail) : null,
    )),
  );
}

// ── Cards ────────────────────────────────────────────────────────────

function WorktreeChip({ run }: { run: Pick<LiveRunFull, "worktree" | "branch"> }) {
  const name = run.branch ?? run.worktree.name;
  return h("span", { class: "live-chip live-chip-branch", title: run.worktree.path }, name);
}

function RunMeta({ run }: { run: LiveRunFull }) {
  const bits: ComponentChildren[] = [];
  if (run.model) bits.push(h("span", { key: "model", class: "live-chip" }, run.model));
  if (run.turns !== null) bits.push(h("span", { key: "turn", class: "live-chip" }, `turn ${run.turns}`));
  if (run.tokens.total > 0) bits.push(h("span", { key: "tokens", class: "live-chip" }, `${formatTokenCount(run.tokens.total)} tokens`));
  if (run.criteriaTotal !== null) bits.push(h("span", { key: "criteria", class: "live-chip" }, `${run.criteriaTotal} criteria`));
  return h("div", { class: "live-card-meta" }, h(WorktreeChip, { run }), bits);
}

function RunCard({ run, navigateTo }: { run: LiveRunFull; navigateTo: NavigateTo }) {
  const chain = chainLabel(run.epicChain);
  return h("li", { class: "live-card" },
    h(PeekLink, { target: runTarget(run), navigateTo, class: "live-card-link" },
      h("span", { class: "live-tile-kind", "aria-hidden": "true" }, "Task"),
      h("span", { class: "live-card-body" },
        h("span", { class: "live-card-title" }, run.taskTitle ?? run.runId),
        chain ? h("span", { class: "live-card-chain" }, chain) : null,
        h(RunMeta, { run }),
        run.lastProgress ? h("span", { class: "live-card-step" }, run.lastProgress) : null,
      ),
      run.startedAt ? h(Elapsed, { startedAt: run.startedAt }) : null,
    ),
  );
}

function PhaseBar({ job }: { job: LiveJobFull }) {
  const segments = phaseSegments(job.progress);
  const fraction = analyzeFraction(job.progress);
  return h("span", {
    class: "live-phasebar",
    role: "progressbar",
    "aria-label": "Analysis phases",
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": fraction === null ? 0 : Math.round(fraction * 100),
  }, segments.map((state, i) => h("span", { key: i, class: `live-phase live-phase-${state}` })));
}

function JobCard({ job, navigateTo }: { job: LiveJobFull; navigateTo: NavigateTo }) {
  const analysis = isAnalysisJob(job);
  const pass = job.progress?.pass;
  const phase = job.progress?.phase;
  // Sourcevision shows where it is in its six phases; every other job has
  // only its output, so that is what it shows.
  const step = analysis && phase
    ? `${phase.name}${pass ? ` · pass ${pass.number} ${pass.label}` : ""}`
    : job.detail;
  return h("li", { class: "live-card" },
    h(PeekLink, { target: jobTarget(job), navigateTo, class: "live-card-link" },
      h("span", { class: "live-tile-kind", "aria-hidden": "true" }, analysis ? "Analyze" : "Job"),
      h("span", { class: "live-card-body" },
        h("span", { class: "live-card-title" }, jobLabel(job)),
        h("div", { class: "live-card-meta" },
          job.worktree ? h("span", { class: "live-chip live-chip-branch" }, job.worktree.branch ?? job.worktree.name) : h("span", { class: "live-chip" }, "project"),
        ),
        job.kind === "sv-analyze" ? h(PhaseBar, { job }) : null,
        step ? h("span", { class: "live-card-step" }, step) : null,
      ),
      job.startedAt ? h(Elapsed, { startedAt: job.startedAt }) : null,
    ),
  );
}

// ── Needs attention ──────────────────────────────────────────────────

function StuckRow({ run, navigateTo, refresh }: { run: LiveRunFull; navigateTo: NavigateTo; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markStuck = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // The run record lives in its own worktree; the header addresses it.
      const headers: Record<string, string> = {};
      if (!run.worktree.isServed) headers["X-Ndx-Workspace"] = run.worktree.key;
      const res = await fetch(`/api/hench/runs/${encodeURIComponent(run.runId)}/mark-stuck`, { method: "POST", headers });
      if (!res.ok) setError(await errorOf(res, "Could not mark stuck"));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark stuck");
    } finally {
      setBusy(false);
    }
  }, [run, refresh]);

  const quiet = run.heartbeatAgeMs === null ? "no heartbeat" : `no heartbeat for ${Math.round(run.heartbeatAgeMs / 60_000)} min`;
  return h("li", { class: "live-attention-row" },
    h("span", { class: "live-attention-text" },
      h("span", { class: "live-card-title" }, run.taskTitle ?? run.runId),
      h("span", { class: "live-card-chain" }, `${quiet} · `, h(WorktreeChip, { run })),
      error ? h("span", { class: "live-error", role: "alert" }, error) : null,
    ),
    h("span", { class: "live-attention-actions" },
      h(PeekLink, { target: runTarget(run), navigateTo, class: "cmd-btn cmd-btn-secondary" }, "Open"),
      h("button", { type: "button", class: "cmd-btn cmd-btn-secondary", onClick: markStuck, disabled: busy },
        busy ? "Marking…" : "Mark stuck"),
    ),
  );
}

// ── Side column ──────────────────────────────────────────────────────

function Queue({ snapshot, navigateTo }: { snapshot: LiveSnapshot; navigateTo: NavigateTo }) {
  const [paused, setPaused] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/hench/throttle")
      .then((res) => (res.ok ? res.json() : null))
      .then((state: { paused?: boolean } | null) => {
        if (!cancelled && state && typeof state.paused === "boolean") setPaused(state.paused);
      })
      .catch(() => { /* The control stays hidden until the state is known. */ });
    return () => { cancelled = true; };
  }, []);

  const toggle = useCallback(async () => {
    setError(null);
    const action = paused ? "resume" : "pause";
    try {
      const res = await fetch(`/api/hench/throttle/${action}`, { method: "POST" });
      // 409: already in the requested state — the control was stale.
      if (res.ok || res.status === 409) setPaused(!paused);
      else setError(await errorOf(res, `Could not ${action}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action}`);
    }
  }, [paused]);

  const { next } = snapshot.queue;
  return h("section", { class: "live-side-section", "aria-labelledby": "live-queue-h" },
    h("h3", { id: "live-queue-h", class: "live-side-title" }, "Up next"),
    next.length === 0
      ? h("p", { class: "live-muted" }, "Nothing actionable in the PRD.")
      : h("ol", { class: "live-queue" }, next.map((t: LiveNextTask) =>
        h("li", { key: t.id },
          h("a", {
            class: "live-queue-item",
            href: "#",
            onClick: (e: MouseEvent) => { e.preventDefault(); navigateTo("prd", { taskId: t.id }); },
          }, h("span", { class: "live-card-title" }, t.title),
            chainLabel(t.epicChain) ? h("span", { class: "live-card-chain" }, chainLabel(t.epicChain)) : null),
        ))),
    paused === null ? null : h("button", { type: "button", class: "cmd-btn cmd-btn-secondary", onClick: toggle },
      paused ? "Resume loop" : "Pause loop after current"),
    paused ? h("p", { class: "live-muted" }, "New tasks are paused; running ones finish.") : null,
    error ? h("p", { class: "live-error", role: "alert" }, error) : null,
  );
}

function Worktrees({ snapshot }: { snapshot: LiveSnapshot }) {
  const { rows, idle } = worktreeRows(snapshot);
  if (rows.length === 0 && idle === 0) return null;
  return h("section", { class: "live-side-section", "aria-labelledby": "live-wt-h" },
    h("h3", { id: "live-wt-h", class: "live-side-title" }, "By worktree"),
    h("ul", { class: "live-worktrees" },
      rows.map(({ worktree, runs, stuck, jobs }) => h("li", { key: worktree.key, class: "live-worktree" },
        h("span", { class: "live-chip live-chip-branch", title: worktree.path }, worktree.branch ?? worktree.name),
        h("span", { class: "live-muted" },
          [runs > 0 ? `${runs} run${runs === 1 ? "" : "s"}` : null, jobs > 0 ? `${jobs} job${jobs === 1 ? "" : "s"}` : null,
            stuck > 0 ? `${stuck} stuck` : null].filter(Boolean).join(" · ")),
      )),
      idle > 0 ? h("li", { class: "live-worktree live-muted" }, `${idle} more idle`) : null,
    ),
  );
}

function Recent({ snapshot, navigateTo }: { snapshot: LiveSnapshot; navigateTo: NavigateTo }) {
  return h("section", { class: "live-side-section", "aria-labelledby": "live-recent-h" },
    h("h3", { id: "live-recent-h", class: "live-side-title" }, "Finished in the last hour"),
    snapshot.recent.length === 0
      ? h("p", { class: "live-muted" }, "None.")
      : h("ul", { class: "live-recent" }, snapshot.recent.map((run) => h("li", { key: run.runId },
        h("a", {
          class: "live-queue-item",
          href: "#",
          onClick: (e: MouseEvent) => { e.preventDefault(); navigateTo("hench-runs", { runId: run.runId }); },
        },
          h("span", { class: "live-card-title" }, run.taskTitle ?? run.runId),
          h("span", { class: "live-card-chain" }, [run.status, formatSince(run.finishedAt)].filter(Boolean).join(" · ")),
        )))),
    h("a", {
      class: "live-more",
      href: "#",
      onClick: (e: MouseEvent) => { e.preventDefault(); navigateTo("hench-runs"); },
    }, "Run history"),
  );
}

// ── Idle ─────────────────────────────────────────────────────────────

function IdleState({ snapshot, analyzedAt, jobs, refresh }: {
  snapshot: LiveSnapshot;
  analyzedAt: string | null;
  jobs: JobTray;
  refresh: () => Promise<void>;
}) {
  const next = snapshot.queue.next[0] ?? null;
  const [busy, setBusy] = useState<"fast" | "deep" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async (mode: "fast" | "deep") => {
    setBusy(mode);
    setError(null);
    try {
      // Fast is the synchronous structural refresh; deep runs every enrichment
      // pass and the sub-packages as a background job, shown by Running now.
      const res = await fetch("/api/commands/sv-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "deep" ? { full: true, deep: true } : {}),
      });
      // 409: one is already running, which is the state the user asked for.
      if (!res.ok && res.status !== 409) setError(await errorOf(res, "Analysis failed to start"));
      await Promise.all([jobs.refresh(), refresh()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed to start");
    } finally {
      setBusy(null);
    }
  }, [jobs, refresh]);

  return h("section", { class: "live-idle", "aria-label": "Nothing running" },
    h("p", { class: "live-idle-lede" }, "Nothing is running."),
    h("div", { class: "live-idle-grid" },
      h("div", { class: "live-idle-card" },
        h("h3", null, "Start the next task"),
        next
          ? [
            h("p", { key: "t", class: "live-card-title" }, next.title),
            chainLabel(next.epicChain) ? h("p", { key: "c", class: "live-card-chain" }, chainLabel(next.epicChain)) : null,
            h(StartTaskButton, { key: "b", taskId: next.id, label: "Start working", onStarted: () => { void refresh(); } }),
          ]
          : h("p", { class: "live-muted" }, "Nothing actionable in the PRD."),
      ),
      h("div", { class: "live-idle-card" },
        h("h3", null, "Refresh the analysis"),
        h("p", { class: "live-muted" }, analyzedAt ? `Last analyzed ${formatSince(analyzedAt) ?? "recently"}.` : "No analysis yet."),
        h("div", { class: "live-idle-actions" },
          h("button", { type: "button", class: "cmd-btn cmd-btn-primary", disabled: busy !== null, onClick: () => { void analyze("fast"); } },
            busy === "fast" ? "Analyzing…" : "Run analysis (fast)"),
          h("button", { type: "button", class: "cmd-btn cmd-btn-secondary", disabled: busy !== null, onClick: () => { void analyze("deep"); } },
            busy === "deep" ? "Starting…" : "Run analysis (deep)"),
        ),
        error ? h("p", { class: "live-error", role: "alert" }, error) : null,
      ),
    ),
  );
}

// ── View ─────────────────────────────────────────────────────────────

export function LiveView({ navigateTo, analyzedAt, jobs }: LiveViewProps) {
  const { live, connection, refresh } = useLiveFeed();
  const snapshot = asLiveSnapshot(live);
  const stuck = snapshot ? stuckRuns(snapshot) : [];
  const items = snapshot ? runningItems(snapshot) : [];

  return h("div", { class: "live-container" },
    h(Header, { snapshot, connection, refresh }),
    snapshot === null
      ? h("p", { class: "live-muted", role: "status" },
        connection === "offline" ? "The dashboard server is not answering." : "Loading…")
      : [
        h(MachineStrip, { key: "machine", snapshot }),
        h("div", { key: "body", class: "live-body" },
          h("div", { class: "live-main" },
            stuck.length > 0
              ? h("section", { class: "live-attention", "aria-labelledby": "live-attention-h" },
                h("h3", { id: "live-attention-h", class: "live-section-title" }, "Needs attention"),
                h("ul", { class: "live-attention-list" }, stuck.map((run) =>
                  h(StuckRow, { key: run.runId, run, navigateTo, refresh }))))
              : null,
            isIdle(snapshot)
              ? h(IdleState, { snapshot, analyzedAt, jobs, refresh })
              : items.length > 0
                ? h("section", { "aria-labelledby": "live-running-h" },
                  h("h3", { id: "live-running-h", class: "live-section-title" }, "Running now"),
                  h("ul", { class: "live-cards" }, items.map((item) => item.kind === "run"
                    ? h(RunCard, { key: item.key, run: item.run, navigateTo })
                    : h(JobCard, { key: item.key, job: item.job, navigateTo }))))
                : null,
          ),
          h("aside", { class: "live-side", "aria-label": "Queue and history" },
            h(Queue, { snapshot, navigateTo }),
            h(Worktrees, { snapshot }),
            h(Recent, { snapshot, navigateTo }),
          ),
        ),
      ],
  );
}
