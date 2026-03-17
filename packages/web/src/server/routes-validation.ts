/**
 * Validation & dependency graph API routes.
 *
 * GET  /api/rex/validate       — run validation checks on the PRD
 * GET  /api/rex/dependency-graph — compute dependency graph from blockedBy edges
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse } from "./types.js";
import {
  type ItemLevel,
  type PRDItem,
  type PRDDocument,
  LEVEL_HIERARCHY,
  isItemLevel,
  walkTree,
  findItem,
  collectAllIds,
} from "./rex-gateway.js";
import { loadPRDSync } from "./prd-io.js";

const VALIDATION_PREFIX = "/api/rex/validate";
const DEPGRAPH_PREFIX = "/api/rex/dependency-graph";

// ── Thin wrappers over canonical rex functions ───────────────────────
// The rex walkTree yields { item, parents[] }. Validation checks need
// parentLevel, so we derive it from the parents array.

/** Get the parent's level from a parents array (null for root items). */
function parentLevel(parents: PRDItem[]): ItemLevel | null {
  return parents.length > 0 ? parents[parents.length - 1].level : null;
}

/** Find an item by ID, returning just the item (or null). */
function findItemById(items: PRDItem[], id: string): PRDItem | null {
  const entry = findItem(items, id);
  return entry ? entry.item : null;
}

// ── Validation checks ────────────────────────────────────────────────

const DEFAULT_STUCK_THRESHOLD_MS = 48 * 60 * 60 * 1000;

interface CheckResult {
  name: string;
  pass: boolean;
  severity?: "error" | "warn";
  errors: Array<{
    message: string;
    itemId?: string;
    itemTitle?: string;
  }>;
}

interface OrphanResult {
  itemId: string;
  title: string;
  level: string;
  reason: string;
}

interface StuckResult {
  itemId: string;
  title: string;
  stuckSinceMs: number;
  reason: string;
}

function findOrphanedItems(items: PRDItem[]): OrphanResult[] {
  const orphans: OrphanResult[] = [];
  for (const { item, parents } of walkTree(items)) {
    if (!isItemLevel(item.level)) continue;
    const allowedParents = LEVEL_HIERARCHY[item.level];
    if (!allowedParents) continue;
    const pLevel = parentLevel(parents);
    if (!allowedParents.includes(pLevel)) {
      const placement = pLevel === null ? "root" : `under ${pLevel}`;
      const expected = allowedParents
        .map((l: ItemLevel | null) => (l === null ? "root" : l))
        .join(" or ");
      orphans.push({
        itemId: item.id,
        title: item.title,
        level: item.level,
        reason: `${item.level} at ${placement}, expected under ${expected}`,
      });
    }
  }
  return orphans;
}

function findCycles(items: PRDItem[]): string[][] {
  const allIds = collectAllIds(items);
  const cycles: string[][] = [];

  const adjacency = new Map<string, string[]>();
  for (const { item } of walkTree(items)) {
    if (item.blockedBy && item.blockedBy.length > 0) {
      adjacency.set(
        item.id,
        item.blockedBy.filter((dep) => allIds.has(dep)),
      );
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push(path.slice(cycleStart).concat(node));
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);

    for (const dep of adjacency.get(node) ?? []) {
      dfs(dep, [...path, node]);
    }

    inStack.delete(node);
  }

  for (const id of allIds) {
    if (!visited.has(id)) {
      dfs(id, []);
    }
  }

  return cycles;
}

function findStuckItems(items: PRDItem[], now?: number): StuckResult[] {
  const threshold = DEFAULT_STUCK_THRESHOLD_MS;
  const currentTime = now ?? Date.now();
  const stuck: StuckResult[] = [];

  for (const { item } of walkTree(items)) {
    if (item.status !== "in_progress") continue;

    if (!item.startedAt) {
      stuck.push({
        itemId: item.id,
        title: item.title,
        stuckSinceMs: 0,
        reason: "in_progress with no startedAt timestamp",
      });
      continue;
    }

    const started = new Date(item.startedAt).getTime();
    const elapsed = currentTime - started;

    if (elapsed > threshold) {
      const hours = Math.floor(elapsed / (60 * 60 * 1000));
      stuck.push({
        itemId: item.id,
        title: item.title,
        stuckSinceMs: elapsed,
        reason: `in_progress for ${hours}h (threshold: ${Math.floor(threshold / (60 * 60 * 1000))}h)`,
      });
    }
  }

  return stuck;
}

function validateDAG(items: PRDItem[]): { valid: boolean; errors: Array<{ message: string; itemId?: string }> } {
  const errors: Array<{ message: string; itemId?: string }> = [];
  const allIds = collectAllIds(items);

  // Check for duplicates
  const seenIds = new Map<string, number>();
  for (const { item } of walkTree(items)) {
    const count = seenIds.get(item.id) ?? 0;
    seenIds.set(item.id, count + 1);
  }
  for (const [id, count] of seenIds) {
    if (count > 1) {
      errors.push({ message: `Duplicate ID: "${id}" appears ${count} times`, itemId: id });
    }
  }

  // Check blockedBy references
  for (const { item } of walkTree(items)) {
    if (item.blockedBy) {
      for (const dep of item.blockedBy) {
        if (dep === item.id) {
          errors.push({ message: `Self-reference: "${item.id}" blocks itself`, itemId: item.id });
        } else if (!allIds.has(dep)) {
          errors.push({ message: `Orphan reference: "${item.id}" blocked by unknown "${dep}"`, itemId: item.id });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function runValidation(items: PRDItem[]): {
  ok: boolean;
  checks: CheckResult[];
  summary: { total: number; passed: number; failed: number; warnings: number };
} {
  const checks: CheckResult[] = [];

  // DAG integrity
  const dagResult = validateDAG(items);
  checks.push({
    name: "DAG integrity",
    pass: dagResult.valid,
    errors: dagResult.errors.map((e) => ({
      message: e.message,
      itemId: e.itemId,
      itemTitle: e.itemId ? findItemById(items, e.itemId)?.title : undefined,
    })),
  });

  // Hierarchy placement
  const orphans = findOrphanedItems(items);
  checks.push({
    name: "hierarchy placement",
    pass: orphans.length === 0,
    errors: orphans.map((o) => ({
      message: `${o.reason}`,
      itemId: o.itemId,
      itemTitle: o.title,
    })),
  });

  // Cycle detection
  const cycles = findCycles(items);
  checks.push({
    name: "blockedBy cycles",
    pass: cycles.length === 0,
    errors: cycles.map((c) => ({
      message: c.join(" \u2192 "),
      itemId: c[0],
      itemTitle: findItemById(items, c[0])?.title,
    })),
  });

  // Stuck tasks
  const stuckItems = findStuckItems(items);
  checks.push({
    name: "stuck tasks",
    pass: stuckItems.length === 0,
    severity: "warn",
    errors: stuckItems.map((s) => ({
      message: s.reason,
      itemId: s.itemId,
      itemTitle: s.title,
    })),
  });

  // Blocked without dependencies
  const blockedNoDeps: Array<{ message: string; itemId: string; itemTitle: string }> = [];
  for (const { item } of walkTree(items)) {
    if (item.status === "blocked" && (!item.blockedBy || item.blockedBy.length === 0)) {
      blockedNoDeps.push({
        message: `status is "blocked" but blockedBy is empty`,
        itemId: item.id,
        itemTitle: item.title,
      });
    }
  }
  if (blockedNoDeps.length > 0) {
    checks.push({
      name: "blocked item dependencies",
      pass: false,
      severity: "warn",
      errors: blockedNoDeps,
    });
  }

  const errorChecks = checks.filter((c) => !c.pass && c.severity !== "warn");
  const ok = errorChecks.length === 0;

  return {
    ok,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((c) => c.pass).length,
      failed: errorChecks.length,
      warnings: checks.filter((c) => !c.pass && c.severity === "warn").length,
    },
  };
}

// ── Dependency graph builder ─────────────────────────────────────────

interface GraphNode {
  id: string;
  title: string;
  level: string;
  status: string;
  /** IDs this node depends on (is blocked by). */
  blockedBy: string[];
}

interface GraphEdge {
  /** The blocking item (dependency). */
  source: string;
  /** The blocked item (dependent). */
  target: string;
  /** Whether the source item is completed. */
  resolved: boolean;
}

interface BlockingChain {
  /** The item at the end of the chain (deepest blocked). */
  itemId: string;
  /** Full chain from blocker to blocked. */
  path: string[];
}

interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Nodes involved in cycles (if any). */
  cycleNodeIds: string[];
  /** Longest blocking chains. */
  blockingChains: BlockingChain[];
  /** Items that are blocking the most other items. */
  criticalBlockers: Array<{ id: string; title: string; blockingCount: number }>;
}

function buildDependencyGraph(items: PRDItem[]): DependencyGraph {
  const allIds = collectAllIds(items);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeSet = new Set<string>();

  // Build adjacency: target -> sources (target is blocked by sources)
  const blockedByMap = new Map<string, string[]>();
  // Reverse: source -> targets (source blocks targets)
  const blocksMap = new Map<string, string[]>();

  for (const { item } of walkTree(items)) {
    if (item.blockedBy && item.blockedBy.length > 0) {
      const validDeps = item.blockedBy.filter((d) => allIds.has(d));
      if (validDeps.length === 0) continue;

      blockedByMap.set(item.id, validDeps);

      // Add target node
      if (!nodeSet.has(item.id)) {
        nodeSet.add(item.id);
        nodes.push({
          id: item.id,
          title: item.title,
          level: item.level,
          status: item.status,
          blockedBy: validDeps,
        });
      }

      for (const dep of validDeps) {
        // Add source node
        if (!nodeSet.has(dep)) {
          nodeSet.add(dep);
          const depItem = findItemById(items, dep);
          if (depItem) {
            nodes.push({
              id: depItem.id,
              title: depItem.title,
              level: depItem.level,
              status: depItem.status,
              blockedBy: depItem.blockedBy?.filter((d) => allIds.has(d)) ?? [],
            });
          }
        }

        // Add edge: source (blocker) -> target (blocked)
        const depItem = findItemById(items, dep);
        edges.push({
          source: dep,
          target: item.id,
          resolved: depItem?.status === "completed",
        });

        // Track blocks relationships
        if (!blocksMap.has(dep)) blocksMap.set(dep, []);
        blocksMap.get(dep)!.push(item.id);
      }
    }
  }

  // Find cycle nodes
  const cycles = findCycles(items);
  const cycleNodeIds = new Set<string>();
  for (const cycle of cycles) {
    for (const nodeId of cycle) {
      cycleNodeIds.add(nodeId);
    }
  }

  // Find longest blocking chains via DFS
  const blockingChains: BlockingChain[] = [];
  const chainVisited = new Set<string>();

  function findChains(nodeId: string, path: string[]): void {
    const blockers = blockedByMap.get(nodeId);
    if (!blockers || blockers.length === 0 || cycleNodeIds.has(nodeId)) {
      // End of chain — record if length > 1
      if (path.length > 1) {
        blockingChains.push({
          itemId: path[path.length - 1],
          path: [...path],
        });
      }
      return;
    }

    for (const blocker of blockers) {
      if (path.includes(blocker)) continue; // avoid cycles
      findChains(blocker, [blocker, ...path]);
    }
  }

  // Start from items that have blockers
  for (const [targetId] of blockedByMap) {
    if (!chainVisited.has(targetId)) {
      chainVisited.add(targetId);
      findChains(targetId, [targetId]);
    }
  }

  // Sort by chain length, keep top 10
  blockingChains.sort((a, b) => b.path.length - a.path.length);
  const topChains = blockingChains.slice(0, 10);

  // Critical blockers: items that block the most others
  const criticalBlockers = Array.from(blocksMap.entries())
    .map(([id, targets]) => ({
      id,
      title: findItemById(items, id)?.title ?? id,
      blockingCount: targets.length,
    }))
    .sort((a, b) => b.blockingCount - a.blockingCount)
    .slice(0, 10);

  return {
    nodes,
    edges,
    cycleNodeIds: [...cycleNodeIds],
    blockingChains: topChains,
    criticalBlockers,
  };
}

// ── Load PRD ─────────────────────────────────────────────────────────

function loadPRD(ctx: ServerContext): PRDDocument | null {
  return loadPRDSync(ctx.rexDir);
}

// ── Route handler ────────────────────────────────────────────────────

/** Handle validation and dependency graph API requests. Returns true if handled. */
export function handleValidationRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const url = req.url || "/";
  const method = req.method || "GET";

  // GET /api/rex/validate
  if (url.startsWith(VALIDATION_PREFIX) && method === "GET") {
    const doc = loadPRD(ctx);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }

    const result = runValidation(doc.items);
    jsonResponse(res, 200, result);
    return true;
  }

  // GET /api/rex/dependency-graph
  if (url.startsWith(DEPGRAPH_PREFIX) && method === "GET") {
    const doc = loadPRD(ctx);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }

    const graph = buildDependencyGraph(doc.items);
    jsonResponse(res, 200, graph);
    return true;
  }

  return false;
}
