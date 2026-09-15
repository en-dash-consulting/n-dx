import type { PRDItem } from "../schema/index.js";
import { walkTree, collectAllIds } from "./tree.js";

export interface DAGResult {
  valid: boolean;
  errors: string[];
}

/**
 * Find `blockedBy` cycles, as the id paths that close them.
 *
 * Split out of {@link validateDAG} because a cycle is the one dependency fault
 * that is unconditionally wrong wherever the items came from, while the others
 * are contextual. `rex import-bundle` needs exactly this check and must *not*
 * apply the orphan-reference one: a bundle's edge may point at an id that
 * lives in the destination tree rather than in the bundle, which a merge
 * resolves and a scoped export deliberately prunes.
 *
 * A self-reference (`x` blocked by `x`) is reported here as the one-element
 * cycle `x → x`. {@link validateDAG} still reports it separately as well, for
 * the clearer message.
 *
 * Traversal matches the original: the walk from a given start id stops at the
 * first cycle it closes, so a tangle reports one path rather than every
 * rotation of it.
 *
 * @returns one id path per cycle found, each ending where it began.
 */
export function findDependencyCycles(items: PRDItem[]): string[][] {
  const allIds = collectAllIds(items);

  const adjacency = new Map<string, string[]>();
  for (const { item } of walkTree(items)) {
    if (item.blockedBy && item.blockedBy.length > 0) {
      adjacency.set(item.id, item.blockedBy.filter((d) => allIds.has(d)));
    }
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): boolean {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push(path.slice(cycleStart).concat(node));
      return true;
    }
    if (visited.has(node)) return false;

    visited.add(node);
    inStack.add(node);

    for (const dep of adjacency.get(node) ?? []) {
      if (dfs(dep, [...path, node])) return true;
    }

    inStack.delete(node);
    return false;
  }

  for (const id of allIds) {
    if (!visited.has(id)) dfs(id, []);
  }

  return cycles;
}

export function validateDAG(items: PRDItem[]): DAGResult {
  const errors: string[] = [];

  // Collect all IDs, detect duplicates
  const seenIds = new Map<string, number>();
  for (const { item } of walkTree(items)) {
    const count = seenIds.get(item.id) ?? 0;
    seenIds.set(item.id, count + 1);
  }

  for (const [id, count] of seenIds) {
    if (count > 1) {
      errors.push(`Duplicate ID: "${id}" appears ${count} times`);
    }
  }

  const allIds = collectAllIds(items);

  // Check blockedBy references and self-references
  for (const { item } of walkTree(items)) {
    if (item.blockedBy) {
      for (const dep of item.blockedBy) {
        if (dep === item.id) {
          errors.push(`Self-reference: "${item.id}" blocks itself`);
        } else if (!allIds.has(dep)) {
          errors.push(
            `Orphan reference: "${item.id}" blocked by unknown "${dep}"`,
          );
        }
      }
    }
  }

  // DFS cycle detection on the blockedBy graph
  for (const cycle of findDependencyCycles(items)) {
    errors.push(`Cycle detected: ${cycle.join(" → ")}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
