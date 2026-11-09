/**
 * The current branch's work set, for the Work page's "On this branch" list.
 *
 *   GET  /api/rex/work-set         → { branch, workSet, groups }
 *   POST /api/rex/work-set/add     { ids, move? } → assign_to_branch's report
 *   POST /api/rex/work-set/remove  { ids }        → assign_to_branch's remove report
 *
 * Rex owns the rule. The read is `findNextWorkTask`'s `workspace` form, the
 * call `ndx work` makes, so the list is exactly what a run would be narrowed
 * to. Add and Remove call rex's `handleAssignToBranch`, the handler MCP
 * `assign_to_branch` runs, which writes under the PRD lock and acts on the
 * checked-out branch only.
 *
 * `branch` is null on the default branch and a detached HEAD, which have no
 * work set; `workSet` is false there and on a branch nothing is assigned to.
 * A unit is `inherited` when it has no `delivery` of its own: it is on the
 * branch through its change.
 *
 * Refusals are 409 `{ error, code }`: `V1_LAYOUT`, `NO_WORK_SET_BRANCH` (default
 * branch or detached HEAD), `RUN_LIVE` (a run is live in this checkout, whose
 * checkout a write would change under it), `ON_ANOTHER_BRANCH` (a task is on
 * another branch; send `move` to take it) and `WORK_SET_REFUSED` (any other
 * refusal, such as an unknown or closed task). Empty or malformed `ids` is 400.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "../types.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import { jsonResponse, errorMessage, readBody } from "../response-utils.js";
import { refreshPRDCache } from "../prd-io.js";
import { repositoryRunSlotUsage } from "../routes-hench.js";
import {
  currentWorkSetBranch,
  findNextWorkTask,
  handleAssignToBranch,
  indexTree,
  loadPrdModel,
  prdLayout,
  resolveStore,
  type V2Tree,
} from "../rex-gateway.js";

// ── Wire types ───────────────────────────────────────────────────────

export interface WorkSetUnitWire {
  id: string;
  displayId?: string;
  title: string;
  status: string;
  /** On the branch through its change's assignment, not its own. */
  inherited: boolean;
}

export interface WorkSetGroupWire {
  change: { id: string; displayId?: string; title: string };
  units: WorkSetUnitWire[];
}

export interface WorkSetWire {
  branch: string | null;
  workSet: boolean;
  groups: WorkSetGroupWire[];
}

export type WorkSetRefusalCode = "V1_LAYOUT" | "NO_WORK_SET_BRANCH" | "RUN_LIVE" | "ON_ANOTHER_BRANCH" | "WORK_SET_REFUSED";

// ── Routes ───────────────────────────────────────────────────────────

const WORK_SET_PATH = "work-set";
const ADD_PATH = "work-set/add";
const REMOVE_PATH = "work-set/remove";

const NO_BRANCH_REFUSAL =
  "A work set belongs to a feature branch, and this checkout is on the default branch or a detached HEAD. Switch to a feature branch first.";
const V1_REFUSAL = "This project's PRD uses the v1 layout, which keeps no work sets. Migrate it first.";

export function routeWorkSet(
  path: string,
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  if (path === WORK_SET_PATH && method === "GET") return handleRead(res, ctx);
  if ((path === ADD_PATH || path === REMOVE_PATH) && method === "POST") return handleWrite(path === REMOVE_PATH, req, res, ctx, broadcast);
  return false;
}

async function handleRead(res: ServerResponse, ctx: ServerContext): Promise<boolean> {
  const branch = currentWorkSetBranch(ctx.projectDir);
  const none: WorkSetWire = { branch, workSet: false, groups: [] };
  if (branch === null || (await prdLayout(ctx.rexDir)) !== "v2") {
    jsonResponse(res, 200, none);
    return true;
  }
  try {
    const { tree } = await loadPrdModel(ctx.rexDir);
    const { workSet } = findNextWorkTask(tree, { workspace: ctx.projectDir });
    jsonResponse(res, 200, workSet ? { branch: workSet.branch, workSet: true, groups: groupUnits(tree, new Set(workSet.ids)) } : none);
  } catch (err) {
    jsonResponse(res, 500, { error: errorMessage(err) });
  }
  return true;
}

/** The units in `ids` grouped by their change, in tree order; a task-less change is its own only unit. */
function groupUnits(tree: V2Tree, ids: ReadonlySet<string>): WorkSetGroupWire[] {
  const groups = new Map<string, WorkSetGroupWire>();
  for (const { node, parent } of indexTree(tree).entries) {
    if (!ids.has(node.id)) continue;
    const owner = node.type === "task" && parent ? parent : node;
    let group = groups.get(owner.id);
    if (!group) {
      group = { change: { id: owner.id, ...(owner.displayId ? { displayId: owner.displayId } : {}), title: owner.title }, units: [] };
      groups.set(owner.id, group);
    }
    group.units.push({
      id: node.id,
      ...(node.displayId ? { displayId: node.displayId } : {}),
      title: node.title,
      status: node.status ?? "pending",
      inherited: node.delivery === undefined,
    });
  }
  return [...groups.values()];
}

function refuse(res: ServerResponse, code: WorkSetRefusalCode, error: string): true {
  jsonResponse(res, 409, { error, code });
  return true;
}

/** The body's `ids` and `move`, or why the body is refused. */
function parseBody(raw: string): { ids: string[]; move: boolean } | { error: string } {
  let body: unknown;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return { error: "Request body must be JSON." };
  }
  const { ids, move } = (body && typeof body === "object" ? body : {}) as { ids?: unknown; move?: unknown };
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string" && id !== "")) {
    return { error: "ids must be a non-empty array of change or task ids." };
  }
  return { ids: ids as string[], move: move === true };
}

async function handleWrite(
  remove: boolean,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const raw = await readBody(req, res);
  const body = parseBody(raw);
  if ("error" in body) {
    jsonResponse(res, 400, { error: body.error });
    return true;
  }
  if ((await prdLayout(ctx.rexDir)) !== "v2") return refuse(res, "V1_LAYOUT", V1_REFUSAL);
  if (currentWorkSetBranch(ctx.projectDir) === null) return refuse(res, "NO_WORK_SET_BRANCH", NO_BRANCH_REFUSAL);
  const { here } = await repositoryRunSlotUsage(ctx);
  if (here.length > 0) {
    const names = here.map((h) => (h.taskId ? `task ${h.taskId}` : "an untagged run")).join(", ");
    return refuse(res, "RUN_LIVE", `${names} is running in this checkout; a work set cannot change under a live run. Wait for it to end.`);
  }

  try {
    const result = await handleAssignToBranch(ctx.projectDir, ctx.rexDir, { ids: body.ids, ...(remove ? { remove: true } : { move: body.move }) });
    const text = result.content[0]?.text ?? "";
    if (result.isError) {
      // rex words this refusal; `move` is its only remedy, so the wording is the signal.
      return refuse(res, text.includes("pass move") ? "ON_ANOTHER_BRANCH" : "WORK_SET_REFUSED", text);
    }
    refreshPRDCache(ctx.rexDir, await (await resolveStore(ctx.rexDir)).loadDocument());
    broadcast?.({ type: "rex:prd-changed", timestamp: new Date().toISOString() });
    jsonResponse(res, 200, JSON.parse(text));
  } catch (err) {
    const message = errorMessage(err);
    jsonResponse(res, message.includes("Could not acquire PRD lock") ? 409 : 500, { error: message });
  }
  return true;
}
