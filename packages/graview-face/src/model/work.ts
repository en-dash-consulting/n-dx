import { byChoice, inward, inwardOf, isOpen, nodesOf, PRIORITY_ORDER, STATUS_ORDER, type Node, type Of, type Reader } from "./graph.js";

export interface Attention {
  /** Open changes that wait for a person to place them. */
  readonly inbox: readonly Of<"change">[];
  /** Finished changes rex never placed: history for the migration to place, not work waiting on anyone. */
  readonly placedNever: readonly Of<"change">[];
  readonly blocked: readonly (Of<"change"> | Of<"task">)[];
  readonly failing: readonly (Of<"change"> | Of<"task">)[];
  readonly defective: readonly Of<"capability">[];
  readonly total: number;
}

/**
 * What needs a person: the open changes in the Inbox, blocked and failing
 * work, defective capabilities. Rex keeps a finished change that was never
 * placed in the Inbox too (a v1 tree holds many), but nothing waits on it,
 * so it is said apart and never counted as needing attention.
 */
export function attention(store: Reader): Attention {
  const changes = nodesOf(store, "change");
  const tasks = nodesOf(store, "task");
  const unplaced = changes.filter((c) => c.inbox === true).sort(byChoice(PRIORITY_ORDER, (c) => c.priority));
  const inbox = unplaced.filter(isOpen);
  const placedNever = unplaced.filter((c) => !isOpen(c));
  const blocked = [...changes, ...tasks].filter((n) => n.status === "blocked");
  const failing = [...changes, ...tasks].filter((n) => n.status === "failing");
  const defective = nodesOf(store, "capability").filter((c) => c.health === "defective");
  return { inbox, placedNever, blocked, failing, defective, total: inbox.length + blocked.length + failing.length + defective.length };
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

export interface AreaStanding {
  /** Capabilities anywhere under the area. */
  readonly capabilities: number;
  readonly met: number;
  /** Open changes that amend or touch those capabilities, or the area itself. */
  readonly open: number;
}

/** An area at a glance: what it holds and how much of that stands. */
export function areaStanding(store: Reader, area: Of<"area">): AreaStanding {
  const capabilities: Of<"capability">[] = [];
  const seen = new Set<string>([area.id]);
  const walk = (id: string) => {
    for (const child of inward(store, id, "under")) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      if (child.kind === "capability") capabilities.push(child as Of<"capability">);
      walk(child.id);
    }
  };
  walk(area.id);
  const open = new Set<string>();
  for (const target of [area.id, ...capabilities.map((c) => c.id)]) {
    for (const edge of ["amends", "touches"] as const) for (const change of inward(store, target, edge)) if (change.kind === "change" && isOpen(change)) open.add(change.id);
  }
  return { capabilities: capabilities.length, met: capabilities.filter((c) => c.intentStatus === "met").length, open: open.size };
}
