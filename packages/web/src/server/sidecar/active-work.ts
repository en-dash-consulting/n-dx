/**
 * What active work holds right now, so a Sidecar card that would write to it
 * can say so before the operator approves.
 *
 * Active work is a live hench run (a lock file in any worktree of the
 * repository, or an execution this server started) or a rex claim. Each holds
 * its task, and every item above the task (its change, feature or epic) too:
 * editing the change a run is working through interferes with that run as
 * much as editing the task does. A run outranks a claim on the same task.
 *
 * The isolation is a warning, never a refusal: a card touching a held item
 * carries `heldBy` (`SidecarHeldBy`), and its approval must acknowledge it
 * (`routes-sidecar.ts`). The session packet lists the held items so the agent
 * avoids proposing edits to them in the first place.
 *
 * Every read here is best effort: a read that fails holds nothing, so a broken
 * lock directory or claims store never stops a card.
 */

import { basename } from "node:path";
import { findItem, openClaimsStore, resolveStore, type PRDItem } from "../rex-gateway.js";
import type { ServerContext } from "../types.js";
import type {
  SidecarChangeSet,
  SidecarHeldBy,
  SidecarItemEdit,
  SidecarLink,
  SidecarPlacement,
  SidecarStatusChange,
} from "../../shared/index.js";

/** One piece of active work, before the PRD names what it holds. */
export interface ActiveWorkHolder {
  taskId: string;
  /** The worktree it runs or is claimed in. */
  worktreePath: string;
  runId?: string;
  source: "run" | "claim";
}

/** Where active work is read from; injected in tests. */
export interface ActiveWorkReads {
  /** Live runs across the repository's worktrees: hench locks and this server's executions. */
  runs(): Promise<ReadonlyArray<{ taskId: string | null; worktree: string; runId?: string }>>;
  /** Live rex claims across the repository. */
  claims(): Promise<ReadonlyArray<{ taskId: string; worktreeRoot: string }>>;
  /** The PRD's items, to find the items above each held task; null when it cannot be read. */
  items(): Promise<PRDItem[] | null>;
}

/** Held items by id: the task a holder is on, and every item above it. */
export type HeldItems = ReadonlyMap<string, SidecarHeldBy>;

/**
 * The default reads for `ctx`'s workspace. `runs` is injected because the
 * run-slot count lives with the hench routes (`repositoryRunSlotUsage`), which
 * this module does not import.
 */
export function activeWorkReads(ctx: Pick<ServerContext, "projectDir" | "rexDir">, runs: ActiveWorkReads["runs"]): ActiveWorkReads {
  return {
    runs,
    claims: async () => openClaimsStore(ctx.projectDir).readClaims(),
    items: async () => (await (await resolveStore(ctx.rexDir)).loadDocument()).items,
  };
}

async function settled<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/** The holders `reads` see: runs first, then claims on tasks no run holds. Never throws. */
export async function readActiveWorkHolders(reads: ActiveWorkReads): Promise<ActiveWorkHolder[]> {
  const [runs, claims] = await Promise.all([settled(reads.runs, []), settled(reads.claims, [])]);
  const holders: ActiveWorkHolder[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    if (!run.taskId || seen.has(run.taskId)) continue;
    seen.add(run.taskId);
    holders.push({ taskId: run.taskId, worktreePath: run.worktree, ...(run.runId && { runId: run.runId }), source: "run" });
  }
  for (const claim of claims) {
    if (seen.has(claim.taskId)) continue;
    seen.add(claim.taskId);
    holders.push({ taskId: claim.taskId, worktreePath: claim.worktreeRoot, source: "claim" });
  }
  return holders;
}

/**
 * The items `holders` hold: each task, and each item above it in `items`. An
 * item above two held tasks is held by the first holder listed (runs before
 * claims). A task the PRD does not know still holds its own id.
 */
export function heldItemsOf(holders: readonly ActiveWorkHolder[], items: readonly PRDItem[] | null): Map<string, SidecarHeldBy> {
  const held = new Map<string, SidecarHeldBy>();
  for (const holder of holders) {
    const entry = items ? findItem(items as PRDItem[], holder.taskId) : null;
    const base = {
      taskId: holder.taskId,
      ...(entry && { taskTitle: entry.item.title }),
      worktree: basename(holder.worktreePath) || holder.worktreePath,
      worktreePath: holder.worktreePath,
      ...(holder.runId && { runId: holder.runId }),
      source: holder.source,
    };
    for (const id of [holder.taskId, ...(entry?.parents.map((p) => p.id) ?? [])]) {
      if (!held.has(id)) held.set(id, { itemId: id, ...base });
    }
  }
  return held;
}

/** The items active work holds right now. Never throws; a failed read holds nothing. */
export async function readActiveWork(reads: ActiveWorkReads): Promise<Map<string, SidecarHeldBy>> {
  const holders = await readActiveWorkHolders(reads);
  if (holders.length === 0) return new Map();
  return heldItemsOf(holders, await settled(reads.items, null));
}

/** The parts of a card that name PRD items. */
export interface CardItems {
  itemEdit?: SidecarItemEdit;
  statusChange?: SidecarStatusChange;
  link?: SidecarLink;
  placement?: SidecarPlacement;
  changeSet?: SidecarChangeSet;
}

/**
 * The existing PRD items a card's approval writes to: the edited, re-statused
 * or linked item, the placed change, and a change set's existing parents and
 * duplicates. Empty for a card that writes no existing item.
 */
export function cardItemIds(card: CardItems): string[] {
  const ids: string[] = [];
  if (card.itemEdit) ids.push(card.itemEdit.itemId);
  if (card.statusChange) ids.push(card.statusChange.itemId);
  if (card.link) ids.push(card.link.itemId);
  if (card.placement) ids.push(card.placement.change);
  for (const item of card.changeSet?.items ?? []) {
    if (item.parentId) ids.push(item.parentId);
    if (item.duplicate) ids.push(item.duplicate.id);
  }
  return [...new Set(ids)];
}

/** The first of `ids` that active work holds, or null. */
export function firstHeld(held: HeldItems, ids: readonly string[]): SidecarHeldBy | null {
  for (const id of ids) {
    const by = held.get(id);
    if (by) return by;
  }
  return null;
}

/** What holds the item, in a sentence the agent and the operator both read. */
export function heldByText(by: SidecarHeldBy): string {
  const what = by.source === "run" ? `an active run${by.runId ? ` (${by.runId})` : ""}` : "a claim";
  const task = `task ${by.taskId}${by.taskTitle ? ` (${by.taskTitle})` : ""}`;
  const via = by.itemId === by.taskId ? "" : ` — ${by.itemId} is above that task`;
  return `held by ${what} on ${task} in ${by.worktree}${via}`;
}

/** At most this many held tasks are listed in the packet section. */
export const HELD_SECTION_MAX = 20;

/**
 * The session packet's "Items active work holds right now" section, in the
 * packet's section format; empty when nothing is held. Lists each held task
 * with the items above it, so the agent can avoid proposing writes to them.
 */
export function heldWorkSection(held: HeldItems, now: string): string {
  if (held.size === 0) return "";
  const byTask = new Map<string, { task: SidecarHeldBy; above: string[] }>();
  for (const by of held.values()) {
    const group = byTask.get(by.taskId) ?? { task: by, above: [] };
    if (by.itemId === by.taskId) group.task = by;
    else group.above.push(by.itemId);
    byTask.set(by.taskId, group);
  }
  const groups = [...byTask.values()];
  const lines = groups.slice(0, HELD_SECTION_MAX).map(({ task, above }) => {
    const head = `- ${task.taskId}${task.taskTitle ? ` ${task.taskTitle}` : ""}: ${task.source === "run" ? "running" : "claimed"} in ${task.worktree}`;
    return above.length > 0 ? `${head}; also holds ${above.join(", ")}` : head;
  });
  if (groups.length > HELD_SECTION_MAX) lines.push(`- …and ${groups.length - HELD_SECTION_MAX} more held tasks`);
  return [
    "## Items active work holds right now",
    `_source: hench locks, dashboard runs and rex claims · generated: ${now} · fresh_`,
    "",
    "Another run or worktree is working these. Do not propose edits, status changes, links, placements or new children for them; a card that touches one warns the operator and needs a second confirmation.",
    ...lines,
  ].join("\n");
}
