/**
 * READ MODELS: the small sums and walks the rule language stops short of,
 * written once here and read by the screens. Everything is a pure function
 * of the store, so a page cannot say a number another page disagrees with.
 *
 * The store is read through the document's own types (`types.ts`, written by
 * `graview types` from n-dx.graview.json — `pnpm types` refreshes it), so a
 * kind, a field or a relation renamed in the declaration fails `tsc` here
 * instead of drawing a blank section.
 */
import { isCurrent, labelOf, readableFields, type AnySchema, type Store } from "@graview/core";
import { typedReader } from "@graview/core/typed";
import type { AnyRecord, Edges, Kinds, Types } from "./types.js";

export type Node = AnyRecord;
export type Kind = keyof Kinds & string;
export type Of<K extends Kind> = Kinds[K];
/** Every relation some kind declares. */
export type Edge = { [K in keyof Edges]: keyof Edges[K] & string }[keyof Edges];
export type Reader = Store<AnySchema>;

const read = (store: Reader) => typedReader<Types>(store);

/** A kind name the compiled schema lists is one the document declares: the schema and `types.ts` come from the one file. */
export const asKind = (name: string): Kind => name as Kind;

export const OPEN = new Set<string>(["pending", "in_progress", "failing", "blocked", "deferred"]);
export const CLOSED = new Set<string>(["completed", "cancelled", "deleted"]);

export function nodesOf<K extends Kind>(store: Reader, kind: K): readonly Of<K>[] {
  return read(store).nodes(kind);
}

export function node(store: Reader, id: string): Node | undefined {
  return read(store).node(id);
}

export function nodeOf<K extends Kind>(store: Reader, id: string, kind: K): Of<K> | undefined {
  return read(store).node(id, kind);
}

/** The records a relation reaches from a record, by id: for a walk that only has the id. */
export function out(store: Reader, id: string, edge: Edge): readonly Node[] {
  return store.graph.out(id, edge) as unknown as readonly Node[];
}

/** The records that reach a record by a relation, by id. */
export function inward(store: Reader, id: string, edge: Edge): readonly Node[] {
  return store.graph.in(id, edge) as unknown as readonly Node[];
}

/** The records a relation the record's kind declares reaches, typed by the kinds it points at. */
export function edgesOf<N extends Node, E extends keyof Edges[N["kind"]] & string>(store: Reader, n: N, edge: E) {
  return read(store).edgesOf(n, edge as never) as unknown as readonly Of<Extract<Edges[N["kind"]][E], Kind>>[];
}

/** The records that reach this one by a relation some kind declares toward its kind. */
export function inwardOf<N extends Node, E extends Edge>(store: Reader, n: N, edge: E) {
  return read(store).inwardOf(n, edge as never) as unknown as readonly Of<{ [K in Kind]: E extends keyof Edges[K] ? (N["kind"] extends Edges[K][E] ? K : never) : never }[Kind]>[];
}

export function label(store: Reader, n: Node): string {
  return labelOf(store.schema.tryDefinition(n.kind), n as never);
}

export function current(store: Reader, n: Node): boolean {
  return isCurrent(store.schema.tryDefinition(n.kind), n as never);
}

/** A field by the name the schema gives it at run time — a glance key, a page group — where no declared type names it. */
export function raw(n: Node, key: string): unknown {
  return (n as unknown as Record<string, unknown>)[key];
}

/** What a glance at the record says: the kind's `glance` fields, said in the declaration's words. */
export function glance(store: Reader, n: Node, limit = 3): readonly { key: string; label: string; value: string }[] {
  return readableFields(n as never, store.schema.tryDefinition(n.kind), { limit, glance: true, said: [label(store, n)] }) as readonly {
    key: string;
    label: string;
    value: string;
  }[];
}

/** The record's status, for the kinds that have one. */
export function statusOf(n: Node): string | undefined {
  return "status" in n ? n.status : undefined;
}

export function isOpen(n: Node): boolean {
  const status = statusOf(n);
  return status === undefined ? true : OPEN.has(status);
}

export const plural = (store: Reader, kind: string): string => store.schema.tryDefinition(kind)?.plural ?? `${kind}s`;
export const noun = (store: Reader, kind: string): string => store.schema.tryDefinition(kind)?.noun ?? kind;

export function count<K extends Kind>(store: Reader, kind: K, where?: (n: Of<K>) => boolean): number {
  // The graph keeps a tally per kind (Graph.count, 0.1.24); a walk is only for a narrowed count.
  if (!where) return store.graph.count(kind);
  return nodesOf(store, kind).filter(where).length;
}

export function sum<N>(nodes: readonly N[], of: (n: N) => number | undefined): number {
  return nodes.reduce((total, n) => total + (of(n) ?? 0), 0);
}

export function byField<N, T extends string>(nodes: readonly N[], of: (n: N) => T | undefined): Map<T, N[]> {
  const groups = new Map<T, N[]>();
  for (const n of nodes) {
    const key = of(n) ?? ("—" as T);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
  }
  return groups;
}

export function compare(a: string | undefined, b: string | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { numeric: true });
}

export const PRIORITY_ORDER = ["critical", "high", "medium", "low"];
export const STATUS_ORDER = ["in_progress", "blocked", "failing", "pending", "deferred", "completed", "cancelled", "deleted"];

export function byChoice<N>(order: readonly string[], of: (n: N) => string | undefined) {
  return (a: N, b: N): number => {
    const ia = order.indexOf(of(a) ?? "");
    const ib = order.indexOf(of(b) ?? "");
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
  };
}

/** A status word in n-dx's voice. */
export function said(status: unknown): string {
  const words: Record<string, string> = {
    in_progress: "in progress",
    budget_exceeded: "over budget",
    error_transient: "transient error",
    pending: "pending",
    completed: "done",
    met: "met",
    proposed: "proposed",
    changing: "changing",
    revised: "revised",
    retired: "retired",
    defective: "defective",
    ok: "ok",
  };
  const key = String(status ?? "");
  return words[key] ?? key.replace(/[_-]+/g, " ");
}

export type Tone = "good" | "warn" | "bad" | "accent" | "neutral";

export function toneOfStatus(status: unknown): Tone {
  switch (status) {
    case "completed":
    case "met":
    case "ok":
      return "good";
    case "blocked":
    case "failing":
    case "failed":
    case "timeout":
    case "budget_exceeded":
    case "error_transient":
    case "defective":
      return "bad";
    case "in_progress":
    case "running":
    case "changing":
      return "accent";
    case "deferred":
    case "revised":
    case "cancelled":
      return "warn";
    default:
      return "neutral";
  }
}

export function when(iso: unknown): string {
  if (typeof iso !== "string" || iso.length < 10) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const days = Math.round((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function tokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString();
}
