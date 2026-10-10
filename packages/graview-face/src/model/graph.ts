/**
 * READ MODELS: the small sums and walks the rule language stops short of,
 * written once here and read by the screens. Everything is a pure function
 * of the store, so a page cannot say a number another page disagrees with.
 */
import { isCurrent, labelOf, readableFields, type AnySchema, type Store } from "@graview/core";

export type Node = { readonly id: string; readonly kind: string } & Record<string, unknown>;
export type Reader = Store<AnySchema>;

export const OPEN = new Set(["pending", "in_progress", "failing", "blocked", "deferred"]);
export const CLOSED = new Set(["completed", "cancelled", "deleted"]);

export function nodesOf(store: Reader, kind: string): readonly Node[] {
  return store.graph.nodesOfKind(kind as never) as unknown as readonly Node[];
}

export function node(store: Reader, id: string): Node | undefined {
  return store.graph.getNode(id) as Node | undefined;
}

export function out(store: Reader, id: string, edge: string): readonly Node[] {
  return store.graph.out(id, edge) as unknown as readonly Node[];
}

export function inward(store: Reader, id: string, edge: string): readonly Node[] {
  return store.graph.in(id, edge) as unknown as readonly Node[];
}

export function label(store: Reader, n: Node): string {
  return labelOf(store.schema.tryDefinition(n.kind), n as never);
}

export function current(store: Reader, n: Node): boolean {
  return isCurrent(store.schema.tryDefinition(n.kind), n as never);
}

/** What a glance at the record says: the kind's `glance` fields, said in the declaration's words. */
export function glance(store: Reader, n: Node, limit = 3): readonly { key: string; label: string; value: string }[] {
  return readableFields(n as never, store.schema.tryDefinition(n.kind), { limit, glance: true, said: [label(store, n)] }) as readonly {
    key: string;
    label: string;
    value: string;
  }[];
}

export function isOpen(n: Node): boolean {
  return typeof n.status === "string" ? OPEN.has(n.status) : true;
}

export const plural = (store: Reader, kind: string): string => store.schema.tryDefinition(kind)?.plural ?? `${kind}s`;
export const noun = (store: Reader, kind: string): string => store.schema.tryDefinition(kind)?.noun ?? kind;

export function count(store: Reader, kind: string, where: (n: Node) => boolean = () => true): number {
  return nodesOf(store, kind).filter(where).length;
}

export function sum(nodes: readonly Node[], field: string): number {
  return nodes.reduce((total, n) => total + (typeof n[field] === "number" ? (n[field] as number) : 0), 0);
}

export function byField<T extends string>(nodes: readonly Node[], field: string): Map<T, Node[]> {
  const groups = new Map<T, Node[]>();
  for (const n of nodes) {
    const key = (typeof n[field] === "string" ? n[field] : "—") as T;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
  }
  return groups;
}

export function compare(a: string | undefined, b: string | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { numeric: true });
}

export const PRIORITY_ORDER = ["critical", "high", "medium", "low"];
export const STATUS_ORDER = ["in_progress", "blocked", "failing", "pending", "deferred", "completed", "cancelled", "deleted"];

export function byChoice(order: readonly string[], field: string) {
  return (a: Node, b: Node): number => {
    const ia = order.indexOf(String(a[field] ?? ""));
    const ib = order.indexOf(String(b[field] ?? ""));
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
