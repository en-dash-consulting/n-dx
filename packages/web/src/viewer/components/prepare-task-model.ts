/**
 * The Prepare task modal's state, as pure functions — no Preact.
 *
 * The modal shows what `GET /api/hench/prep/:taskId` reports (hench's own
 * defaults and where each came from) and lets the reader change fields for one
 * run. Everything derived from that pair lives here: which fields changed, the
 * options an execute sends (only the changed ones), the refusals still
 * standing, and the equivalent `ndx work` command line — built with the same
 * `workCommandArgs` the server spawns, so the copied command is the run.
 *
 * The dashboard never re-derives a default. A field's default is the resolve
 * JSON's `value` and its label is the resolve JSON's `source`.
 *
 * @see packages/web/src/server/routes-hench-prep.ts
 * @see packages/web/src/shared/run-options.ts
 */

import { checkRunOptions, workCommandArgs } from "../external.js";
import type { HubMemoryPressure, RunOptionKey, RunOptions } from "../external.js";

/** One resolved setting and the config key (or rule) that supplied it. */
export interface PrepResolved<T> {
  value: T;
  source: string;
  /**
   * What this setting would be without the task's saved block — this
   * project's own default. Present only when a saved value is what won (its
   * `source` starts with `task.run`), so the modal can show "project default:
   * X from llm.model" beside it and know what Save would change. Absent from a
   * hench that predates it.
   */
  fallback?: { value: T; source: string };
}

export interface PrepRefusal {
  code: string;
  message: string;
  hint?: string;
  /** tree-not-conformant only: whether `rex migrate-slugs` fixes it. */
  migratable?: boolean;
}

/** A condition shown before a run that does not stop it. */
export interface PrepWarning {
  code: string;
  message: string;
}

/**
 * A task's saved `run` block, as rex stores and validates it.
 *
 * Deliberately not `RunOptions`: a saved block is vendor-agnostic, so model
 * intent is a portable `tier` plus optional exact pins per vendor, where one
 * launch's options carry a single model id. Keys are open here because the
 * viewer only displays them — rex owns the schema.
 */
export type PrepSavedSettings = Record<string, unknown>;

export interface PrepResolvedSettings {
  vendor: PrepResolved<string>;
  model: PrepResolved<string>;
  provider: PrepResolved<string>;
  permissionMode: PrepResolved<string | null>;
  review: PrepResolved<boolean>;
  /** `vendorDefault` is the vendor's built-in reviewer, the target of the modal's "Vendor default" choice. */
  reviewModel: PrepResolved<string> & { vendorDefault: string };
  reviewOptional: PrepResolved<boolean>;
  skipTestGate: PrepResolved<boolean>;
  maxTurns: PrepResolved<number>;
  tokenBudget: PrepResolved<number>;
  fresh: PrepResolved<boolean>;
  allowDirty: PrepResolved<boolean>;
}

/** `GET /api/hench/prep/:taskId`, as the modal reads it. */
export interface PrepResponse {
  task: { id: string; title: string; status: string; level: string } | null;
  workspace: {
    key: string | null;
    root: string;
    branch: string | null;
    isAnchor: boolean;
    dirty: boolean;
    liveRun: boolean;
  };
  /**
   * The task's own saved run settings, or null when it carries none. Absent
   * from a hench that predates them.
   */
  saved?: PrepSavedSettings | null;
  /**
   * A fingerprint of {@link saved}, which a save must send back so the server
   * can tell "unchanged since I loaded it" from "someone else saved in
   * between". `"none"` for a task carrying nothing — a real value to hold, not
   * an absence. Absent from a server that predates saving.
   */
  savedVersion?: string;
  resolved: PrepResolvedSettings;
  options: Array<{ key: string; values?: readonly string[] }>;
  refusals: PrepRefusal[];
  /** Absent from a hench that predates warnings. */
  warnings?: PrepWarning[];
  dir: string;
  detail: { priority: string | null; parentChain: string[]; criteriaCount: number } | null;
  catalog: { vendor: string; models: string[]; providers: string[] } | null;
  admission: {
    running: number;
    max: number;
    queued: number;
    availableBytes: number | null;
    pressure: HubMemoryPressure;
    memoryPaused: boolean;
  } | null;
  recommendation: unknown;
}

/** Fields the reader changed for this run, each differing from its default. */
export type PrepEdits = Partial<RunOptions>;

/** The value each editable field starts at: hench's resolved value. `""` stands for "not set". */
export interface PrepDefaults {
  model: string;
  provider: string;
  permissionMode: string;
  review: boolean;
  reviewModel: string;
  reviewOptional: boolean;
  skipTestGate: boolean;
  maxTurns: number;
  tokenBudget: number;
  fresh: boolean;
  allowDirty: boolean;
  contextNotes: string;
}

export function defaultsOf(prep: PrepResponse): PrepDefaults {
  const r = prep.resolved;
  return {
    model: r.model.value,
    provider: r.provider.value,
    permissionMode: r.permissionMode.value ?? "",
    review: r.review.value,
    reviewModel: r.reviewModel.value,
    reviewOptional: r.reviewOptional.value,
    skipTestGate: r.skipTestGate.value,
    maxTurns: r.maxTurns.value,
    tokenBudget: r.tokenBudget.value,
    fresh: r.fresh.value,
    allowDirty: r.allowDirty.value,
    contextNotes: "",
  };
}

/** Where a field's default came from, as the resolve JSON names it. Notes have no default. */
export function sourceOf(prep: PrepResponse, key: RunOptionKey): string | null {
  if (key === "contextNotes") return null;
  return prep.resolved[key].source;
}

/** The value a field shows: the reader's edit, else the default. */
export function effective<K extends keyof PrepDefaults>(defaults: PrepDefaults, edits: PrepEdits, key: K): PrepDefaults[K] {
  const edited = edits[key as RunOptionKey];
  return (edited === undefined ? defaults[key] : edited) as PrepDefaults[K];
}

/**
 * Set one field. A value equal to the default (or an empty string) clears
 * the edit, so a field put back by hand stops counting as changed.
 */
export function setField(defaults: PrepDefaults, edits: PrepEdits, key: RunOptionKey, value: unknown): PrepEdits {
  const next: Record<string, unknown> = { ...edits };
  if (value === defaults[key] || value === "" || value === undefined) delete next[key];
  else next[key] = value;
  return next as PrepEdits;
}

export function resetField(edits: PrepEdits, key: RunOptionKey): PrepEdits {
  const next = { ...edits };
  delete next[key];
  return next;
}

export function isChanged(edits: PrepEdits, key: RunOptionKey): boolean {
  return edits[key] !== undefined;
}

/** Max turns is an API-provider limit; a CLI run ignores it. */
export function maxTurnsApplies(defaults: PrepDefaults, edits: PrepEdits): boolean {
  return effective(defaults, edits, "provider") !== "cli";
}

/**
 * The options an execute sends: the changed fields only, minus edits the
 * current state makes meaningless — a review model with review off, max turns
 * on a CLI run, a `false` that no flag can express.
 */
export function runOptionsOf(defaults: PrepDefaults, edits: PrepEdits): RunOptions {
  const options: Record<string, unknown> = { ...edits };
  if (effective(defaults, edits, "review") !== true) {
    delete options.reviewModel;
    delete options.reviewOptional;
  } else if (options.reviewModel !== undefined) options.review = true;
  if (!maxTurnsApplies(defaults, edits)) delete options.maxTurns;
  for (const [key, value] of Object.entries(options)) if (value === false) delete options[key];
  return options as RunOptions;
}

/** Changed fields that still reach the run — the footer's "N changes". */
export function changeCount(defaults: PrepDefaults, edits: PrepEdits): number {
  return Object.keys(runOptionsOf(defaults, edits)).length;
}

/** A field's problem with the current edits, or null. Shape checks are the shared table's. */
export function optionsProblem(defaults: PrepDefaults, edits: PrepEdits): { key: string; error: string } | null {
  const checked = checkRunOptions(runOptionsOf(defaults, edits));
  return checked.ok ? null : { key: checked.key, error: checked.error };
}

/** Refusals still standing: allow dirty tree answers the dirty-tree one. */
export function standingRefusals(prep: PrepResponse, defaults: PrepDefaults, edits: PrepEdits): PrepRefusal[] {
  const allowDirty = effective(defaults, edits, "allowDirty");
  return prep.refusals.filter((r) => !(r.code === "dirty-tree" && allowDirty));
}

/** The workspace facts worth a warning before a run starts. */
export function workspaceWarnings(prep: PrepResponse): string[] {
  const warnings: string[] = [];
  if (prep.workspace.isAnchor) warnings.push(`Commits land on ${prep.workspace.branch ?? "the default branch"}`);
  if (prep.workspace.liveRun) {
    warnings.push("A run is already live in this worktree — two runs would share one working tree");
  }
  for (const w of prep.warnings ?? []) warnings.push(w.message);
  return warnings;
}

const GIB = 1024 ** 3;

/** The hub's admission state as one preflight line; null when not served through the hub. */
export function admissionLine(admission: PrepResponse["admission"]): { queues: boolean; text: string } | null {
  if (!admission) return null;
  const full = admission.running >= admission.max;
  const queues = admission.memoryPaused || full;
  const parts = [`${admission.running} of ${admission.max} run slots in use`];
  if (admission.queued > 0) parts.push(`${admission.queued} queued`);
  // An unknown reading admits, so it is stated plainly rather than as a warning.
  if (admission.pressure !== "unknown" && admission.availableBytes !== null) {
    parts.push(`${(admission.availableBytes / GIB).toFixed(1)} GB available, pressure ${admission.pressure}`);
  }
  const why = admission.memoryPaused ? "available memory is below the floor" : "every run slot is busy";
  return {
    queues,
    text: queues ? `Execute will queue: ${why} (${parts.join(", ")})` : `Hub: ${parts.join(", ")}`,
  };
}

/** Stands for the file the server writes notes to; only the server knows its path. */
export const CONTEXT_FILE_PLACEHOLDER = "<notes-file>";

/** Quote a word for a POSIX shell only when it needs it (hench's `shellWord`). */
export function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/** The `ndx work` words the execute would spawn for this state. */
export function commandWords(prep: PrepResponse, taskId: string, defaults: PrepDefaults, edits: PrepEdits): string[] {
  return [
    "ndx",
    ...workCommandArgs({
      taskId,
      options: runOptionsOf(defaults, edits),
      dir: prep.dir,
      contextFile: CONTEXT_FILE_PLACEHOLDER,
      // The server resets a deferred task to pending before running it.
      taskStatus: prep.task?.status,
    }),
  ];
}

/** {@link commandWords} as one shell line; the notes placeholder is quoted so the pasted line parses. */
export function commandLine(prep: PrepResponse, taskId: string, defaults: PrepDefaults, edits: PrepEdits): string {
  return commandWords(prep, taskId, defaults, edits).map(shellWord).join(" ");
}

/** The model choices: the vendor's catalog, with the current default and edit kept in. */
export function modelChoices(prep: PrepResponse, ...current: string[]): string[] {
  const models = prep.catalog?.models ?? [];
  return [...new Set([...current.filter(Boolean), ...models])];
}

/** The provider choices for the resolved vendor. */
export function providerChoices(prep: PrepResponse): string[] {
  const fromOptions = prep.options.find((o) => o.key === "provider")?.values;
  return [...(fromOptions ?? prep.catalog?.providers ?? [prep.resolved.provider.value])];
}

/** The 202 a hub answers when it queues the run instead of admitting it. */
export interface QueuedReply {
  queued: true;
  position: number;
  reason: "at-capacity" | "low-memory" | string;
  /** Worktree the hub queued it for; null for the anchor. */
  workspace?: string | null;
}

export function queuedReason(reason: string): string {
  if (reason === "low-memory") return "available memory is below the hub's floor";
  if (reason === "at-capacity") return "every run slot on this machine is busy";
  return reason;
}

/** What a surface shows in place of (or as) a task's start control. */
export type StartOffer =
  | { kind: "start"; resume: boolean }
  | { kind: "live" }
  | { kind: "blocked"; blockers: Array<{ id: string; title: string | null }> }
  | { kind: "none" };

/**
 * One rule for every surface: pending and deferred tasks start; an in-progress
 * task with no live run resumes; a task with a live run links to it (Stop lives
 * in Live); a blocked task names what it waits on; anything else offers nothing.
 */
export function startOffer(
  task: { status: string; blockedBy?: string[] },
  hasLiveRun: boolean,
  titleOf: (id: string) => string | null = () => null,
): StartOffer {
  if (hasLiveRun) return { kind: "live" };
  switch (task.status) {
    case "pending":
    case "deferred":
      return { kind: "start", resume: false };
    case "in_progress":
      return { kind: "start", resume: true };
    case "blocked":
      return { kind: "blocked", blockers: (task.blockedBy ?? []).map((id) => ({ id, title: titleOf(id) })) };
    default:
      return { kind: "none" };
  }
}
