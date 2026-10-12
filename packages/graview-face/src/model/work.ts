import { byChoice, inward, inwardOf, isOpen, nodesOf, PRIORITY_ORDER, STATUS_ORDER, type Node, type Of, type Reader } from "./graph.js";

export interface Attention {
  readonly inbox: readonly Of<"change">[];
  readonly blocked: readonly (Of<"change"> | Of<"task">)[];
  readonly failing: readonly (Of<"change"> | Of<"task">)[];
  readonly defective: readonly Of<"capability">[];
  readonly total: number;
}

/** What needs a person: the Inbox, blocked and failing work, defective capabilities. */
export function attention(store: Reader): Attention {
  const changes = nodesOf(store, "change");
  const tasks = nodesOf(store, "task");
  const inbox = changes.filter((c) => c.inbox === true).sort(byChoice(PRIORITY_ORDER, (c) => c.priority));
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
export function orderChanges(changes: readonly Of<"change">[]): Of<"change">[] {
  const status = byChoice(STATUS_ORDER, (c: Of<"change">) => c.status);
  const priority = byChoice(PRIORITY_ORDER, (c: Of<"change">) => c.priority);
  return [...changes].sort((a, b) => status(a, b) || priority(a, b) || a.title.localeCompare(b.title, undefined, { numeric: true }));
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

/** The runs that worked a change or a task, newest first. */
export function runsFor(store: Reader, work: Of<"change"> | Of<"task">): readonly Of<"run">[] {
  return [...inwardOf(store, work, "ranFor")].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}
