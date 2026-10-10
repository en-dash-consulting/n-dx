import { byChoice, inward, isOpen, nodesOf, PRIORITY_ORDER, STATUS_ORDER, type Node, type Reader } from "./graph.js";

export interface Attention {
  readonly inbox: readonly Node[];
  readonly blocked: readonly Node[];
  readonly failing: readonly Node[];
  readonly defective: readonly Node[];
  readonly total: number;
}

/** What needs a person: the Inbox, blocked and failing work, defective capabilities. */
export function attention(store: Reader): Attention {
  const changes = nodesOf(store, "change");
  const tasks = nodesOf(store, "task");
  const inbox = changes.filter((c) => c.inbox === true).sort(byChoice(PRIORITY_ORDER, "priority"));
  const blocked = [...changes, ...tasks].filter((n) => n.status === "blocked");
  const failing = [...changes, ...tasks].filter((n) => n.status === "failing");
  const defective = nodesOf(store, "capability").filter((c) => c.health === "defective");
  return { inbox, blocked, failing, defective, total: inbox.length + blocked.length + failing.length + defective.length };
}

export interface Standing {
  readonly capabilities: number;
  readonly met: number;
  readonly open: number;
  readonly inProgress: number;
  readonly areas: number;
}

export function standing(store: Reader): Standing {
  const capabilities = nodesOf(store, "capability");
  const changes = nodesOf(store, "change");
  return {
    capabilities: capabilities.length,
    met: capabilities.filter((c) => c.intentStatus === "met").length,
    open: changes.filter(isOpen).length,
    inProgress: changes.filter((c) => c.status === "in_progress").length,
    areas: nodesOf(store, "area").length,
  };
}

/** The changes list's order: open first by status, then priority, then title. */
export function orderChanges(changes: readonly Node[]): Node[] {
  const status = byChoice(STATUS_ORDER, "status");
  const priority = byChoice(PRIORITY_ORDER, "priority");
  return [...changes].sort((a, b) => status(a, b) || priority(a, b) || String(a.title ?? "").localeCompare(String(b.title ?? ""), undefined, { numeric: true }));
}

/** Everything under a change, flattened: tasks, their subtasks, nested changes. */
export function workUnder(store: Reader, id: string): readonly Node[] {
  const seen = new Set<string>();
  const out: Node[] = [];
  const walk = (parent: string) => {
    for (const child of inward(store, parent, "under")) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

export function runsFor(store: Reader, id: string): readonly Node[] {
  return [...inward(store, id, "ranFor")].sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")));
}
