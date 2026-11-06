/**
 * v2 product-layer reads: the Product page, the Changes view and the
 * capability page.
 *
 *   GET /api/rex/product                 → { layout: "v2", map }
 *   GET /api/rex/changes                 → { layout: "v2", changes }
 *   GET /api/rex/changes/summary         → { layout: "v2", summary }
 *   GET /api/rex/product/capability/<id> → { layout: "v2", capability }
 *   GET /api/rex/product/area/<slug-or-id> → { layout: "v2", area }
 *   POST /api/rex/product/edit           → { layout: "v2", outcome, drafts, capability }
 *
 * The POST is the capability page's edit form: it runs rex's `handleProductEdit`
 * inside rex's v2 transaction. A v1 tree answers 409; there is nothing to edit.
 *
 * On a v1 tree each answers `{ layout: "v1" }`: there is no product layer to
 * show, and the viewer says to run `ndx migrate`. No v1 route changes.
 *
 * Status, health, open and applied are rex's (`productReport`,
 * `capabilityReport`, `isOpenChange`, `isAppliedChange`); this module only
 * reshapes them into what the views render. The wire types mirror
 * `viewer/views/product-model.ts`; `tests/unit/server/routes-rex-product.test.ts`
 * fails to compile if the two drift.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "../types.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import { jsonResponse, errorResponse, readBody, errorMessage } from "../response-utils.js";
import { appendLog } from "./rex-route-helpers.js";
import {
  prdLayout,
  loadPrdModel,
  productReport,
  capabilityReport,
  indexTree,
  isAppliedChange,
  isOpenChange,
  awaitsPlacement,
  nodeSpec,
  specHash,
  handleProductEdit,
  ProductEditError,
  withPrdModelTransaction,
  findNextWorkTask,
  openClaimsStore,
  resolveClaimHolder,
  computeEdges,
  suggestPlacements,
} from "../rex-gateway.js";
import type { ChangeNode, RuleNode, TreeIndex, V2Tree } from "../rex-gateway.js";

// ── Wire types (mirror viewer/views/product-model.ts) ────────────────

export type CapabilityStatusWire = "proposed" | "changing" | "met" | "revised" | "retired";
export type CapabilityHealthWire = "ok" | "defective";
export type ChangeStageWire = "proposed" | "ready" | "in-progress" | "awaiting-apply" | "applied" | "shipped";
export type AmendmentDeltaWire = "added" | "modified" | "removed";

export interface OpenChangeOverlayWire {
  id: string;
  displayId?: string;
  title: string;
  stage: ChangeStageWire;
  delta?: AmendmentDeltaWire;
}

export interface CapabilityRowWire {
  id: string;
  displayId?: string;
  title: string;
  statement?: string;
  status: CapabilityStatusWire;
  health: CapabilityHealthWire;
  specReviewed?: boolean;
  criteriaCount: number;
  openChanges: OpenChangeOverlayWire[];
}

export interface ConstraintRowWire {
  id: string;
  displayId?: string;
  title: string;
  statement?: string;
  health: CapabilityHealthWire;
  appliesTo: "all" | string[];
}

export interface AreaSectionWire {
  id: string;
  /** The area's frozen v2 slug: the folder it lives in, and the address of its page. */
  slug: string;
  displayId?: string;
  title: string;
  summary?: string;
  stewards?: string[];
  capabilities: CapabilityRowWire[];
  /**
   * Distinct open, unshipped changes that touch or amend the area or a node in
   * it, or add a node under one. Its length is the area map's open-change count.
   */
  openChangeIds: string[];
}

export interface ProductMapWire {
  statement?: string;
  areas: AreaSectionWire[];
  constraints: ConstraintRowWire[];
}

export interface ChangeRowWire {
  id: string;
  displayId?: string;
  title: string;
  intent?: string;
  stage: ChangeStageWire;
  priority?: string;
  loe?: number;
  spike?: boolean;
  assignee?: string;
  plannedRelease?: string;
  shippedIn?: string;
  /** When the change was applied; set on applied history. */
  appliedAt?: string;
  needsPlacement?: boolean;
  /** Open and held for placement by rex: `ndx work` refuses it. Absent on applied history. */
  awaitsPlacement?: boolean;
  amends: Array<{ id: string; title: string; delta: AmendmentDeltaWire }>;
  touches: Array<{ id: string; title: string }>;
  taskCount: number;
  completedTaskCount: number;
  /** No acceptance criteria on the change, or on one of its open tasks. */
  criteriaGap: boolean;
  /** Distinct blockers, on the change or its open tasks, that are not completed. */
  openBlockers: number;
  /**
   * The areas whose `openChangeIds` list this change, in the map's order.
   * Absent on applied history and on an open change no area counts.
   */
  areas?: AreaRefWire[];
}

/** An area an open change counts toward: what Open changes' area filter matches and names. */
export interface AreaRefWire {
  id: string;
  slug: string;
  title: string;
}

/** The stages an open change can be in. */
export type OpenChangeStageWire = Exclude<ChangeStageWire, "applied" | "shipped">;

/** One placed open change, with only the fields Plan's open-changes glance shows. */
export interface GlanceChangeWire {
  id: string;
  displayId?: string;
  title: string;
  stage: OpenChangeStageWire;
  priority?: string;
  plannedRelease?: string;
  taskCount: number;
  completedTaskCount: number;
  /** As on `ChangeRowWire`: the glance's gap chips read these two. */
  criteriaGap: boolean;
  openBlockers: number;
}

/** The unit `ndx work` would run next, and why rex picked it. */
export interface NextPickWire {
  id: string;
  displayId?: string;
  title: string;
  type: "change" | "task" | "subtask";
  changeId: string;
  changeDisplayId?: string;
  changeTitle: string;
  /** Rex's selection reason code. */
  reason: "in_progress" | "ready_to_finalize" | "priority";
  /** Rex's wording of that reason. Display only. */
  summary: string;
}

/**
 * Plan's glance read: a few hundred bytes where the full change list is
 * megabytes. Stage counts are over placed open changes; changes rex holds for
 * placement count once, as Inbox, and are absent from `open`.
 */
export interface ChangeSummaryWire {
  inbox: number;
  stages: Record<OpenChangeStageWire, number>;
  /** Placed open changes, in tree order. */
  open: GlanceChangeWire[];
  /** `null` when nothing is actionable outside another worktree's claims. */
  next: NextPickWire | null;
  /** Automated and metric requirements on open changes and their tasks, where `rex ready` reads them, and the open changes that hold none. */
  requirements: { total: number; uncovered: number };
}

export interface CapabilityDetailWire extends Omit<CapabilityRowWire, "criteriaCount"> {
  /** The capability was met at some point (`metAt` is recorded). */
  met: boolean;
  /** Met once, and its spec no longer hashes to `metAt`. Never true when `met` is false. */
  specChangedSinceMet: boolean;
  areaId: string;
  areaTitle: string;
  criteria: Array<{ id: string; text: string; inheritedFrom?: string }>;
  dependsOn: Array<{ id: string; title: string }>;
  history: Array<{
    changeId: string;
    changeDisplayId?: string;
    changeTitle: string;
    stage: ChangeStageWire;
    delta?: AmendmentDeltaWire;
    shippedIn?: string;
    at?: string;
  }>;
  code: Array<{ path: string; role?: string }>;
  /** Open changes amending this capability, with what each would change. */
  pendingAmendments: PendingAmendmentWire[];
  /**
   * Changes rex holds in the Inbox for placement that amend or touch this
   * capability, such as the draft a Product-page spec edit makes. Never in
   * `openChanges`: a held change counts only in the Inbox.
   */
  inboxChanges: HeldChangeWire[];
}

/** An Inbox change held for placement, as the capability page links to it. */
export type HeldChangeWire = Omit<OpenChangeOverlayWire, "stage">;

/** One open change's edit to a capability: replacement statement and criterion deltas. */
export interface PendingAmendmentWire {
  changeId: string;
  changeDisplayId?: string;
  changeTitle: string;
  stage: ChangeStageWire;
  delta: AmendmentDeltaWire;
  summary: string;
  /** The replacement statement, when the amendment carries one. */
  proposed?: string;
  criteria?: {
    add: Array<{ id: string; text: string }>;
    replace: Array<{ id: string; text: string }>;
    remove: string[];
  };
}

/** An Inbox change whose top placement candidate sits in the area: rex's best guess, not a placement. */
export interface AreaInboxGuessWire {
  id: string;
  displayId?: string;
  title: string;
  target: { id: string; title: string; type: "capability" | "constraint" };
  relation: "touches" | "amends";
  /** `tied` when the top two candidates share a score, as the Inbox page shows it. */
  strength: "strong" | "possible" | "weak" | "tied";
}

/** An applied change that amended or touched the area or a node in it. */
export interface AreaAppliedChangeWire {
  id: string;
  displayId?: string;
  title: string;
  appliedAt?: string;
  shippedIn?: string;
}

/** `GET /api/rex/product/area/<slug-or-id>`: everything the area view renders. */
export interface AreaDetailWire {
  id: string;
  slug: string;
  displayId?: string;
  title: string;
  summary?: string;
  stewards: string[];
  counts: {
    capabilities: number;
    constraints: number;
    met: number;
    changing: number;
    defective: number;
    openChanges: number;
  };
  /** Live capabilities whose nearest area is this one, in tree order. */
  capabilities: CapabilityRowWire[];
  /** Constraints that bind the area or any of its capabilities (rex's `boundBy`). */
  constraints: ConstraintRowWire[];
  /** Open changes amending or touching the area or its capabilities, in tree order. */
  openChanges: OpenChangeOverlayWire[];
  inbox: AreaInboxGuessWire[];
  /** The {@link RECENT_APPLIED_LIMIT} most recently applied, newest first. */
  recentlyApplied: AreaAppliedChangeWire[];
  /** The files each capability lists in `realizedBy`. Empty until code is linked. */
  code: Array<{ capabilityId: string; path: string }>;
}

// ── Mapping ──────────────────────────────────────────────────────────

/** Applied changes the capability page lists; rex's page-size ceiling. */
const HISTORY_LIMIT = 100;

/** Applied changes the area view lists. */
const RECENT_APPLIED_LIMIT = 5;

/**
 * A change's stage, the views' provisional vocabulary (see `ChangeStage` in
 * product-model.ts): shipped and applied from rex's state, then started, then
 * marked ready. Rex has no stage of its own to defer to.
 *
 * Started means the change is `in_progress` or `failing`, or a live task or
 * subtask under it is that or `completed`. `ndx work` records the start on the
 * task it runs and leaves the change's own state empty. Status, not `startedAt`:
 * rex never clears `startedAt`, so a task reset to pending after a failed run keeps it.
 */
function stageOf(change: RuleNode): ChangeStageWire {
  if (change.shippedIn) return "shipped";
  if (isAppliedChange(change)) return "applied";
  // Completed but not applied: rex.applyOn is review or release, so only a steward's
  // apply (MCP, CLI, the detail panel's Apply…) or a release stamp moves it on.
  if (change.status === "completed") return "awaiting-apply";
  if (isActive(change) || liveWorkUnder(change).some((n) => isActive(n) || n.status === "completed")) {
    return "in-progress";
  }
  return change.ready ? "ready" : "proposed";
}

/**
 * Open, placed and not yet shipped: a change at one of the
 * {@link OpenChangeStageWire} stages. Rex's `isOpenChange` keeps a shipped but
 * unapplied change open, and an Inbox change held for placement may already
 * amend a node (a Product-page edit drafts one). The map's badges, Moving now
 * and the Product total count what Open changes' Open filter and the
 * lifecycle strip count, so they leave both out: a held change counts only in
 * the Inbox.
 */
const isMovingChange = (index: TreeIndex, change: RuleNode): boolean =>
  isOpenChange(change) && !change.shippedIn && !awaitsPlacement(index, change);

const isActive = (node: RuleNode): boolean =>
  node.status === "in_progress" || node.status === "failing";

/** Tasks and subtasks under a change, skipping deleted and cancelled ones and their children. */
function liveWorkUnder(node: RuleNode): RuleNode[] {
  const children = (node as { children?: RuleNode[] }).children ?? [];
  return children
    .filter((c) => (c.type === "task" || c.type === "subtask") && c.status !== "deleted" && c.status !== "cancelled")
    .flatMap((c) => [c, ...liveWorkUnder(c)]);
}

/** Live changes in tree order (the change layer's roots and anything nested under a non-change). */
type ChangeRuleNode = ChangeNode & { children?: RuleNode[] };

function changesOf(index: TreeIndex): ChangeRuleNode[] {
  return index.entries
    .filter(({ node, root }) => root === "changes" && node.type === "change")
    .map(({ node }) => node as ChangeRuleNode);
}

const titleOf = (index: TreeIndex, ref: string): { id: string; title: string } => {
  const node = index.resolve(ref);
  return node ? { id: node.id, title: node.title } : { id: ref, title: ref };
};

/** Open changes against each product node id, with the amendment's delta when it amends rather than touches. */
function overlaysByNode(index: TreeIndex, changes: ChangeRuleNode[]): Map<string, OpenChangeOverlayWire[]> {
  const out = new Map<string, OpenChangeOverlayWire[]>();
  const add = (targetId: string, overlay: OpenChangeOverlayWire): void => {
    const list = out.get(targetId) ?? [];
    if (!list.some((o) => o.id === overlay.id)) list.push(overlay);
    out.set(targetId, list);
  };
  for (const change of changes) {
    if (!isMovingChange(index, change)) continue;
    const base = {
      id: change.id,
      ...(change.displayId ? { displayId: change.displayId } : {}),
      title: change.title,
      stage: stageOf(change),
    };
    for (const a of change.amends ?? []) {
      const target = index.resolve(a.target);
      if (target) add(target.id, { ...base, delta: a.delta });
    }
    for (const ref of change.touches ?? []) {
      const target = index.resolve(ref);
      if (target) add(target.id, base);
    }
  }
  return out;
}

/**
 * Distinct open changes per area id, each node counting toward its nearest
 * area: what a change touches or amends, and where an `added` amendment lands.
 * An unapplied addition's target names nothing yet, so it counts at its
 * `under`. An addition under another of the same change's additions needs no
 * following: that chain's first addition sits under an existing node, and
 * counts the change in the same area.
 */
function openChangesByArea(index: TreeIndex, changes: ChangeRuleNode[]): Map<string, Set<string>> {
  const areaOf = new Map<string, string>();
  for (const { node, parent, root } of index.entries) {
    if (root !== "product") continue;
    const inherited = parent ? areaOf.get(parent.id) : undefined;
    if (node.type === "area") areaOf.set(node.id, node.id);
    else if (inherited) areaOf.set(node.id, inherited);
  }
  const out = new Map<string, Set<string>>();
  for (const change of changes) {
    if (!isMovingChange(index, change)) continue;
    const refs = [
      ...(change.amends ?? []).map((a) => {
        const ref = a.delta === "added" ? a.under : a.target;
        return ref === undefined ? undefined : index.resolve(ref);
      }),
      ...(change.touches ?? []).map((ref) => index.resolve(ref)),
    ];
    for (const node of refs) {
      const areaId = node ? areaOf.get(node.id) : undefined;
      if (!areaId) continue;
      const ids = out.get(areaId) ?? new Set<string>();
      ids.add(change.id);
      out.set(areaId, ids);
    }
  }
  return out;
}

function specReviewed(node: RuleNode): boolean {
  return !!node.reviewedHash && node.reviewedHash === specHash(nodeSpec(node));
}

/** The product map: every live area with its capabilities flattened, and every live constraint. */
export function buildProductMap(tree: V2Tree, header: Record<string, unknown> | undefined): ProductMapWire {
  const index = indexTree(tree);
  const changes = changesOf(index);
  const overlays = overlaysByNode(index, changes);
  const openByArea = openChangesByArea(index, changes);
  const report = productReport(tree);
  const areas: AreaSectionWire[] = [];
  const constraints: ConstraintRowWire[] = [];
  type ReportNode = ReturnType<typeof productReport>[number];

  const visit = (row: ReportNode, area: AreaSectionWire | undefined): void => {
    const node = index.resolve(row.id);
    if (row.type === "area") {
      const section: AreaSectionWire = {
        id: row.id,
        slug: node?.slug ?? row.id,
        ...(row.displayId ? { displayId: row.displayId } : {}),
        title: row.title,
        ...(row.summary ? { summary: row.summary } : {}),
        ...(node?.type === "area" && node.stewards?.length ? { stewards: node.stewards } : {}),
        capabilities: [],
        openChangeIds: [...(openByArea.get(row.id) ?? [])],
      };
      areas.push(section);
      for (const child of row.children ?? []) visit(child, section);
      return;
    }
    if (!row.status || !row.health) return;
    if (row.type === "constraint") {
      const appliesTo = node?.type === "constraint" ? node.appliesTo : undefined;
      constraints.push({
        id: row.id,
        ...(row.displayId ? { displayId: row.displayId } : {}),
        title: row.title,
        ...(row.statement ? { statement: row.statement } : {}),
        health: row.health,
        appliesTo: appliesTo === undefined || appliesTo === "all" ? "all" : appliesTo.map((ref) => titleOf(index, ref).title),
      });
    } else if (area) {
      area.capabilities.push({
        id: row.id,
        ...(row.displayId ? { displayId: row.displayId } : {}),
        title: row.title,
        ...(row.statement ? { statement: row.statement } : {}),
        status: row.status,
        health: row.health,
        ...(node && specReviewed(node) ? { specReviewed: true } : {}),
        criteriaCount: node?.type === "capability" ? node.criteria?.length ?? 0 : 0,
        openChanges: overlays.get(row.id) ?? [],
      });
    }
    for (const child of row.children ?? []) visit(child, area);
  };
  for (const row of report) visit(row, undefined);

  const body = typeof header?.body === "string" ? header.body.trim() : "";
  return { ...(body ? { statement: body } : {}), areas, constraints };
}

/** Statuses `rex ready` never evaluates (`core/ready.ts`). */
const READY_TERMINAL = new Set(["completed", "deferred", "cancelled", "deleted"]);

/** A node's automated and metric requirements: the kinds `rex ready` counts. */
const readyRequirementCount = (node: RuleNode): number =>
  node.type === "change" || node.type === "task"
    ? (node.requirements ?? []).filter((r) => r.validationType === "automated" || r.validationType === "metric").length
    : 0;

/**
 * Automated and metric requirements where `rex ready` reads them, and how many
 * open changes hold none. On v2 ready evaluates the change layer only
 * (`store/change-layer-store.ts`), so this counts open changes and their tasks
 * that ready does not treat as terminal (a completed change awaiting apply is); subtasks carry none of their own and inherit. Product-layer
 * requirements are left out: ready never sees them. Manual ones are left out:
 * ready does not count them.
 */
function requirementCoverage(index: TreeIndex): { total: number; uncovered: number } {
  let total = 0;
  let uncovered = 0;
  for (const change of changesOf(index)) {
    // Open but terminal to ready: a completed change awaiting apply, or a deferred one.
    if (!isOpenChange(change) || READY_TERMINAL.has(change.status ?? "")) continue;
    const live = tasksOf(change).filter((t) => !READY_TERMINAL.has(t.status ?? ""));
    const count = readyRequirementCount(change) + live.reduce((n, t) => n + readyRequirementCount(t), 0);
    total += count;
    if (count === 0) uncovered++;
  }
  return { total, uncovered };
}

/** A change's live tasks. */
const tasksOf = (change: ChangeRuleNode): RuleNode[] =>
  (change.children ?? []).filter((c) => c.type === "task" && c.status !== "deleted");

/**
 * Plan's glance read, from one model load: Inbox and stage counts, the placed
 * open changes and rex's next pick. `excludeIds` are units another worktree
 * has claimed, passed over as `ndx work` passes over them.
 */
export function buildChangeSummary(tree: V2Tree, excludeIds: ReadonlySet<string> = new Set()): ChangeSummaryWire {
  const index = indexTree(tree);
  const stages: Record<OpenChangeStageWire, number> = { proposed: 0, ready: 0, "in-progress": 0, "awaiting-apply": 0 };
  const open: GlanceChangeWire[] = [];
  let inbox = 0;
  for (const change of changesOf(index)) {
    if (!isOpenChange(change)) continue;
    if (awaitsPlacement(index, change)) {
      inbox++;
      continue;
    }
    const stage = stageOf(change);
    if (stage === "applied" || stage === "shipped") continue;
    stages[stage]++;
    const tasks = tasksOf(change);
    open.push({
      id: change.id,
      ...(change.displayId ? { displayId: change.displayId } : {}),
      title: change.title,
      stage,
      ...(change.priority ? { priority: change.priority } : {}),
      ...(change.plannedRelease ? { plannedRelease: change.plannedRelease } : {}),
      taskCount: tasks.length,
      completedTaskCount: tasks.filter((t) => t.status === "completed").length,
      ...gapOf(index, change, tasks),
    });
  }

  const pick = findNextWorkTask(tree, { excludeIds });
  const next: NextPickWire | null = pick
    ? {
      id: pick.unit.node.id,
      ...(pick.unit.node.displayId ? { displayId: pick.unit.node.displayId } : {}),
      title: pick.unit.node.title,
      type: pick.unit.node.type,
      changeId: pick.unit.change.id,
      ...(pick.unit.change.displayId ? { changeDisplayId: pick.unit.change.displayId } : {}),
      changeTitle: pick.unit.change.title,
      reason: pick.explanation.reason,
      summary: pick.explanation.summary,
    }
    : null;
  return { inbox, stages, open, next, requirements: requirementCoverage(index) };
}

/**
 * The gap chips' inputs. `criteriaGap`: a task-less change has no acceptance
 * criteria of its own (it runs as its own unit), or an open task under a change
 * has none. A change with tasks is judged by its tasks alone: rex moves a change's
 * criteria to its first task when it gains one (`core/change-completion.ts`), so
 * such a change normally carries none. `openBlockers`: distinct `blockedBy` ids on
 * the change or its open tasks whose node is not completed; as in rex's selection,
 * a ref that resolves to nothing counts. Open means neither completed nor cancelled.
 */
function gapOf(index: TreeIndex, change: ChangeRuleNode, tasks: RuleNode[]): { criteriaGap: boolean; openBlockers: number } {
  const openTasks = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const hasCriteria = (node: RuleNode): boolean =>
    (node.type === "change" || node.type === "task" || node.type === "subtask") && (node.acceptanceCriteria?.length ?? 0) > 0;
  const blockers = new Set<string>();
  for (const node of [change, ...openTasks]) {
    for (const ref of node.blockedBy ?? []) {
      const blocker = index.resolve(ref);
      if (!blocker || blocker.status !== "completed") blockers.add(blocker?.id ?? ref);
    }
  }
  return {
    criteriaGap: tasks.length === 0 ? !hasCriteria(change) : openTasks.some((t) => !hasCriteria(t)),
    openBlockers: blockers.size,
  };
}

/** Every live, not cancelled change: open ones and applied ones. */
export function buildChangeRows(tree: V2Tree): ChangeRowWire[] {
  const index = indexTree(tree);
  const changes = changesOf(index);
  const areasOf = areasByChange(index, openChangesByArea(index, changes));
  return changes
    .filter((change) => isOpenChange(change) || isAppliedChange(change))
    .map((change) => {
      const tasks = tasksOf(change);
      const areas = areasOf.get(change.id);
      return {
        id: change.id,
        ...(change.displayId ? { displayId: change.displayId } : {}),
        title: change.title,
        ...(change.intent ? { intent: change.intent } : {}),
        stage: stageOf(change),
        ...(change.priority ? { priority: change.priority } : {}),
        ...(change.loe !== undefined ? { loe: change.loe } : {}),
        ...(change.spike ? { spike: true } : {}),
        ...(change.assignee ? { assignee: change.assignee } : {}),
        ...(change.plannedRelease ? { plannedRelease: change.plannedRelease } : {}),
        ...(change.shippedIn ? { shippedIn: change.shippedIn } : {}),
        ...(change.appliedAt ? { appliedAt: change.appliedAt } : {}),
        ...(change.needsPlacement ? { needsPlacement: true } : {}),
        ...(isOpenChange(change) && awaitsPlacement(index, change) ? { awaitsPlacement: true } : {}),
        amends: (change.amends ?? []).map((a) => {
          const target = index.resolve(a.target);
          return target
            ? { id: target.id, title: target.title, delta: a.delta }
            : { id: a.target, title: a.title ?? a.target, delta: a.delta };
        }),
        touches: (change.touches ?? []).map((ref) => titleOf(index, ref)),
        taskCount: tasks.length,
        completedTaskCount: tasks.filter((t) => t.status === "completed").length,
        ...gapOf(index, change, tasks),
        ...(areas ? { areas } : {}),
      };
    });
}

/**
 * Each open change's areas, inverted from {@link openChangesByArea} so Open
 * changes' area filter and the map's badge read one rule. Areas run in tree
 * order, as the map lists them.
 */
function areasByChange(index: TreeIndex, openByArea: Map<string, Set<string>>): Map<string, AreaRefWire[]> {
  const out = new Map<string, AreaRefWire[]>();
  for (const { node, root } of index.entries) {
    if (root !== "product" || node.type !== "area") continue;
    const ref: AreaRefWire = { id: node.id, slug: node.slug ?? node.id, title: node.title };
    for (const changeId of openByArea.get(node.id) ?? []) {
      const refs = out.get(changeId) ?? [];
      refs.push(ref);
      out.set(changeId, refs);
    }
  }
  return out;
}

/** Open changes' amendments to one node, in tree order. */
function pendingAmendments(index: TreeIndex, nodeId: string): PendingAmendmentWire[] {
  const out: PendingAmendmentWire[] = [];
  for (const change of changesOf(index)) {
    if (!isOpenChange(change)) continue;
    for (const a of change.amends ?? []) {
      if (index.resolve(a.target)?.id !== nodeId) continue;
      const slim = (cs: ReadonlyArray<{ id: string; text: string }> | undefined) =>
        (cs ?? []).map((c) => ({ id: c.id, text: c.text }));
      out.push({
        changeId: change.id,
        ...(change.displayId ? { changeDisplayId: change.displayId } : {}),
        changeTitle: change.title,
        stage: stageOf(change),
        delta: a.delta,
        summary: a.summary,
        ...(a.proposed ? { proposed: a.proposed } : {}),
        ...(a.criteria
          ? { criteria: { add: slim(a.criteria.add), replace: slim(a.criteria.replace), remove: [...(a.criteria.remove ?? [])] } }
          : {}),
      });
    }
  }
  return out;
}

/** Open changes rex holds for placement that amend or touch one node, in tree order. */
function heldChanges(index: TreeIndex, nodeId: string): HeldChangeWire[] {
  const out: HeldChangeWire[] = [];
  for (const change of changesOf(index)) {
    if (!isOpenChange(change) || !awaitsPlacement(index, change)) continue;
    const amendment = (change.amends ?? []).find((a) => index.resolve(a.target)?.id === nodeId);
    const touches = (change.touches ?? []).some((ref) => index.resolve(ref)?.id === nodeId);
    if (!amendment && !touches) continue;
    out.push({
      id: change.id,
      ...(change.displayId ? { displayId: change.displayId } : {}),
      title: change.title,
      ...(amendment ? { delta: amendment.delta } : {}),
    });
  }
  return out;
}

/** One live capability, or `undefined` when `ref` names none. */
export function buildCapabilityDetail(tree: V2Tree, ref: string): CapabilityDetailWire | undefined {
  const index = indexTree(tree);
  const node = index.resolve(ref);
  if (!node || node.type !== "capability") return undefined;

  const report = capabilityReport(tree, node.id, { status: "applied", limit: HISTORY_LIMIT });
  const area = report.parentChain.find((p) => p.type === "area");
  const inherited = report.parentChain
    .filter((p) => p.type === "capability")
    .flatMap((p) => {
      const parent = index.resolve(p.id);
      return parent?.type === "capability"
        ? (parent.criteria ?? []).map((c) => ({ id: c.id, text: c.text, inheritedFrom: parent.title }))
        : [];
    });

  const history = report.changes.map((related) => {
    const change = index.resolve(related.id) as ChangeNode | undefined;
    const amendment = change?.amends?.find((a) => index.resolve(a.target)?.id === node.id);
    return {
      changeId: related.id,
      ...(related.displayId ? { changeDisplayId: related.displayId } : {}),
      changeTitle: related.title,
      stage: change ? stageOf(change) : "applied" as const,
      ...(amendment ? { delta: amendment.delta } : {}),
      ...(change?.shippedIn ? { shippedIn: change.shippedIn } : {}),
      ...(related.appliedAt ? { at: related.appliedAt } : {}),
    };
  });

  return {
    id: node.id,
    ...(node.displayId ? { displayId: node.displayId } : {}),
    title: node.title,
    ...(node.statement ? { statement: node.statement } : {}),
    status: report.status.status,
    health: report.status.health,
    ...(specReviewed(node) ? { specReviewed: true } : {}),
    // Read from rex's own record, not the display status: `changing` outranks
    // `revised` and `proposed`, so the status cannot tell them apart.
    met: !!node.metAt,
    specChangedSinceMet: !!node.metAt && specHash(nodeSpec(node)) !== node.metAt,
    openChanges: overlaysByNode(index, changesOf(index)).get(node.id) ?? [],
    areaId: area?.id ?? "",
    areaTitle: area?.title ?? "",
    criteria: [...inherited, ...(node.criteria ?? []).map((c) => ({ id: c.id, text: c.text }))],
    dependsOn: (node.dependsOn ?? []).map((dep) => titleOf(index, dep)),
    history,
    // Rex reports no code sites: realizedBy comes from git, which the reports do not read.
    code: [],
    pendingAmendments: pendingAmendments(index, node.id),
    inboxChanges: heldChanges(index, node.id),
  };
}

/**
 * One live area, by id, display id, alias or frozen slug, or `undefined` when
 * `ref` names none. Its capabilities and constraint rows are the product map's,
 * so the area view and Plan's map cannot disagree about a capability.
 */
export function buildAreaDetail(tree: V2Tree, ref: string): AreaDetailWire | undefined {
  const index = indexTree(tree);
  const resolved = index.resolve(ref);
  const area = resolved?.type === "area"
    ? resolved
    : index.entries.find(({ node, root }) => root === "product" && node.type === "area" && node.slug === ref)?.node;
  if (!area || area.type !== "area") return undefined;

  const map = buildProductMap(tree, undefined);
  const section = map.areas.find((a) => a.id === area.id);
  if (!section) return undefined;

  // The nodes this area owns: itself and every product node whose nearest area it is.
  const parentOf = new Map(index.entries.map((e) => [e.node.id, e.parent]));
  const nearestArea = (id: string): string | undefined => {
    for (let p = parentOf.get(id); p; p = parentOf.get(p.id)) if (p.type === "area") return p.id;
    return undefined;
  };
  const owned = new Set([area.id]);
  for (const { node, root } of index.entries) {
    if (root === "product" && node.type !== "area" && nearestArea(node.id) === area.id) owned.add(node.id);
  }
  // Applied history only: an applied addition's target names the node it made.
  const relatesHere = (change: ChangeRuleNode): boolean =>
    (change.amends ?? []).some((a) => owned.has(index.resolve(a.target)?.id ?? "")) ||
    (change.touches ?? []).some((t) => owned.has(index.resolve(t)?.id ?? ""));
  // Moving now lists the badge's open changes (openChangesByArea), so the map,
  // this card and Open changes' ?area= filter cannot disagree.
  const movingHere = new Set(section.openChangeIds);
  const deltaHere = (change: ChangeRuleNode) => (change.amends ?? []).find((a) => {
    const ref = a.delta === "added" ? a.under : a.target;
    return ref !== undefined && owned.has(index.resolve(ref)?.id ?? "");
  })?.delta;

  const edges = computeEdges(tree);
  const bound = new Set([area.id, ...section.capabilities.map((c) => c.id)].flatMap((id) => edges.boundBy[id] ?? []));
  const constraints = map.constraints.filter((c) => bound.has(c.id));

  const changes = changesOf(index);
  // One batch: rex builds its placement inputs once, not once per Inbox change.
  const guesses = suggestPlacements(
    tree,
    changes.filter((c) => !isAppliedChange(c) && isOpenChange(c) && awaitsPlacement(index, c)).map((c) => c.id),
  );
  const openChanges: OpenChangeOverlayWire[] = [];
  const inbox: AreaInboxGuessWire[] = [];
  const applied: ChangeRuleNode[] = [];
  for (const change of changes) {
    const brief = { id: change.id, ...(change.displayId ? { displayId: change.displayId } : {}), title: change.title };
    if (isAppliedChange(change)) {
      if (relatesHere(change)) applied.push(change);
      continue;
    }
    if (!isOpenChange(change)) continue;
    if (movingHere.has(change.id)) {
      const delta = deltaHere(change);
      openChanges.push({ ...brief, stage: stageOf(change), ...(delta ? { delta } : {}) });
    }
    const guess = guesses.get(change.id);
    if (guess) {
      if ("error" in guess) continue;
      const { suggestion } = guess;
      const top = suggestion.shortlist[0];
      const target = top ? index.resolve(top.target) : undefined;
      if (target && (target.type === "capability" || target.type === "constraint") && owned.has(target.id)) {
        inbox.push({ ...brief, target: { id: target.id, title: target.title, type: target.type }, relation: suggestion.relation, strength: suggestion.tied ? "tied" : top.strength });
      }
    }
  }
  const recentlyApplied = applied
    .sort((a, b) => (b.appliedAt ?? "").localeCompare(a.appliedAt ?? ""))
    .slice(0, RECENT_APPLIED_LIMIT)
    .map((change) => ({
      id: change.id,
      ...(change.displayId ? { displayId: change.displayId } : {}),
      title: change.title,
      ...(change.appliedAt ? { appliedAt: change.appliedAt } : {}),
      ...(change.shippedIn ? { shippedIn: change.shippedIn } : {}),
    }));

  const code = section.capabilities.flatMap((c) => {
    const files = index.resolve(c.id)?.realizedBy;
    return Array.isArray(files) ? files.filter((f): f is string => typeof f === "string").map((path) => ({ capabilityId: c.id, path })) : [];
  });

  const caps = section.capabilities;
  return {
    id: section.id,
    slug: section.slug,
    ...(section.displayId ? { displayId: section.displayId } : {}),
    title: section.title,
    ...(section.summary ? { summary: section.summary } : {}),
    stewards: section.stewards ?? [],
    counts: {
      capabilities: caps.filter((c) => c.status !== "retired").length,
      constraints: constraints.length,
      met: caps.filter((c) => c.status === "met").length,
      changing: caps.filter((c) => c.status === "changing").length,
      defective: [...caps, ...constraints].filter((n) => n.health === "defective").length,
      openChanges: openChanges.length,
    },
    capabilities: caps,
    constraints,
    openChanges,
    inbox,
    recentlyApplied,
    code,
  };
}

// ── Routes ───────────────────────────────────────────────────────────

const CAPABILITY_PREFIX = "product/capability/";
const AREA_PREFIX = "product/area/";

/** Handle the v2 product reads. Returns false when the path is not one of them. */
export function routeProductReads(
  path: string,
  method: string,
  res: ServerResponse,
  ctx: ServerContext,
): boolean | Promise<boolean> {
  if (method !== "GET") return false;
  const capabilityRef = path.startsWith(CAPABILITY_PREFIX) ? decodeURIComponent(path.slice(CAPABILITY_PREFIX.length)) : undefined;
  const areaRef = path.startsWith(AREA_PREFIX) ? decodeURIComponent(path.slice(AREA_PREFIX.length)) : undefined;
  if (path !== "product" && path !== "changes" && path !== "changes/summary" && !capabilityRef && !areaRef) return false;

  return (async () => {
    if ((await prdLayout(ctx.rexDir)) !== "v2") {
      jsonResponse(res, 200, { layout: "v1" });
      return true;
    }
    let model: Awaited<ReturnType<typeof loadPrdModel>>;
    try {
      model = await loadPrdModel(ctx.rexDir);
    } catch (err) {
      // A schema skew or an unreadable tree: say so rather than render an empty map.
      errorResponse(res, 500, (err as Error).message);
      return true;
    }
    if (path === "product") {
      jsonResponse(res, 200, { layout: "v2", map: buildProductMap(model.tree, model.header) });
    } else if (path === "changes") {
      jsonResponse(res, 200, { layout: "v2", changes: buildChangeRows(model.tree) });
    } else if (path === "changes/summary") {
      const holder = resolveClaimHolder(ctx.projectDir);
      const claimed = await openClaimsStore(ctx.projectDir).claimedElsewhere(holder.worktreeRoot);
      jsonResponse(res, 200, { layout: "v2", summary: buildChangeSummary(model.tree, new Set(claimed.keys())) });
    } else if (areaRef) {
      const area = buildAreaDetail(model.tree, areaRef);
      if (area) jsonResponse(res, 200, { layout: "v2", area });
      else errorResponse(res, 404, `"${areaRef}" names no live area.`);
    } else {
      const capability = buildCapabilityDetail(model.tree, capabilityRef!);
      if (capability) jsonResponse(res, 200, { layout: "v2", capability });
      else errorResponse(res, 404, `"${capabilityRef}" names no live capability.`);
    }
    return true;
  })();
}

// ── Direct edit ──────────────────────────────────────────────────────

/** The body of `POST /api/rex/product/edit` (the viewer's `ProductEdit`). */
interface ProductEditBody {
  id: string;
  statement: string;
  criteria: Array<{ id: string; text: string }>;
  editorial: boolean;
}

function parseEditBody(raw: string): ProductEditBody | string {
  let body: Partial<ProductEditBody> | null;
  try {
    body = JSON.parse(raw || "{}") as Partial<ProductEditBody> | null;
  } catch {
    return "Request body must be JSON.";
  }
  if (!body || typeof body.id !== "string" || !body.id) return "Missing required field: id";
  if (typeof body.statement !== "string" || !body.statement.trim()) return "Missing required field: statement";
  const criteria = body.criteria ?? [];
  if (!Array.isArray(criteria) || !criteria.every((c) => c && typeof c.id === "string" && typeof c.text === "string")) {
    return "criteria must be an array of { id, text }";
  }
  // As `rex product edit` does: text is trimmed, and an empty criterion is refused rather than written.
  const trimmed = criteria.map((c) => ({ id: c.id, text: c.text.trim() }));
  const empty = trimmed.find((c) => !c.text);
  if (empty) return `Criterion ${empty.id} is empty.`;
  return { id: body.id, statement: body.statement, criteria: trimmed, editorial: body.editorial === true };
}

/**
 * Apply a direct edit to a capability's statement and its own criteria's text.
 * Criteria are matched by id and never added or removed here; an id the
 * capability does not own is refused rather than dropped.
 */
async function handleProductEditRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const parsed = parseEditBody(await readBody(req, res));
  if (typeof parsed === "string") {
    errorResponse(res, 400, parsed);
    return true;
  }
  if ((await prdLayout(ctx.rexDir)) !== "v2") {
    errorResponse(res, 409, "This project's PRD uses the v1 layout, which has no product layer to edit. Migrate it first.");
    return true;
  }

  try {
    const now = new Date();
    const { result } = await withPrdModelTransaction(ctx.rexDir, (model) => {
      const tree = structuredClone(model.tree);
      const node = indexTree(tree).resolve(parsed.id);
      if (!node || node.type !== "capability") {
        throw new ProductEditError(parsed.id, "not a live capability");
      }
      const before = { statement: node.statement, criteria: structuredClone(node.criteria) };
      node.statement = parsed.statement.trim();
      for (const edit of parsed.criteria) {
        const criterion = node.criteria?.find((c) => c.id === edit.id);
        if (!criterion) throw new ProductEditError(parsed.id, `it has no criterion ${edit.id}`);
        criterion.text = edit.text;
      }
      const handled = handleProductEdit(tree, node.id, before, { editorial: parsed.editorial, now });
      return {
        tree: handled.tree,
        result: { id: node.id, outcome: handled.outcome, drafts: handled.drafts.map((d) => ({ id: d.id, title: d.title })) },
      };
    });
    appendLog(ctx, { timestamp: now.toISOString(), event: "product_edited", itemId: result.id, detail: result.outcome });
    const model = await loadPrdModel(ctx.rexDir);
    jsonResponse(res, 200, {
      layout: "v2",
      outcome: result.outcome,
      drafts: result.drafts,
      capability: buildCapabilityDetail(model.tree, result.id),
    });
    broadcast?.({ type: "rex:prd-changed", timestamp: now.toISOString() });
  } catch (err) {
    // The lock failure names the holder's PID; pass it through.
    const message = errorMessage(err);
    const refused = err instanceof ProductEditError || message.includes("Could not acquire PRD lock");
    errorResponse(res, refused ? 409 : 500, message);
  }
  return true;
}

/** Handle `POST product/edit`. Returns false when the path is not it. */
export function routeProductEdit(
  path: string,
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  if (method !== "POST" || path !== "product/edit") return false;
  return handleProductEditRoute(req, res, ctx, broadcast);
}
