/**
 * The hub snapshot: every registered project's worktrees (with their Sidecar
 * sessions' latest unfinished and decision notes), runs, open PRs and pending
 * changesets, as text of at most {@link HUB_SNAPSHOT_CAP} characters.
 *
 * Pure. The input is what the hub's HTTP API and each project's server
 * answered (`hub-snapshot-fetch.ts` asks for it); the output is the text a
 * hub-scope Sidecar turn starts from, and the per-item fingerprints the next
 * build compares against to mark what changed with `Δ`.
 *
 * Over the cap it drops whole items, lowest priority first — idle worktrees
 * and plain changesets before PRs and running work, unchanged before changed,
 * later before earlier — and says how many it left out. Project headings,
 * unreachable projects and release flags (a major bump, a changeset that
 * mentions 1.0.0) are never dropped.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §6.
 */

import type { ProjectCard, QueueSnapshot } from "../../hub/index.js";
import type { BranchHealth, ConflictClass } from "../branch-health/index.js";
import type { PendingChangeset } from "../routes-changesets.js";
import type { SidecarLedgerLatestResponse } from "./ledger.js";

export const HUB_SNAPSHOT_CAP = 8_000;

/** The longest task title the snapshot quotes. */
const TITLE_CHARS = 60;

/** One HTTP read: its JSON, or why there is none. */
export type Fetched<T> = { ok: true; value: T } | { ok: false; error: string };

/** The subset of one `GET /api/worktrees` entry the snapshot reads. */
export interface SnapshotWorktree {
  path: string;
  branch: string | null;
  isAnchor: boolean;
  dirtyFiles: number | null;
  runs: {
    running: number;
    latest: { status: string; taskTitle: string | null; diagnosisClass?: string | null } | null;
  };
}

/** The subset of `GET /api/status` the snapshot reads. */
export interface SnapshotStatus {
  rex?: { exists?: boolean; layout?: "v1" | "v2" };
}

/** The subset of `GET /api/hench/concurrency` the snapshot reads. */
export interface SnapshotConcurrency {
  totalRunning?: number;
  maxConcurrent?: number;
}

/** The subset of `GET /api/workspaces` the snapshot reads. */
export interface SnapshotWorkspaces {
  anchor: string;
  workspaces: Array<{ key: string; path: string }>;
}

/** The subset of `GET /api/rex/claims` the snapshot reads. */
export interface SnapshotClaims {
  claims: Array<{ taskId: string; taskTitle: string | null; worktreeRoot: string }>;
}

/** What one project's server answered, through the hub's `/p/<id>/` prefix. */
export interface ProjectReads {
  /** `GET /api/status`. */
  status: Fetched<SnapshotStatus>;
  /** `GET /api/hench/concurrency`. */
  concurrency: Fetched<SnapshotConcurrency>;
  /** `GET /api/workspaces`: keys for the worktree paths. */
  workspaces: Fetched<SnapshotWorkspaces>;
  /** `GET /api/worktrees`. */
  worktrees: Fetched<SnapshotWorktree[]>;
  /** `GET /api/rex/claims`. */
  claims: Fetched<SnapshotClaims>;
  /** `GET /api/changesets`. */
  changesets: Fetched<{ changesets: PendingChangeset[] }>;
  /** `GET /w/<key>/api/branch-health?github=1`, by workspace key. */
  branchHealth: Record<string, Fetched<BranchHealth>>;
  /**
   * `GET /w/<key>/api/sidecar/ledger/latest`, by workspace key: each Sidecar
   * session's latest unfinished and decision notes. `null` where the
   * worktree has web.sidecar off, so it has no sessions to report.
   */
  sessionNotes?: Record<string, Fetched<SidecarLedgerLatestResponse | null>>;
}

export interface HubSnapshotInput {
  /** `GET /api/hub/overview`. */
  overview: Fetched<{ projects: ProjectCard[] }>;
  /** `GET /api/hub/queue`, unscoped. */
  queue: Fetched<QueueSnapshot>;
  /** Per project id; a reachable project with no entry was not read. */
  projects: Record<string, ProjectReads>;
  /** ISO time the reads finished. */
  generatedAt: string;
}

/** What the next build compares against: each item's text without its marker. */
export interface HubSnapshotState {
  fingerprints: Record<string, string>;
}

export interface HubSnapshot {
  text: string;
  /** Pass to the next build as `previous`. */
  state: HubSnapshotState;
  /** Keys of the items marked Δ. */
  changed: string[];
  /** How many items were left out to stay within the cap. */
  omitted: number;
  /** Every worktree the snapshot read with a workspace key, the drawer's drill-down targets. */
  worktrees: HubSnapshotWorktreeRef[];
}

/** A worktree the hub can hand off to: its project and workspace key. */
export interface HubSnapshotWorktreeRef {
  project: string;
  projectName: string;
  /** The workspace key; the project's anchor has its own. */
  key: string;
  branch: string | null;
  /** The worktree, or one of its session notes, is marked Δ in this snapshot. */
  changed: boolean;
}

/** Lower is kept longer; 0 is never dropped. */
type Priority = 0 | 1 | 2 | 3;

interface Item {
  /** Stable across builds; null for structure lines that are never marked. */
  key: string | null;
  priority: Priority;
  /** The noun the omission note counts it under. */
  kind: string;
  /** One or more lines; a Δ marker goes after the leading bullet. */
  text: string;
}

const line = (text: string): Item => ({ key: null, priority: 0, kind: "line", text });

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function quoted(title: string | null): string {
  return title ? ` "${clip(title, TITLE_CHARS)}"` : "";
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function machineLine(queue: Fetched<QueueSnapshot>): string {
  if (!queue.ok) return `Machine: admission queue not read: ${queue.error}`;
  const q = queue.value;
  const memory = q.memoryPaused ? "admission paused: low memory" : `memory ${q.pressure}`;
  return `Machine: ${q.running} of ${q.limits.maxSessions} sessions running · ${q.entries.length} queued · ${memory}`;
}

function prdLabel(card: ProjectCard, status: Fetched<SnapshotStatus>): string {
  if (!status.ok) return `PRD not read: ${status.error}`;
  const rex = status.value.rex;
  if (!rex?.exists) return "no PRD";
  const percent = card.percentComplete === null ? "" : ` · ${card.percentComplete}% complete`;
  if (rex.layout === "v1") return `PRD v1 (not migrated)${percent}`;
  if (rex.layout === "v2") return `PRD v2${percent}`;
  return `PRD layout unknown${percent}`;
}

function runsLine(card: ProjectCard, concurrency: ProjectReads["concurrency"]): string {
  if (concurrency.ok && typeof concurrency.value.totalRunning === "number" && typeof concurrency.value.maxConcurrent === "number") {
    const { totalRunning, maxConcurrent } = concurrency.value;
    return `Active runs: ${totalRunning} of limit ${maxConcurrent}${totalRunning >= maxConcurrent ? " (AT LIMIT)" : ""}`;
  }
  const why = concurrency.ok ? "the answer had no counts" : concurrency.error;
  return `Active runs: ${card.activeRuns ?? "unknown"}, limit not read: ${why}`;
}

function queueItems(id: string, queue: Fetched<QueueSnapshot>): Item[] {
  if (!queue.ok) return [];
  const waiting = queue.value.entries.filter((e) => e.projectId === id);
  const dropped = queue.value.dropped.filter((e) => e.projectId === id);
  const items: Item[] = [line(`Hub queue: ${waiting.length} waiting${dropped.length > 0 ? `, ${dropped.length} dropped` : ""}`)];
  waiting.forEach((e, i) => items.push({
    key: `queue:${id}:${e.workspace ?? ""}:${e.taskId}`,
    priority: 1,
    kind: "queue entry",
    text: `- ${i + 1}. task ${shortId(e.taskId)} in ${e.workspace ?? "the anchor"} (${e.mode ?? "single"})`,
  }));
  for (const e of dropped) {
    items.push({
      key: `dropped:${id}:${e.workspace ?? ""}:${e.taskId}`,
      priority: 2,
      kind: "queue entry",
      text: `- dropped: task ${shortId(e.taskId)} in ${e.workspace ?? "the anchor"}: ${e.status ?? "unreachable"} ${clip(e.error, 80)}`,
    });
  }
  return items;
}

function healthOf(reads: ProjectReads, key: string | undefined): Fetched<BranchHealth> | undefined {
  return key === undefined ? undefined : reads.branchHealth[key];
}

function worktreeItem(id: string, wt: SnapshotWorktree, key: string | undefined, reads: ProjectReads): Item {
  const claims = reads.claims.ok ? reads.claims.value.claims.filter((c) => c.worktreeRoot === wt.path) : [];
  const health = healthOf(reads, key);
  const parts = [wt.branch ?? "(detached HEAD)"];
  parts.push(wt.dirtyFiles === null ? "dirty unknown" : wt.dirtyFiles === 0 ? "clean" : `${wt.dirtyFiles} dirty`);
  if (health?.ok) {
    const h = health.value;
    parts.push(h.ahead === null || h.behind === null ? "no base" : `ahead ${h.ahead} behind ${h.behind} of ${h.base}`);
  } else {
    parts.push(health ? `ahead/behind not read: ${clip(health.error, 80)}` : "ahead/behind not read");
  }
  if (!reads.claims.ok) parts.push("claim not read");
  else parts.push(claims.length === 0 ? "no claim" : `claim ${claims.map((c) => `${shortId(c.taskId)}${quoted(c.taskTitle)}`).join(", ")}`);
  const latest = wt.runs.latest;
  parts.push(latest
    ? `last run ${latest.status}${quoted(latest.taskTitle)}${latest.diagnosisClass ? ` (diagnosis: ${latest.diagnosisClass})` : ""}`
    : "no runs");
  const busy = wt.runs.running > 0 || claims.length > 0 || (wt.dirtyFiles ?? 0) > 0 || (latest !== null && latest.status !== "completed");
  return {
    key: `worktree:${id}:${wt.path}`,
    priority: busy ? 1 : 2,
    kind: "worktree",
    text: `- ${key ?? wt.path}${wt.isAnchor ? " [anchor]" : ""}: ${parts.join(" · ")}`,
  };
}

/** The worktree's notes item key prefix; each session's note item adds its id. */
function notesKeyPrefix(id: string, path: string): string {
  return `notes:${id}:${path}:`;
}

/**
 * Under a worktree, each of its Sidecar sessions' latest unfinished and
 * decision notes: what deep work left for the hub to see. Dropped before the
 * worktree line itself.
 */
function sessionNoteItems(id: string, wt: SnapshotWorktree, key: string | undefined, reads: ProjectReads): Item[] {
  const notes = key === undefined ? undefined : reads.sessionNotes?.[key];
  if (!notes) return [];
  if (!notes.ok) return [{ key: null, priority: 3, kind: "session note", text: `  - Sidecar notes not read: ${clip(notes.error, 80)}` }];
  if (notes.value === null) return [];
  return notes.value.sessions.flatMap((s) => {
    const parts = [
      ...(s.unfinished ? [`unfinished: ${s.unfinished.text}`] : []),
      ...(s.decision ? [`decision: ${s.decision.text}`] : []),
    ];
    if (parts.length === 0) return [];
    return [{
      key: `${notesKeyPrefix(id, wt.path)}${s.id}`,
      priority: 2 as const,
      kind: "session note",
      text: `  - Sidecar "${clip(s.name, 40)}": ${parts.join(" · ")}`,
    }];
  });
}

function conflictSummary(h: BranchHealth): string {
  if (h.conflictsUnavailable) return `conflicts not predicted: ${clip(h.conflictsUnavailable, 80)}`;
  if (h.conflicts.length === 0) return "no conflicts";
  const counts = new Map<ConflictClass, number>();
  for (const c of h.conflicts) counts.set(c.class, (counts.get(c.class) ?? 0) + 1);
  return `${plural(h.conflicts.length, "conflict")} (${[...counts].map(([cls, n]) => `${cls} ×${n}`).join(", ")})`;
}

function stackSummary(h: BranchHealth): string {
  if (h.stack.length === 0) return "not stacked";
  const below = h.stack.map((l) => `${l.branch} ${l.contained ? "contained" : "NOT contained"}`).join(", ");
  return `stack layer ${h.stack.length + 1}, below: ${below}`;
}

function prItems(id: string, reads: ProjectReads, keys: string[]): Item[] {
  const asked = keys.flatMap((key) => {
    const health = reads.branchHealth[key];
    return health ? [{ key, health }] : [];
  });
  if (asked.length === 0) return [line("Open PRs: branch health not read")];
  const read = asked.flatMap((r) => (r.health.ok ? [{ key: r.key, health: r.health.value }] : []));
  if (read.length === 0) {
    const first = asked[0].health;
    return [line(`Open PRs: branch health not read${first.ok ? "" : `: ${clip(first.error, 120)}`}`)];
  }
  if (read.every((r) => !r.health.githubReads)) {
    return [line("Open PRs: GitHub reads are off for this project (web.sidecarGithubReads), so PR facts were not read.")];
  }
  const prs = read.filter((r) => r.health.github !== null);
  const items: Item[] = [line(`Open PRs: ${prs.length}`)];
  for (const { key, health: h } of prs) {
    const pr = h.github!;
    items.push({
      key: `pr:${id}:${pr.number}`,
      priority: 1,
      kind: "PR",
      text: `- #${pr.number} ${h.branch ?? key} → ${pr.baseRefName}${pr.isCrossRepository ? " (fork)" : ""} · ${stackSummary(h)} · review ${pr.reviewDecision ?? "none"} · checks ${pr.checks.total} total, ${pr.checks.failing} failing, ${pr.checks.pending} pending · mergeable ${pr.mergeable} (${pr.mergeStateStatus}) · ${conflictSummary(h)}`,
    });
  }
  return items;
}

function changesetItems(id: string, reads: ProjectReads): Item[] {
  if (!reads.changesets.ok) return [line(`Pending changesets: not read: ${clip(reads.changesets.error, 120)}`)];
  const list = reads.changesets.value.changesets;
  const items: Item[] = [line(`Pending changesets: ${list.length}`)];
  for (const cs of list) {
    const flags: string[] = [];
    if (cs.packages.some((p) => p.bump === "major")) flags.push("⚠ MAJOR bump");
    if (cs.summary.includes("1.0.0")) flags.push("⚠ mentions 1.0.0");
    if (cs.error) flags.push(`unreadable: ${clip(cs.error, 80)}`);
    const bumps = cs.packages.length > 0 ? cs.packages.map((p) => `${p.name} ${p.bump}`).join(", ") : "no packages";
    items.push({
      key: `changeset:${id}:${cs.file}`,
      priority: flags.length > 0 ? 0 : 2,
      kind: "changeset",
      text: `- ${cs.file}: ${bumps}${flags.length > 0 ? ` · ${flags.join(" · ")}` : ""}`,
    });
  }
  return items;
}

function projectItems(card: ProjectCard, reads: ProjectReads | undefined, queue: Fetched<QueueSnapshot>): Item[] {
  const id = card.id;
  const heading = `## ${card.name} (${id}) · ${card.state}`;
  if (!card.reachable) {
    return [
      line(""),
      { key: `project:${id}`, priority: 0, kind: "project", text: `${heading} · UNREACHABLE: ${card.error ?? "no answer"}` },
      ...queueItems(id, queue),
    ];
  }
  if (!reads) {
    return [line(""), { key: `project:${id}`, priority: 0, kind: "project", text: `${heading} · not read this turn` }];
  }
  const items: Item[] = [
    line(""),
    { key: `project:${id}`, priority: 0, kind: "project", text: `${heading} · ${prdLabel(card, reads.status)}` },
    { key: `runs:${id}`, priority: 0, kind: "run count", text: runsLine(card, reads.concurrency) },
    ...queueItems(id, queue),
  ];

  const keyByPath = new Map(reads.workspaces.ok ? reads.workspaces.value.workspaces.map((w) => [w.path, w.key]) : []);
  if (!reads.worktrees.ok) {
    items.push(line(`Worktrees: not read: ${clip(reads.worktrees.error, 120)}`));
  } else {
    items.push(line(`Worktrees: ${reads.worktrees.value.length}`));
    for (const wt of reads.worktrees.value) {
      const key = keyByPath.get(wt.path);
      items.push(worktreeItem(id, wt, key, reads), ...sessionNoteItems(id, wt, key, reads));
    }
  }
  items.push(...prItems(id, reads, [...keyByPath.values()]));
  items.push(...changesetItems(id, reads));
  return items;
}

/** `Δ` after the list bullet when there is one, so a marked item is still a list item. */
function marked(text: string): string {
  const bullet = /^\s*(?:- )?/.exec(text)![0].length;
  return `${text.slice(0, bullet)}Δ ${text.slice(bullet)}`;
}

function omissionNote(dropped: Item[]): string {
  const byKind = new Map<string, number>();
  for (const item of dropped) byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
  const detail = [...byKind].map(([kind, n]) => plural(n, kind)).join(", ");
  return `[${plural(dropped.length, "item")} left out to stay within ${HUB_SNAPSHOT_CAP.toLocaleString("en-US")} characters: ${detail}]`;
}

/**
 * Build the snapshot. `previous` is the state the last build returned; without
 * it nothing is marked, because there is nothing to have changed since.
 */
export function buildHubSnapshot(input: HubSnapshotInput, previous?: HubSnapshotState | null): HubSnapshot {
  const items: Item[] = [
    line(`# Hub snapshot · ${input.generatedAt}`),
    line(`Built by code from the hub's HTTP API. No model wrote it. ${previous ? "Δ marks an item that changed since the previous snapshot." : "First snapshot of this session: nothing is marked Δ."}`),
    { key: "machine", priority: 0, kind: "line", text: machineLine(input.queue) },
  ];
  if (!input.overview.ok) {
    items.push(line(`Projects: hub overview not read: ${input.overview.error}`));
  } else {
    items.push(line(`Projects: ${input.overview.value.projects.length}`));
    for (const card of input.overview.value.projects) items.push(...projectItems(card, input.projects[card.id], input.queue));
  }

  const fingerprints: Record<string, string> = {};
  const changed = new Set<string>();
  for (const item of items) {
    if (item.key === null) continue;
    fingerprints[item.key] = item.text;
    if (previous && previous.fingerprints[item.key] !== item.text) changed.add(item.key);
  }
  if (previous) {
    const gone = Object.keys(previous.fingerprints).filter((k) => !(k in fingerprints));
    if (gone.length > 0) items.push(line(""), { key: null, priority: 3, kind: "gone note", text: `Gone since the previous snapshot: ${gone.join(", ")}` });
  }

  const render = (item: Item): string => (item.key !== null && changed.has(item.key) ? marked(item.text) : item.text);
  const length = (kept: Item[], note: string | null): number =>
    kept.reduce((n, item) => n + render(item).length + 1, 0) + (note === null ? 0 : note.length + 1);

  // Drop order: highest priority number first, unchanged before changed, last before first.
  const order = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.priority > 0)
    .sort((a, b) =>
      b.item.priority - a.item.priority
      || Number(a.item.key !== null && changed.has(a.item.key)) - Number(b.item.key !== null && changed.has(b.item.key))
      || b.index - a.index);
  const droppedSet = new Set<Item>();
  const dropped: Item[] = [];
  let kept = items;
  for (const { item } of order) {
    if (length(kept, dropped.length === 0 ? null : omissionNote(dropped)) <= HUB_SNAPSHOT_CAP) break;
    droppedSet.add(item);
    dropped.push(item);
    kept = items.filter((i) => !droppedSet.has(i));
  }
  // A dropped item was not shown, so it keeps the fingerprint of when it last was (or none):
  // the first build that shows it again then marks it Δ if it changed in between.
  for (const item of dropped) {
    if (item.key === null) continue;
    changed.delete(item.key);
    const shown = previous?.fingerprints[item.key];
    if (shown === undefined) delete fingerprints[item.key];
    else fingerprints[item.key] = shown;
  }
  const lines = kept.map(render);
  if (dropped.length > 0) lines.push(omissionNote(dropped));
  let text = lines.join("\n");
  if (text.length > HUB_SNAPSHOT_CAP) {
    // Only never-dropped lines remain and they still overflow: cut at the cap, and say so.
    const tag = "\n[cut at the character cap]";
    text = text.slice(0, HUB_SNAPSHOT_CAP - tag.length) + tag;
  }
  return { text, state: { fingerprints }, changed: [...changed], omitted: dropped.length, worktrees: worktreeRefs(input, changed) };
}

function worktreeRefs(input: HubSnapshotInput, changed: ReadonlySet<string>): HubSnapshotWorktreeRef[] {
  if (!input.overview.ok) return [];
  return input.overview.value.projects.flatMap((card) => {
    const reads = input.projects[card.id];
    if (!reads?.worktrees.ok || !reads.workspaces.ok) return [];
    const keyByPath = new Map(reads.workspaces.value.workspaces.map((w) => [w.path, w.key]));
    return reads.worktrees.value.flatMap((wt) => {
      const key = keyByPath.get(wt.path);
      if (key === undefined) return [];
      const notes = notesKeyPrefix(card.id, wt.path);
      return [{
        project: card.id,
        projectName: card.name,
        key,
        branch: wt.branch,
        changed: changed.has(`worktree:${card.id}:${wt.path}`) || [...changed].some((k) => k.startsWith(notes)),
      }];
    });
  });
}
