/**
 * Migration contract: plan, then review, then apply.
 *
 * Migration code runs once per schema change and is deleted as a unit, so it
 * lives here rather than in `core/`. Each migration has its own folder
 * (`v1-to-v2/`) and an entry in `./registry.ts`.
 *
 * A migration plans from a **source adapter**, not from a tree type, so the
 * same pipeline and plan file serve a v1 PRD tree, a codebase map or a tracker
 * import. Planning (`./pipeline.ts`) runs the migration's rules, then an
 * optional text pass, then an optional Jev pass; each model pass calls its
 * injected seam and never a client directly. The plan is written as a plan
 * file (`./plan-file.ts`) for review. `apply` is a slot: nothing fills it yet.
 *
 * @module migrations/migration
 */

import { createHash } from "node:crypto";
import type { ModelPassName, PlanFile } from "./plan-file.js";

// ── Source ───────────────────────────────────────────────────────

/** One unit of the source, the key of its plan entry. */
export interface SourceItem {
  id: string;
  /** Changes exactly when the item's content changes: a recorded answer is reused only while it holds. */
  hash: string;
}

export interface SourceRead<TData> {
  /** What the rules read. */
  data: TData;
  /** Every item, in source order. Ids are unique. */
  items: readonly SourceItem[];
}

export interface MigrationSource<TData> {
  /** Names the adapter in the plan header (`rex-v1-tree`). */
  readonly kind: string;
  read(): SourceRead<TData> | Promise<SourceRead<TData>>;
}

// ── Passes ───────────────────────────────────────────────────────

export interface RulesResult<TEntry, TSummary> {
  entries: Record<string, TEntry>;
  summary: TSummary;
}

export interface ModelQuestion {
  /** Source item the question is about; its entry receives the answer. */
  id: string;
  /** JSON-serialisable; part of the recorded answer's hash. */
  question: unknown;
}

/** The seam a model pass calls. Injected, so tests and callers choose the client. */
export interface PassSeam {
  /** Recorded in the plan header and with each answer. */
  model: string;
  /** Returns a JSON-serialisable answer. */
  ask(question: ModelQuestion): Promise<unknown>;
}

export interface ModelPass<TData, TEntry> {
  /** Questions to ask, at most one per item, from the entries so far. */
  questions(entries: Readonly<Record<string, TEntry>>, data: TData): ModelQuestion[];
  /** The entry with an answer folded in. */
  merge(entry: TEntry, answer: unknown): TEntry;
}

export interface PlanContext<TOptions = undefined> {
  /** ISO time the plan is cut: the plan's only clock. */
  cutAt: string;
  /** A model pass runs only when the migration defines it and its seam is here. */
  seams?: Partial<Record<ModelPassName, PassSeam>>;
  /** An earlier plan of the same migration: its answers are reused where they still hold. */
  previous?: PlanFile;
  /** Migration-specific inputs. */
  options?: TOptions;
}

// ── Migration ────────────────────────────────────────────────────

export interface MigrationDefinition<TData, TEntry, TSummary, TOptions = undefined> {
  /** Registry id, written in the plan header. */
  id: string;
  /** Schema versions moved between. */
  from: string;
  to: string;
  /** Deterministic: same data and context, same result. */
  rules(data: TData, context: PlanContext<TOptions>): RulesResult<TEntry, TSummary>;
  passes?: Partial<Record<ModelPassName, ModelPass<TData, TEntry>>>;
}

/** Applies a reviewed plan. A slot for the apply command; no migration fills it yet. */
export type ApplyPlan<TEntry, TSummary> = (plan: PlanFile<TEntry, TSummary>) => Promise<void>;

export interface Migration<TData, TEntry, TSummary, TOptions = undefined> {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  plan(source: MigrationSource<TData>, context: PlanContext<TOptions>): Promise<PlanFile<TEntry, TSummary>>;
  readonly apply?: ApplyPlan<TEntry, TSummary>;
}

// ── Hashing ──────────────────────────────────────────────────────

/** JSON with object keys sorted at every depth; `undefined` members dropped as JSON drops them. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : stableJson(v))).join(",")}]`;
  const members = Object.keys(value)
    .sort()
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`);
  return `{${members.join(",")}}`;
}

/** sha256 hex of a value's {@link stableJson}: key order never changes it. */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
