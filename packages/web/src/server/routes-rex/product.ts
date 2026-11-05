/**
 * v2 product-layer reads: the Product page, the Changes view and the
 * capability page.
 *
 *   GET /api/rex/product                 → { layout: "v2", map }
 *   GET /api/rex/changes                 → { layout: "v2", changes }
 *   GET /api/rex/changes/summary         → { layout: "v2", summary }
 *   GET /api/rex/product/capability/<id> → { layout: "v2", capability }
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
  displayId?: string;
  title: string;
  summary?: string;
  stewards?: string[];
  capabilities: CapabilityRowWire[];
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
}

// ── Mapping ──────────────────────────────────────────────────────────

/** Applied changes the capability page lists; rex's page-size ceiling. */
const HISTORY_LIMIT = 100;

/**
 * A change's stage, the views' provisional vocabulary (see `ChangeStage` in
 * product-model.ts): shipped and applied from rex's state, then started, then
 * marked ready. Rex has no stage of its own to defer to.
 */
function stageOf(change: RuleNode): ChangeStageWire {
  if (change.shippedIn) return "shipped";
  if (isAppliedChange(change)) return "applied";
  // Completed but not applied: rex.applyOn is review or release, so only a steward's
  // apply (MCP, CLI) or a release stamp moves it on. The dashboard has no apply action.
  if (change.status === "completed") return "awaiting-apply";
  if (change.startedAt || change.status === "in_progress" || change.status === "failing") {
    return "in-progress";
  }
  return change.ready ? "ready" : "proposed";
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
    if (!isOpenChange(change)) continue;
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

function specReviewed(node: RuleNode): boolean {
  return !!node.reviewedHash && node.reviewedHash === specHash(nodeSpec(node));
}

/** The product map: every live area with its capabilities flattened, and every live constraint. */
export function buildProductMap(tree: V2Tree, header: Record<string, unknown> | undefined): ProductMapWire {
  const index = indexTree(tree);
  const overlays = overlaysByNode(index, changesOf(index));
  const report = productReport(tree);
  const areas: AreaSectionWire[] = [];
  const constraints: ConstraintRowWire[] = [];
  type ReportNode = ReturnType<typeof productReport>[number];

  const visit = (row: ReportNode, area: AreaSectionWire | undefined): void => {
    const node = index.resolve(row.id);
    if (row.type === "area") {
      const section: AreaSectionWire = {
        id: row.id,
        ...(row.displayId ? { displayId: row.displayId } : {}),
        title: row.title,
        ...(row.summary ? { summary: row.summary } : {}),
        ...(node?.type === "area" && node.stewards?.length ? { stewards: node.stewards } : {}),
        capabilities: [],
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
  return { inbox, stages, open, next };
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
  return changesOf(index)
    .filter((change) => isOpenChange(change) || isAppliedChange(change))
    .map((change) => {
      const tasks = tasksOf(change);
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
      };
    });
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
  };
}

// ── Routes ───────────────────────────────────────────────────────────

const CAPABILITY_PREFIX = "product/capability/";

/** Handle the v2 product reads. Returns false when the path is not one of them. */
export function routeProductReads(
  path: string,
  method: string,
  res: ServerResponse,
  ctx: ServerContext,
): boolean | Promise<boolean> {
  if (method !== "GET") return false;
  const capabilityRef = path.startsWith(CAPABILITY_PREFIX) ? decodeURIComponent(path.slice(CAPABILITY_PREFIX.length)) : undefined;
  if (path !== "product" && path !== "changes" && path !== "changes/summary" && !capabilityRef) return false;

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
