/**
 * Work selection on a v2 tree (product/ + changes/).
 *
 * `resolveStore` returns the change-layer store there, whose document is the
 * change layer projected as v1 items. The v1 selector run over that projection
 * would pick Inbox changes and ignore a change's own gates, so a v2 tree is
 * selected with rex's v2 selector — the one `get_next_task` uses — and the
 * answer is handed back as a {@link TreeEntry} over the projection, which is
 * what the brief and the claim already take. A v1 tree never reaches this
 * module: {@link loadV2Tree} answers `undefined` and callers keep the v1 path.
 *
 * @module hench/agent/planning/work-selection
 */

import {
  awaitsPlacement,
  findActionableWork,
  findItem,
  findNextWorkTask,
  indexTree,
  isChangeLayerStore,
  openChangeTasks,
  resolveWorkById,
} from "../../prd/rex-gateway.js";
import { CLIError } from "../../prd/llm-gateway.js";
import { DEFAULT_CLI_NAME } from "./cli-identity.js";
import type { PRDItem, PRDStore, SelectionExplanation, TaskClaim, TreeEntry, V2Tree } from "../../prd/rex-gateway.js";

/** Why the epic flags (`--epic`, `--epic-by-epic`) do not apply on a v2 tree. */
export const V2_HAS_NO_EPICS =
  "this PRD is a v2 tree (product/ and changes/), which has no epic level; its work is changes and their tasks";

/** The v2 tree behind `store`; `undefined` on a v1 tree. */
export async function loadV2Tree(store: PRDStore): Promise<V2Tree | undefined> {
  return isChangeLayerStore(store) ? store.loadTree() : undefined;
}

type ChangeLayerNode = V2Tree["changes"][number];

/**
 * The tree with every change-layer node in `ids` read as pending: what a dry
 * run's `--reset-deferred` would have selected from. The input is not changed.
 */
export function readTreeAsReset(tree: V2Tree, ids: ReadonlySet<string>): V2Tree {
  const reset = (nodes: ChangeLayerNode[]): ChangeLayerNode[] =>
    nodes.map((node) => ({
      ...node,
      ...(ids.has(node.id) ? { status: "pending" as const } : {}),
      ...(node.children ? { children: reset(node.children) } : {}),
    }));
  return { product: tree.product, changes: reset(tree.changes) };
}

/** Said when every unit of the branch's work set is done; rex next and `rex branch show` say the same. */
export const WORK_SET_FINISHED =
  "This branch's work set is finished: all its tasks are done; selection stays narrowed to it, and --any picks outside it";

/**
 * Whether selection inside `workSet` picked nothing while it still has open
 * units: blocked, not finished, and not a success.
 */
export function workSetBlocked(workSet: BranchWorkSet): boolean {
  return workSet.ids.length > 0;
}

/**
 * What to say when selection inside `workSet` picked nothing: finished, or
 * each open unit with why it cannot be picked, as rex next prints it
 * (rex's `workSetBlockedLines`).
 */
export function workSetEndMessage(workSet: BranchWorkSet): string {
  if (!workSetBlocked(workSet)) return WORK_SET_FINISHED;
  const n = workSet.ids.length;
  return [
    `Nothing in this branch's work set can be picked: ${n === 1 ? "its 1 open task is" : `its ${n} open tasks are`} blocked; --any picks outside it`,
    ...workSet.blocked.map((u) => `  ${u.displayId ?? u.id} "${u.title}" [${u.status}]: ${u.reasons.join("; ")}`),
  ].join("\n");
}

/**
 * Autoselection found nothing inside the branch's work set. `blocked` false:
 * the set is finished, and `--loop` reads it as "done". `blocked` true: open
 * units remain that cannot be picked, and the run fails naming them.
 */
export class WorkSetExhaustedError extends Error {
  readonly branch: string;
  readonly blocked: boolean;
  constructor(workSet: BranchWorkSet) {
    super(workSetEndMessage(workSet));
    this.name = "WorkSetExhaustedError";
    this.branch = workSet.branch;
    this.blocked = workSetBlocked(workSet);
  }
}

/** An open unit of the set selection cannot pick, with rex's reasons (`unpickableUnits`). */
export interface BlockedWorkUnit {
  id: string;
  displayId?: string;
  title: string;
  status: string;
  reasons: readonly string[];
}

/**
 * A branch work set as rex's selector returns it: the branch, its open units
 * and, when nothing was picked from them, each with why.
 */
export interface BranchWorkSet {
  branch: string;
  ids: readonly string[];
  blocked: readonly BlockedWorkUnit[];
}

/** Claims and filters rex's selector passes over, so a blocked set's reasons name them. */
export interface WorkSetSelectContext {
  /** Units other worktrees hold, by id (`TaskClaims.foreignClaims`). */
  claims?: ReadonlyMap<string, { worktreeRoot: string }>;
  /** `--mine`. */
  assignee?: string;
}

/** Units an earlier branch of this name left, as rex's selector reports them: not in the set. */
export interface EarlierBranchUse {
  branch: string;
  ids: readonly string[];
  /** The line rex next and `rex branch show` print for them. */
  message: string;
}

/**
 * The work set selection in `projectDir` is narrowed to, as rex's selector
 * works it out (get_next_task's rule): null on the default branch, a detached
 * HEAD or a branch with no assignment, and null when `projectDir` is absent
 * (`--any`). With `context`, a set nothing can be picked from lists why.
 */
export function branchWorkSet(tree: V2Tree, projectDir: string | undefined, context: WorkSetSelectContext = {}): BranchWorkSet | null {
  return branchWork(tree, projectDir, context).workSet;
}

/**
 * {@link branchWorkSet} with the units an earlier branch of this name left
 * (`earlierUse`), which rex's selector reports and leaves out of the set.
 * Both null when `projectDir` is absent (`--any`).
 */
export function branchWork(
  tree: V2Tree,
  projectDir: string | undefined,
  context: WorkSetSelectContext = {},
): { workSet: BranchWorkSet | null; earlierUse: EarlierBranchUse | null } {
  if (!projectDir) return { workSet: null, earlierUse: null };
  const { workSet, earlierUse } = findNextWorkTask(tree, { ...context, workspace: projectDir });
  return { workSet, earlierUse };
}

export interface V2SelectOptions {
  /** Units to pass over: stuck, over their attempt limit, or claimed elsewhere. */
  excludeIds?: ReadonlySet<string>;
  /** Units other worktrees hold, by id: passed over, and named as claimed when the work set is blocked. */
  claims?: ReadonlyMap<string, { worktreeRoot: string }>;
  /** Only units carrying one of these tags (`--tags`, self-heal). */
  tags?: readonly string[];
  /** Only units assigned to this identity, directly or through their change (`--mine`). */
  assignee?: string;
  /** Only units in this branch work set ({@link branchWorkSet}); an empty set selects nothing. */
  workSet?: ReadonlySet<string>;
}

/**
 * A selected unit. `explanation` is rex's, so `explanation.priority.itemPriority`
 * is the priority selection ranked it by: its own, else its change's.
 */
export interface V2Entry extends TreeEntry {
  explanation: SelectionExplanation;
}

/** The unit autonomous selection runs next, or `null` when none is actionable. */
export function nextV2Entry(tree: V2Tree, options: V2SelectOptions = {}): V2Entry | null {
  return nextV2Selection(tree, options).entry;
}

/**
 * {@link nextV2Entry} for a checkout: given `workspace` (absent under `--any`),
 * rex's selector narrows to that checkout's branch work set and returns the
 * set with the unit. `workSet` is null when selection was not narrowed.
 */
export function nextV2Selection(
  tree: V2Tree,
  options: V2SelectOptions & { workspace?: string } = {},
): { entry: V2Entry | null; workSet: BranchWorkSet | null } {
  const select = {
    ...(options.excludeIds?.size ? { excludeIds: options.excludeIds } : {}),
    ...(options.claims?.size ? { claims: options.claims } : {}),
    ...(options.assignee ? { assignee: options.assignee } : {}),
    ...(options.tags?.length ? { tags: options.tags } : {}),
    ...(options.workSet ? { workSet: options.workSet } : {}),
  };
  const { task, workSet } = options.workspace
    ? findNextWorkTask(tree, { ...select, workspace: options.workspace })
    : { task: findNextWorkTask(tree, select), workSet: null };
  return { entry: task ? { item: task.item, parents: task.parents, explanation: task.explanation } : null, workSet };
}

/** Every actionable unit, best first, as entries of `items` (the projected change layer). */
export function actionableV2Entries(
  tree: V2Tree,
  items: PRDItem[],
  options: Omit<V2SelectOptions, "tags"> = {},
): TreeEntry[] {
  const units = findActionableWork(tree, {
    ...(options.excludeIds?.size ? { excludeIds: options.excludeIds } : {}),
    ...(options.assignee ? { assignee: options.assignee } : {}),
    ...(options.workSet ? { workSet: options.workSet } : {}),
  });
  return units.flatMap((u) => findItem(items, u.node.id) ?? []);
}

/** Claims other worktrees hold, by task id (`TaskClaims.foreignClaims`). */
type ForeignClaims = ReadonlyMap<string, TaskClaim>;

/**
 * The entry an explicit `--task` runs for a ref: an id, a display id (`CH-1`)
 * or an alias. Selection gates do not apply — a change awaiting placement runs
 * when asked for by name. A change with open tasks runs its next actionable
 * task that no other worktree holds (`foreign`), never itself: the change
 * closes once its tasks do. `null` when the ref names nothing that runs on its
 * own; {@link changeTasksRefusal} explains a change whose tasks cannot run.
 */
export function findV2Entry(tree: V2Tree, items: PRDItem[], ref: string, foreign?: ForeignClaims): TreeEntry | null {
  const unit = resolveWorkById(tree, ref, foreign?.size ? { excludeIds: new Set(foreign.keys()) } : {});
  return unit ? findItem(items, unit.node.id) : null;
}

/**
 * The change a ref names when {@link findV2Entry} resolved it to one of that
 * change's tasks (`entry`). The change's own status still gates the run, as it
 * did when the change was the unit: a deferred or blocked change is refused,
 * not worked through its tasks. `null` when the ref names `entry` itself.
 */
export function namedChangeEntry(tree: V2Tree, items: PRDItem[], ref: string, entry: TreeEntry): TreeEntry | null {
  const node = indexTree(tree).resolve(ref);
  return node?.type === "change" && node.id !== entry.item.id ? findItem(items, node.id) : null;
}

/**
 * The priority rex ranks the unit a ref runs by: its own, else its change's,
 * as autoselection reports it (`explanation.priority.itemPriority`).
 */
export function v2RefPriority(tree: V2Tree, ref: string): PRDItem["priority"] {
  const unit = resolveWorkById(tree, ref);
  return unit ? (unit.node.priority ?? unit.change.priority) : undefined;
}

/** `--task` named a change whose open tasks are all claimed elsewhere, blocked or not actionable. */
export class ChangeTasksUnavailableError extends CLIError {
  /** Every open task is claimed by another worktree. */
  readonly allClaimed: boolean;

  constructor(message: string, suggestion: string, allClaimed: boolean) {
    super(message, suggestion);
    this.name = "ChangeTasksUnavailableError";
    this.allClaimed = allClaimed;
  }
}

/**
 * Why `--task` naming a change runs nothing: the change has open tasks and
 * none of them can run, each named with its reason. `undefined` when the ref
 * names no such change, or one of its tasks can run ({@link findV2Entry}).
 */
export function changeTasksRefusal(
  tree: V2Tree,
  ref: string,
  foreign: ForeignClaims = new Map(),
  cliName = DEFAULT_CLI_NAME,
): ChangeTasksUnavailableError | undefined {
  const open = openChangeTasks(tree, ref);
  if (open.length === 0 || resolveWorkById(tree, ref, { excludeIds: new Set(foreign.keys()) })) return undefined;
  const change = indexTree(tree).resolve(ref);
  const reasons = open.map(({ node, openBlockers }) => {
    // Not claimed and not runnable: rex found open blockers, or its status is not one selection runs.
    const claim = foreign.get(node.id);
    const status = node.status ?? "pending";
    const why = claim
      ? `claimed by another worktree: ${claim.worktreeRoot}`
      : openBlockers.length > 0
        ? `${status}, blocked by ${openBlockers.join(", ")}`
        : status;
    return `${node.displayId ?? node.id} "${node.title}" (${why})`;
  });
  const allClaimed = open.every(({ node }) => foreign.has(node.id));
  return new ChangeTasksUnavailableError(
    `"${change?.title ?? ref}" (${ref}) has no task to run: ${reasons.join("; ")}.`,
    allClaimed
      ? `Wait for those runs to finish, or run '${cliName} work --task=<task>' from the worktree that holds it.`
      : `Unblock or reopen one of its tasks, then run '${cliName} work --task=${ref}' again.`,
    allClaimed,
  );
}

/**
 * Why a ref cannot run: it names a change held for placement
 * (`awaitsPlacement`), or a task inside one. Rex refuses to close such a
 * change, so a run would work it and then end completed with the item still
 * open. `undefined` when the ref is not held or names nothing; on a product
 * layer with no capability or constraint an Inbox change is not held.
 */
export function inboxRefusal(tree: V2Tree, ref: string, cliName = DEFAULT_CLI_NAME): CLIError | undefined {
  const change = resolveWorkById(tree, ref)?.change;
  if (!change || !awaitsPlacement(indexTree(tree), change)) return undefined;
  return new CLIError(
    `"${change.title}" (${change.id}) is in the Inbox and needs placement, so it cannot be worked on.`,
    `Place it from the Inbox on the dashboard's Plan page, with 'rex change place', or with MCP place_change ` +
      `(when nothing fits, 'rex change place ${change.id} --propose'), then run '${cliName} work --task=${ref}' again.`,
  );
}

/**
 * {@link findV2Entry}, refusing with the reason when the ref names nothing
 * that runs on its own.
 */
export function resolveV2Entry(
  tree: V2Tree,
  items: PRDItem[],
  ref: string,
  foreign?: ForeignClaims,
  cliName = DEFAULT_CLI_NAME,
): TreeEntry {
  const found = findV2Entry(tree, items, ref, foreign);
  if (found) return found;
  const unavailable = changeTasksRefusal(tree, ref, foreign, cliName);
  if (unavailable) throw unavailable;
  throw notRunnableRefusal(tree, items, ref) ?? new Error(`Task not found: ${ref}`);
}

/**
 * Why a ref that exists cannot run on its own: a container change (it holds
 * other changes) or a subtask (it runs with its task). `undefined` when the
 * ref names neither. The run throws it; `--resolve` reports it.
 */
export function notRunnableRefusal(tree: V2Tree, items: PRDItem[], ref: string): Error | undefined {
  const node = indexTree(tree).resolve(ref);
  const entry = node ? findItem(items, node.id) : null;
  if (entry?.item.type === "change") {
    return new Error(
      `"${entry.item.title}" (${ref}) holds other changes, so it is not a unit of work. ` +
        "Run one of its nested changes or tasks.",
    );
  }
  if (entry?.item.type === "subtask") {
    return new Error(`"${entry.item.title}" (${ref}) is a subtask; it runs with its task. Run the task instead.`);
  }
  return undefined;
}
