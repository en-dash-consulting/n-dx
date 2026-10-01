/**
 * The running-task page's reading of its data, kept pure so every state the
 * acceptance criteria name — the current step, a run picked from several, a
 * run recorded before the event stream — is testable without a DOM.
 * `live-task.ts` only lays these answers out.
 *
 * @module web/viewer/views/live-task-model
 */

import type { LiveTaskItem, LiveTaskRun, RunEventLine } from "../hooks/index.js";
import { formatTokenCount } from "../utils/format.js";

// ── Which run ────────────────────────────────────────────────────────

/** The query parameter that records the selected run in the page's URL. */
export const RUN_PARAM = "run";

export function readRunParam(search: string): string | null {
  const value = new URLSearchParams(search).get(RUN_PARAM);
  return value && value.length > 0 ? value : null;
}

/** `search` with the run parameter set (or removed for null), other parameters kept. */
export function withRunParam(search: string, runId: string | null): string {
  const params = new URLSearchParams(search);
  if (runId) params.set(RUN_PARAM, runId);
  else params.delete(RUN_PARAM);
  const out = params.toString();
  return out ? `?${out}` : "";
}

/**
 * The run the page shows: the one the URL asks for when the task has it,
 * else the task's current run (the running one), else its newest.
 */
export function selectRun(runs: readonly LiveTaskRun[], requested: string | null): LiveTaskRun | null {
  if (requested) {
    const asked = runs.find((r) => r.runId === requested);
    if (asked) return asked;
  }
  return runs.find((r) => r.status === "running") ?? runs[0] ?? null;
}

/** "run 2 of 3", counting from the first run of the task. `runs` is newest first. */
export function runPosition(runs: readonly LiveTaskRun[], runId: string): { n: number; m: number } | null {
  const at = runs.findIndex((r) => r.runId === runId);
  return at < 0 ? null : { n: runs.length - at, m: runs.length };
}

// ── Step stream ──────────────────────────────────────────────────────

export type StepStatus = "ok" | "fail" | "warn" | "info" | "active";

export interface StepRow {
  key: number;
  at: string;
  /** Local wall-clock time, HH:MM:SS. */
  time: string;
  status: StepStatus;
  summary: string;
  detail: string | null;
  /** The step the run is on now: the newest, while it is still running. */
  current: boolean;
}

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

function stepStatus(event: RunEventLine): StepStatus {
  if (event.ok === true) return "ok";
  if (event.ok === false) return "fail";
  if (event.kind === "retry") return "warn";
  return "info";
}

/** One line per event, in the order written; the newest is current while the run runs. */
export function stepRows(events: readonly RunEventLine[], running: boolean): StepRow[] {
  return events.map((event, i) => {
    const current = running && i === events.length - 1;
    return {
      key: event.seq,
      at: event.at,
      time: clock(event.at),
      status: current && event.ok === undefined ? "active" : stepStatus(event),
      summary: event.summary,
      detail: event.detail ?? null,
      current,
    };
  });
}

/** Files the run has edited so far, by path, in first-edit order. */
export function editedFiles(events: readonly RunEventLine[]): string[] {
  const seen = new Set<string>();
  for (const e of events) if (e.kind === "file_edited" && e.detail) seen.add(e.detail);
  return [...seen];
}

// ── Header ───────────────────────────────────────────────────────────

/** Tokens per second: the dashboard's own measure when it has one, else output over elapsed. */
export function tokensPerSecond(run: LiveTaskRun, now: number): number | null {
  if (run.tokensPerSecond !== null) return run.tokensPerSecond;
  if (!run.startedAt || run.tokens.output <= 0) return null;
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const seconds = (end - Date.parse(run.startedAt)) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? run.tokens.output / seconds : null;
}

/** "12 s ago", "4 min ago". */
export function ageLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

export interface HeaderChip {
  key: string;
  label: string;
  /** Worth a second look (a stuck heartbeat). */
  warn?: boolean;
}

/**
 * The chips after the title, elapsed time aside (it ticks, so the view
 * renders it itself). Chips with nothing to say are left out.
 */
export function headerChips(run: LiveTaskRun, task: LiveTaskItem | null, maxTurns: number | null, now: number): HeaderChip[] {
  const chips: HeaderChip[] = [];
  const chain = task?.epicChain.map((c) => c.title).join(" › ");
  if (chain) chips.push({ key: "chain", label: chain });
  if (task?.priority) chips.push({ key: "priority", label: task.priority });
  if (run.turns !== null) chips.push({ key: "turn", label: maxTurns ? `turn ${run.turns} of ${maxTurns}` : `turn ${run.turns}` });
  if (run.tokens.total > 0) {
    const rate = tokensPerSecond(run, now);
    chips.push({ key: "tokens", label: `${formatTokenCount(run.tokens.total)} tokens${rate !== null ? ` · ${rate.toFixed(1)} tok/s` : ""}` });
  }
  const model = [run.vendor, run.model, run.weight].filter(Boolean).join(" · ");
  if (model) chips.push({ key: "model", label: model });
  if (run.status === "running") {
    chips.push(run.heartbeatAgeMs === null
      ? { key: "heartbeat", label: "no heartbeat", warn: true }
      : { key: "heartbeat", label: `heartbeat ${ageLabel(run.heartbeatAgeMs)}`, warn: run.stale });
  }
  return chips;
}

// ── Side column ──────────────────────────────────────────────────────

export interface CriterionRow {
  text: string;
  met: boolean;
}

/**
 * The task's acceptance criteria. Nothing records a criterion as met while a
 * run is going, so they read as met only once the task itself is completed.
 */
export function criteriaRows(task: LiveTaskItem | null): CriterionRow[] {
  if (!task) return [];
  const met = task.status === "completed";
  return task.acceptanceCriteria.map((text) => ({ text, met }));
}

export interface AfterRunItem {
  key: string;
  label: string;
  state: "ok" | "fail" | "pending" | "running";
  detail: string | null;
}

/**
 * Whether the run has an adversarial review: it was started with `--review`
 * (the run record says so from launch), or the review has begun or been
 * recorded — which is how a run recorded before that field is recognised.
 */
export function hasReview(run: LiveTaskRun, events: readonly RunEventLine[]): boolean {
  return run.reviewPlan !== null || run.review !== null || events.some((e) => e.kind === "review_started" || e.kind === "review_report");
}

function lastOf(events: readonly RunEventLine[], kinds: readonly string[]): RunEventLine | null {
  for (let i = events.length - 1; i >= 0; i--) if (kinds.includes(events[i].kind)) return events[i];
  return null;
}

/** What happens once the agent stops: the gates, and the review when there is one. */
export function afterRunItems(run: LiveTaskRun, events: readonly RunEventLine[]): AfterRunItem[] {
  const gate = lastOf(events, ["gate", "tests_run"]);
  const items: AfterRunItem[] = [{
    key: "gates",
    label: "Tests and completion gates",
    state: gate ? (gate.ok === false ? "fail" : "ok") : "pending",
    detail: gate?.summary ?? (run.status === "running" ? "Run when the agent finishes" : "None recorded"),
  }];
  if (hasReview(run, events)) {
    const report = lastOf(events, ["review_report"]);
    const failed = run.review?.failed ?? null;
    const findings = run.review?.findings ?? null;
    const started = run.review !== null || events.some((e) => e.kind === "review_started" || e.kind === "review_report");
    items.push({
      key: "review",
      label: "Adversarial review",
      state: failed ? "fail" : run.review || report ? "ok" : started ? "running" : "pending",
      detail: failed
        ?? (findings !== null ? `${findings} finding${findings === 1 ? "" : "s"}${run.review?.unresolved ? `, ${run.review.unresolved} unresolved` : ""}` : report?.summary ?? (started ? "In progress" : "Runs after validation")),
    });
  }
  return items;
}
