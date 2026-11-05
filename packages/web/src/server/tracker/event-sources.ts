/**
 * The ndx events tracker sync acts on, collected by the project server at
 * each tick from what it already records; nothing here is pushed by hench or
 * by GitHub. One source per event, each with its own cursor
 * (event-cursors.ts), so an event is queued once and a restarted server does
 * not queue it again:
 *
 * - `run-started`: a hench run record (`<henchDir>/runs/`), by `startedAt`.
 * - `run-failed-twice`: a run that ends a task's second hard failure in a
 *   row (hench's own rule, `stuck-tasks.ts`), by `finishedAt`, carrying the
 *   run's diagnosis summary and best-ranked action.
 * - `pr-opened` / `pr-merged`: a PR whose description or commits carry an
 *   `N-DX-Item` trailer, by `createdAt` / `mergedAt`. Read with gh, only
 *   while the project's GitHub reads (`web.sidecarGithubReads`) are on. A PR
 *   carries its URL and the CODEOWNERS owner of its files, when one matches.
 * - `release-published`: a change stamped `shippedIn` a version that has a
 *   git tag (`v1.2.3`, `@scope/pkg@1.2.3`), once per change and version.
 *
 * Each event is about the rex item nearest the one it names that links to a
 * tracker work item (the item, else its parent, and so on), and carries that
 * item's first ref. An event about an item nothing links to is dropped.
 *
 * gh and git run through the llm-client `exec` (injected for tests), never a
 * shell, and never stop to prompt. A source that cannot be read reports why
 * and keeps its cursor, so the next tick reads it again.
 *
 * See docs/architecture/sidecar-connections.md.
 */

import { join } from "node:path";
import { exec as llmExec, resolveLayout, type ExecOptions, type ExecResult } from "@n-dx/llm-client";
import { errorMessage } from "../response-utils.js";
import { resolveStore, type PRDItem } from "../rex-gateway.js";
import { readDiagnosis } from "../run-diagnosis.js";
import { isHardFailure, isReviewGateRefusal, readRunRecords, type RunLike } from "../stuck-tasks.js";
import { readEventCursors, sinceSeen, sinceWatermark, writeEventCursors, type EventCursors, type Observation } from "./event-cursors.js";
import { ownerOfFiles, readCodeowners, type CodeownersRule } from "./codeowners.js";
import { itemLinkRefs, type LinkFields } from "./link-refs.js";
import type { TrackerEventRecord } from "./rules.js";
import type { FactSource, TrackerEvent } from "./server-profiles.js";

/** Runs one command: the llm-client `exec` in production, a stub in tests. */
export type TrackerEventExec = (cmd: string, args: string[], opts: ExecOptions) => Promise<ExecResult>;

/** The events collected here; `change-captured` is raised where a change is captured, not read back. */
export const COLLECTED_EVENTS = ["run-started", "run-failed-twice", "pr-opened", "pr-merged", "release-published"] as const satisfies readonly TrackerEvent[];

export interface CollectOptions {
  projectDir: string;
  rexDir: string;
  /** The events whose rule is not off; no other source is read, and no other cursor moves. */
  events: readonly TrackerEvent[];
  /** The project's `web.sidecarGithubReads`: off, no gh command runs. */
  githubReads: boolean;
  exec?: TrackerEventExec;
}

export interface CollectedEvents {
  /** The new events, oldest source first, one per event and item. */
  records: TrackerEventRecord[];
  /** Why a source was not read this time. */
  problems: string[];
}

/** PRs gh is asked for, most recently updated first: enough for five minutes of any repository. */
export const PR_PAGE_SIZE = 50;
const EXEC_TIMEOUT_MS = 20_000;
/** gh and git must never stop to ask; a missing login is an answer, not a prompt. */
const NO_PROMPT_ENV = { GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" };

/** One event about one item, before it is resolved to the item a link is on. */
interface Candidate {
  event: TrackerEvent;
  itemId: string;
  sources?: Partial<Record<FactSource, string>>;
  diagnosis?: TrackerEventRecord["diagnosis"];
}

type SourceRead = { candidates: Candidate[]; cursors: EventCursors } | { problem: string };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string" && value !== "";

/** `value` as ms since the epoch, or null when it is not a date. */
function timeOf(value: unknown): number | null {
  if (!isString(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

// ── Runs ─────────────────────────────────────────────────────────────

interface RunSeen extends Observation {
  taskId: string;
  run: RunLike;
}

/** `runs` with an id, a task and a time at `field`, as observations. */
function runsAt(runs: readonly RunLike[], field: "startedAt" | "finishedAt"): RunSeen[] {
  return runs.flatMap((run) => {
    const at = timeOf(run[field]);
    return isString(run.id) && isString(run.taskId) && at !== null ? [{ key: run.id, at, taskId: run.taskId, run }] : [];
  });
}

function readRunsStarted(runs: readonly RunLike[], cursors: EventCursors): SourceRead {
  const { fresh, next } = sinceWatermark(runsAt(runs, "startedAt"), cursors["run-started"]);
  return {
    candidates: fresh.sort((a, b) => a.at - b.at).map((r) => ({ event: "run-started", itemId: r.taskId })),
    cursors: { "run-started": next },
  };
}

/** How many hard failures in a row `run` ends for its task, counting back over the task's finished runs. */
function failureStreak(run: RunSeen, finished: readonly RunSeen[]): number {
  const history = finished
    .filter((r) => r.taskId === run.taskId && r.at <= run.at && !isReviewGateRefusal(r.run))
    .sort((a, b) => b.at - a.at);
  let streak = 0;
  for (const r of history.slice(history.findIndex((h) => h.key === run.key))) {
    if (!isHardFailure(r.run)) break;
    streak++;
  }
  return streak;
}

function readRunsFailedTwice(runs: readonly RunLike[], cursors: EventCursors): SourceRead {
  const finished = runsAt(runs, "finishedAt");
  const failures = finished.filter((r) => isHardFailure(r.run) && !isReviewGateRefusal(r.run));
  const { fresh, next } = sinceWatermark(failures, cursors["run-failed-twice"]);
  const candidates = fresh
    .sort((a, b) => a.at - b.at)
    // The second failure in a row is the event; a third is the same block, not a new one.
    .filter((r) => failureStreak(r, finished) === 2)
    .map((r): Candidate => {
      const diagnosis = readDiagnosis(r.run.diagnosis);
      return { event: "run-failed-twice", itemId: r.taskId, ...(diagnosis && { diagnosis: { summary: diagnosis.summary, ...(diagnosis.actions[0] && { unblock: diagnosis.actions[0].label }) } }) };
    });
  return { candidates, cursors: { "run-failed-twice": next } };
}

// ── PRs ──────────────────────────────────────────────────────────────

const ITEM_TRAILER = /^N-DX-Item:[ \t]*(\S+)[ \t]*$/gim;

/**
 * The item ids `text`'s `N-DX-Item` trailers name. An older trailer carries a
 * dashboard permalink; its last path segment is the id.
 */
export function itemTrailerIds(text: string): string[] {
  const ids = [...text.matchAll(ITEM_TRAILER)].map(([, value]) => {
    if (!/^https?:\/\//.test(value)) return value;
    const path = value.split(/[?#]/)[0].replace(/\/+$/, "");
    return path.slice(path.lastIndexOf("/") + 1);
  });
  return [...new Set(ids.filter((id) => id !== ""))];
}

interface PrSeen extends Observation {
  url: string;
  itemIds: string[];
  /** The first owner CODEOWNERS names for the PR's files. */
  owner?: string;
}

/** The first line a command said on a failure, or how it ended. */
function said(result: ExecResult, cmd: string): string {
  if (!result.launched) return `${cmd} is not installed`;
  return result.stderr.trim().split("\n")[0] || `${cmd} exited ${result.exitCode ?? "on a timeout"}`;
}

async function readPrs(exec: TrackerEventExec, projectDir: string): Promise<{ prs: Record<string, unknown>[] } | { problem: string }> {
  const result = await exec(
    "gh",
    ["pr", "list", "--state", "all", "--search", "sort:updated-desc", "--limit", String(PR_PAGE_SIZE), "--json", "number,url,createdAt,mergedAt,body,commits,files"],
    { cwd: projectDir, timeout: EXEC_TIMEOUT_MS, env: { ...process.env, ...NO_PROMPT_ENV } },
  );
  if (!result.launched || result.error || result.exitCode !== 0) return { problem: `gh pr list answered: ${said(result, "gh")}` };
  let body: unknown;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    return { problem: "gh pr list returned output that is not JSON" };
  }
  if (!Array.isArray(body)) return { problem: "gh pr list returned JSON that is not a list" };
  return { prs: body.filter(isRecord) };
}

/** A PR's trailers: its description's and every commit message's. */
function prItemIds(pr: Record<string, unknown>): string[] {
  const commits = Array.isArray(pr.commits) ? pr.commits.filter(isRecord) : [];
  const texts = [pr.body, ...commits.map((c) => c.messageBody)].filter(isString);
  return [...new Set(texts.flatMap(itemTrailerIds))];
}

/** The first owner of the PR's changed files, from the project's CODEOWNERS. */
function prOwner(pr: Record<string, unknown>, rules: readonly CodeownersRule[]): string | undefined {
  const files = Array.isArray(pr.files) ? pr.files.filter(isRecord).map((f) => f.path).filter(isString) : [];
  return ownerOfFiles(rules, files);
}

function prsAt(prs: readonly Record<string, unknown>[], field: "createdAt" | "mergedAt", rules: readonly CodeownersRule[]): PrSeen[] {
  return prs.flatMap((pr) => {
    const at = timeOf(pr[field]);
    const itemIds = prItemIds(pr);
    if (typeof pr.number !== "number" || at === null || itemIds.length === 0) return [];
    const owner = prOwner(pr, rules);
    return [{ key: String(pr.number), at, url: isString(pr.url) ? pr.url : "", itemIds, ...(owner && { owner }) }];
  });
}

function prCandidates(event: "pr-opened" | "pr-merged", fresh: PrSeen[]): Candidate[] {
  return fresh
    .sort((a, b) => a.at - b.at)
    .flatMap((pr) => {
      const sources: Candidate["sources"] = { ...(pr.url && { "pr-url": pr.url }), ...(pr.owner && { codeowners: pr.owner }) };
      return pr.itemIds.map((itemId): Candidate => ({ event, itemId, ...(Object.keys(sources).length > 0 && { sources }) }));
    });
}

async function readPrEvents(
  events: ReadonlySet<TrackerEvent>,
  options: CollectOptions,
  exec: TrackerEventExec,
  cursors: EventCursors,
): Promise<SourceRead> {
  if (!options.githubReads) return { problem: "GitHub reads are off for this project (web.sidecarGithubReads), so no PR was read" };
  const read = await readPrs(exec, options.projectDir);
  if ("problem" in read) return read;
  const candidates: Candidate[] = [];
  const next: EventCursors = {};
  const rules = readCodeowners(options.projectDir);
  for (const [event, field] of [["pr-opened", "createdAt"], ["pr-merged", "mergedAt"]] as const) {
    if (!events.has(event)) continue;
    const { fresh, next: cursor } = sinceWatermark(prsAt(read.prs, field, rules), cursors[event]);
    candidates.push(...prCandidates(event, fresh));
    next[event] = cursor;
  }
  return { candidates, cursors: next };
}

// ── Releases ─────────────────────────────────────────────────────────

const TAG_VERSION = /(?:^v|@)(\d+\.\d+\.\d+)$/;

/** The release versions git's tags name: `v1.2.3` or `<package>@1.2.3`. */
export function tagVersions(tags: readonly string[]): Set<string> {
  return new Set(tags.flatMap((tag) => TAG_VERSION.exec(tag.trim())?.[1] ?? []));
}

async function readReleases(
  exec: TrackerEventExec,
  projectDir: string,
  items: ReadonlyMap<string, IndexedItem>,
  cursors: EventCursors,
): Promise<SourceRead> {
  const result = await exec("git", ["tag", "--list"], { cwd: projectDir, timeout: EXEC_TIMEOUT_MS, env: { ...process.env, ...NO_PROMPT_ENV } });
  if (!result.launched || result.error || result.exitCode !== 0) return { problem: `git tag answered: ${said(result, "git")}` };
  const versions = tagVersions(result.stdout.split("\n"));
  const shipped = new Map<string, { itemId: string; version: string }>();
  for (const { item } of items.values()) {
    const version = (item as { shippedIn?: unknown }).shippedIn;
    if (isString(version) && versions.has(version)) shipped.set(`${version}:${item.id}`, { itemId: item.id, version });
  }
  const { fresh, next } = sinceSeen([...shipped.keys()], cursors["release-published"]);
  return {
    candidates: fresh.map((key): Candidate => {
      const { itemId, version } = shipped.get(key)!;
      return { event: "release-published", itemId, sources: { release: version } };
    }),
    cursors: { "release-published": next },
  };
}

// ── Collection ───────────────────────────────────────────────────────

interface IndexedItem {
  item: PRDItem;
  parentId: string | null;
}

function indexItems(items: readonly PRDItem[]): Map<string, IndexedItem> {
  const index = new Map<string, IndexedItem>();
  const stack = items.map((item) => ({ item, parentId: null as string | null }));
  while (stack.length > 0) {
    const entry = stack.pop()!;
    index.set(entry.item.id, entry);
    for (const child of entry.item.children ?? []) stack.push({ item: child, parentId: entry.item.id });
  }
  return index;
}

/** The item nearest `itemId` (itself, then its parents) that links to a work item, with its first ref. */
function linkedItem(items: ReadonlyMap<string, IndexedItem>, itemId: string): { rexId: string; ref: string } | null {
  for (let entry = items.get(itemId); entry; entry = entry.parentId ? items.get(entry.parentId) : undefined) {
    const refs = itemLinkRefs(entry.item as PRDItem & LinkFields);
    if (refs.length > 0) return { rexId: entry.item.id, ref: refs[0] };
  }
  return null;
}

/** Each project's collection in progress; the next waits for it, so two ticks never read one cursor twice. */
const collecting = new Map<string, Promise<CollectedEvents>>();

/**
 * Read every source whose event is in `options.events` since its cursor,
 * save the cursors, and return the new events.
 */
export function collectTrackerEvents(options: CollectOptions): Promise<CollectedEvents> {
  const { projectDir } = options;
  const prior = collecting.get(projectDir);
  const run = prior ? prior.then(() => collectOnce(options), () => collectOnce(options)) : collectOnce(options);
  collecting.set(projectDir, run);
  const forget = () => {
    if (collecting.get(projectDir) === run) collecting.delete(projectDir);
  };
  run.then(forget, forget);
  return run;
}

async function collectOnce(options: CollectOptions): Promise<CollectedEvents> {
  const events = new Set(options.events.filter((e) => (COLLECTED_EVENTS as readonly string[]).includes(e)));
  if (events.size === 0) return { records: [], problems: [] };
  const exec = options.exec ?? llmExec;

  let items: Map<string, IndexedItem>;
  try {
    items = indexItems((await (await resolveStore(options.rexDir)).loadDocument()).items);
  } catch (err) {
    return { records: [], problems: [`the PRD could not be read: ${errorMessage(err)}`] };
  }

  const cursors = readEventCursors(options.projectDir);
  const reads: SourceRead[] = [];
  if (events.has("run-started") || events.has("run-failed-twice")) {
    const runs = await readRunRecords(join(resolveLayout(options.projectDir).henchDir, "runs"));
    if (events.has("run-started")) reads.push(readRunsStarted(runs, cursors));
    if (events.has("run-failed-twice")) reads.push(readRunsFailedTwice(runs, cursors));
  }
  if (events.has("pr-opened") || events.has("pr-merged")) reads.push(await readPrEvents(events, options, exec, cursors));
  if (events.has("release-published")) reads.push(await readReleases(exec, options.projectDir, items, cursors));

  const problems: string[] = [];
  const records: TrackerEventRecord[] = [];
  const queued = new Set<string>();
  let next = cursors;
  for (const read of reads) {
    if ("problem" in read) {
      problems.push(read.problem);
      continue;
    }
    next = { ...next, ...read.cursors };
    for (const candidate of read.candidates) {
      const linked = linkedItem(items, candidate.itemId);
      if (!linked || queued.has(`${candidate.event}:${linked.rexId}`)) continue;
      queued.add(`${candidate.event}:${linked.rexId}`);
      records.push({ event: candidate.event, rexId: linked.rexId, ref: linked.ref, ...(candidate.sources && { sources: candidate.sources }),
        ...(candidate.diagnosis && { diagnosis: candidate.diagnosis }),
      });
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(cursors)) writeEventCursors(options.projectDir, next);
  return { records, problems };
}
