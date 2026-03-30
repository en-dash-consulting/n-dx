/**
 * Louvain community detection for zone analysis.
 *
 * Identifies natural architectural boundaries (zones) from the import graph
 * using the Louvain modularity optimization algorithm. The algorithm groups
 * tightly-interconnected files into communities while minimizing cross-group
 * edges, mirroring how developers naturally organize code.
 *
 * ## Why Louvain works for codebases
 *
 * Import graphs exhibit strong community structure: files within a feature
 * or package import each other frequently but rarely reach across boundaries.
 * Louvain detects this automatically, producing zones that match intuitive
 * architectural groupings without any configuration.
 *
 * ## Cohesion scoring
 *
 * When the algorithm finds zones with cohesion 1.0 and coupling 0.0, it means
 * all import edges for that zone's files stay within the zone — a sign of
 * excellent encapsulation. This typically happens with well-structured packages
 * that expose clean public interfaces.
 *
 * Zones where multiple files have **no** import edges at all receive cohesion
 * 0.0 — the absence of edges means cohesion is unmeasurable, not perfect.
 * Single-file zones are the exception: cohesion is trivially 1.0.
 *
 * ## Pipeline
 *
 * 1. {@link buildUndirectedGraph} — convert directed imports to weighted edges
 * 2. {@link louvainPhase1} — modularity optimization (deterministic)
 * 3. {@link mergeBidirectionalCoupling} — combine over-coupled communities
 * 4. {@link mergeSmallCommunities} — absorb tiny fragments into neighbors
 * 5. {@link capZoneCount} — enforce maximum zone limit
 * 6. {@link splitLargeCommunities} — subdivide oversized communities
 *
 * All steps are deterministic: same import graph → same zones every time.
 *
 * @module
 */

import type { ImportEdge } from "../schema/index.js";

// ── Graph types ─────────────────────────────────────────────────────────────

/** Adjacency map: node → neighbor → weight */
export type UndirectedGraph = Map<string, Map<string, number>>;

// ── Build undirected graph ──────────────────────────────────────────────────

/**
 * Convert directed import edges into an undirected weighted graph.
 * Weight = number of symbols imported (min 1).
 */
export function buildUndirectedGraph(edges: ImportEdge[]): UndirectedGraph {
  const graph: UndirectedGraph = new Map();

  function ensureNode(n: string): Map<string, number> {
    let neighbors = graph.get(n);
    if (!neighbors) {
      neighbors = new Map();
      graph.set(n, neighbors);
    }
    return neighbors;
  }

  function addEdge(a: string, b: string, weight: number): void {
    const na = ensureNode(a);
    const nb = ensureNode(b);
    na.set(b, (na.get(b) ?? 0) + weight);
    nb.set(a, (nb.get(a) ?? 0) + weight);
  }

  for (const edge of edges) {
    const weight = Math.max(edge.symbols.length, 1);
    addEdge(edge.from, edge.to, weight);
  }

  return graph;
}

// ── Louvain phase 1 ─────────────────────────────────────────────────────────

/**
 * Louvain modularity optimization (phase 1).
 * Returns a map of node → community ID.
 *
 * Deterministic: nodes processed in sorted order, ties broken lexicographically.
 */
export function louvainPhase1(
  graph: UndirectedGraph,
  maxPasses = 100,
  resolution = 1.0,
  /** Seed community assignment from a previous run. Files not in the seed
   *  start in their own community. Files in the seed start in their previous
   *  community and only move when modularity gain justifies it. */
  seed?: Map<string, string>,
): Map<string, string> {
  // Seed from previous assignment or start each node in its own community
  const community = new Map<string, string>();
  for (const node of graph.keys()) {
    const prev = seed?.get(node);
    community.set(node, prev ?? node);
  }

  // Total weight of all edges (each undirected edge counted once per direction,
  // so sum of all adjacency weights / 2)
  let totalWeight = 0;
  for (const neighbors of graph.values()) {
    for (const w of neighbors.values()) {
      totalWeight += w;
    }
  }
  totalWeight /= 2;

  if (totalWeight === 0) return community;

  const m2 = 2 * totalWeight; // 2m used in modularity formula

  // Weighted degree of each node
  const degree = new Map<string, number>();
  for (const [node, neighbors] of graph) {
    let d = 0;
    for (const w of neighbors.values()) d += w;
    degree.set(node, d);
  }

  // Sum of degrees in each community (aggregated when seeded)
  const communityDegreeSum = new Map<string, number>();
  for (const [node, d] of degree) {
    const comm = community.get(node)!;
    communityDegreeSum.set(comm, (communityDegreeSum.get(comm) ?? 0) + d);
  }

  // Sorted nodes for determinism
  const sortedNodes = [...graph.keys()].sort();

  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;

    for (const node of sortedNodes) {
      const nodeDegree = degree.get(node)!;
      const currentCommunity = community.get(node)!;

      // Sum of edge weights from node to each neighboring community
      const neighborCommunityWeights = new Map<string, number>();
      const neighbors = graph.get(node)!;
      for (const [neighbor, weight] of neighbors) {
        const nc = community.get(neighbor)!;
        neighborCommunityWeights.set(
          nc,
          (neighborCommunityWeights.get(nc) ?? 0) + weight
        );
      }

      // Weight to own community
      const weightToOwnCommunity =
        neighborCommunityWeights.get(currentCommunity) ?? 0;

      // Remove node from its community for ΔQ calculation
      const ownCommunityDegreeWithout =
        communityDegreeSum.get(currentCommunity)! - nodeDegree;

      let bestDeltaQ = 0;
      let bestCommunity = currentCommunity;

      // Check each neighboring community
      for (const [candidateCommunity, weightToCandidate] of neighborCommunityWeights) {
        if (candidateCommunity === currentCommunity) continue;

        const candidateDegreeSum = communityDegreeSum.get(candidateCommunity)!;

        // ΔQ = [weight_to_candidate/m - γ * nodeDegree * candidateDegreeSum / (2m²)]
        //     - [weight_to_own/m - γ * nodeDegree * ownCommunityDegreeWithout / (2m²)]
        // resolution γ > 1 penalises large communities → smaller zones.
        const deltaQ =
          (weightToCandidate - weightToOwnCommunity) / m2 -
          resolution * (nodeDegree * (candidateDegreeSum - ownCommunityDegreeWithout)) /
            (m2 * m2) * 2;

        if (
          deltaQ > bestDeltaQ ||
          (deltaQ === bestDeltaQ &&
            deltaQ > 0 &&
            candidateCommunity < bestCommunity)
        ) {
          bestDeltaQ = deltaQ;
          bestCommunity = candidateCommunity;
        }
      }

      if (bestCommunity !== currentCommunity) {
        // Move node to best community
        communityDegreeSum.set(
          currentCommunity,
          communityDegreeSum.get(currentCommunity)! - nodeDegree
        );
        communityDegreeSum.set(
          bestCommunity,
          (communityDegreeSum.get(bestCommunity) ?? 0) + nodeDegree
        );
        community.set(node, bestCommunity);
        moved = true;
      }
    }

    if (!moved) break;
  }

  return community;
}

// ── Merge small communities ─────────────────────────────────────────────────

/**
 * Communities with fewer than `minSize` files get absorbed into
 * their most-connected neighbor community.
 */
/** Log entries from mergeSmallCommunities for debuggability */
export interface MergeLogEntry {
  smallCommunity: string;
  memberCount: number;
  mergedInto: string;
  importWeight: number;
}

export function mergeSmallCommunities(
  community: Map<string, string>,
  graph: UndirectedGraph,
  minSize = 3,
  mergeLog?: MergeLogEntry[],
): Map<string, string> {
  const result = new Map(community);

  // Gather community → members
  function getCommunityMembers(): Map<string, string[]> {
    const members = new Map<string, string[]>();
    for (const [node, comm] of result) {
      let list = members.get(comm);
      if (!list) {
        list = [];
        members.set(comm, list);
      }
      list.push(node);
    }
    return members;
  }

  // Iterate until stable (small communities may chain-merge)
  for (let iter = 0; iter < 50; iter++) {
    const members = getCommunityMembers();
    let merged = false;

    // Process small communities in sorted order for determinism
    const sortedCommunities = [...members.entries()]
      .filter(([, m]) => m.length < minSize)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    for (const [smallComm, smallMembers] of sortedCommunities) {
      // Re-check size (may have grown from previous merge in this iteration)
      const currentMembers = getCommunityMembers().get(smallComm);
      if (!currentMembers || currentMembers.length >= minSize) continue;

      // Find neighboring community with highest total weight
      const neighborWeight = new Map<string, number>();
      for (const node of currentMembers) {
        const neighbors = graph.get(node);
        if (!neighbors) continue;
        for (const [neighbor, weight] of neighbors) {
          const nc = result.get(neighbor)!;
          if (nc === smallComm) continue;
          neighborWeight.set(nc, (neighborWeight.get(nc) ?? 0) + weight);
        }
      }

      if (neighborWeight.size === 0) continue; // isolated small cluster

      // Find best neighbor (highest weight, tie-break lexicographic)
      let bestNeighbor = "";
      let bestWeight = -1;
      for (const [nc, w] of neighborWeight) {
        if (w > bestWeight || (w === bestWeight && nc < bestNeighbor)) {
          bestNeighbor = nc;
          bestWeight = w;
        }
      }

      // Merge: reassign all members to the best neighbor community
      if (mergeLog) {
        mergeLog.push({
          smallCommunity: smallComm,
          memberCount: currentMembers.length,
          mergedInto: bestNeighbor,
          importWeight: bestWeight,
        });
      }
      for (const node of currentMembers) {
        result.set(node, bestNeighbor);
      }
      merged = true;
    }

    if (!merged) break;
  }

  return result;
}

// ── Merge bidirectionally coupled communities ───────────────────────────────

/**
 * Merge communities that are bidirectionally over-coupled.
 *
 * For each pair of communities, compute:
 *   crossEdges(A, B) / min(internalEdges(A), internalEdges(B))
 *
 * If this ratio exceeds `threshold`, the smaller community is absorbed
 * into the larger one. Single pass, conservative — only merges clearly
 * over-coupled pairs.
 */
export function mergeBidirectionalCoupling(
  community: Map<string, string>,
  graph: UndirectedGraph,
  threshold = 0.4
): Map<string, string> {
  const result = new Map(community);

  // Gather community → members
  const members = new Map<string, string[]>();
  for (const [node, comm] of result) {
    let list = members.get(comm);
    if (!list) {
      list = [];
      members.set(comm, list);
    }
    list.push(node);
  }

  // Compute internal edge count per community and cross-edge counts per pair
  const internalEdges = new Map<string, number>();
  const crossEdges = new Map<string, number>(); // "commA\x01commB" → count (A < B)

  for (const [node, neighbors] of graph) {
    const nodeComm = result.get(node)!;
    for (const [neighbor] of neighbors) {
      const neighborComm = result.get(neighbor)!;
      if (nodeComm === neighborComm) {
        internalEdges.set(nodeComm, (internalEdges.get(nodeComm) ?? 0) + 1);
      } else {
        const key =
          nodeComm < neighborComm
            ? `${nodeComm}\x01${neighborComm}`
            : `${neighborComm}\x01${nodeComm}`;
        crossEdges.set(key, (crossEdges.get(key) ?? 0) + 1);
      }
    }
  }

  // Each internal edge is counted twice (once per direction in undirected graph)
  for (const [comm, count] of internalEdges) {
    internalEdges.set(comm, count / 2);
  }
  // Cross edges are also counted twice
  for (const [pair, count] of crossEdges) {
    crossEdges.set(pair, count / 2);
  }

  // Find pairs exceeding threshold, sorted by ratio descending for determinism
  const mergeCandidates: Array<{ commA: string; commB: string; ratio: number }> = [];

  for (const [pair, cross] of crossEdges) {
    const [commA, commB] = pair.split("\x01");
    const intA = internalEdges.get(commA) ?? 0;
    const intB = internalEdges.get(commB) ?? 0;
    const minInternal = Math.min(intA, intB);
    if (minInternal === 0) continue; // avoid division by zero

    const ratio = cross / minInternal;
    if (ratio >= threshold) {
      mergeCandidates.push({ commA, commB, ratio });
    }
  }

  // Sort by ratio descending, then by pair name for determinism
  mergeCandidates.sort(
    (a, b) =>
      b.ratio - a.ratio ||
      a.commA.localeCompare(b.commA) ||
      a.commB.localeCompare(b.commB)
  );

  // Merge: smaller community into larger (single pass)
  const merged = new Set<string>();
  for (const { commA, commB } of mergeCandidates) {
    if (merged.has(commA) || merged.has(commB)) continue;

    const sizeA = members.get(commA)?.length ?? 0;
    const sizeB = members.get(commB)?.length ?? 0;
    const [source, target] =
      sizeA < sizeB || (sizeA === sizeB && commA > commB)
        ? [commA, commB]
        : [commB, commA];

    const sourceMembers = members.get(source);
    if (!sourceMembers) continue;

    for (const node of sourceMembers) {
      result.set(node, target);
    }

    // Update members tracking
    const targetMembers = members.get(target) ?? [];
    targetMembers.push(...sourceMembers);
    members.set(target, targetMembers);
    members.delete(source);
    merged.add(source);
  }

  return result;
}

// ── Merge satellite communities ──────────────────────────────────────────────

/**
 * Absorb small communities that are more coupled to their neighbors than
 * internally cohesive. These "satellites" are too small and too dependent
 * to justify a separate zone.
 *
 * For each community with ≤ `maxSize` files, compute:
 *   externalEdges / totalEdges (= coupling ratio)
 *
 * If this ratio exceeds `couplingThreshold`, the community is absorbed into
 * its most-connected neighbor. Iterates until no more merges occur.
 */
export function mergeSatelliteCommunities(
  community: Map<string, string>,
  graph: UndirectedGraph,
  maxSize = 8,
  couplingThreshold = 0.3
): Map<string, string> {
  const result = new Map(community);

  for (let round = 0; round < 10; round++) {
    // Gather community → members
    const members = new Map<string, string[]>();
    for (const [node, comm] of result) {
      let list = members.get(comm);
      if (!list) { list = []; members.set(comm, list); }
      list.push(node);
    }

    let merged = false;

    // Process small communities in sorted order for determinism
    const smallComms = [...members.entries()]
      .filter(([, m]) => m.length <= maxSize)
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [comm, commMembers] of smallComms) {
      // Skip if already merged in this round
      if (!members.has(comm)) continue;

      // Count internal vs external edges and track neighbor communities
      let internalEdgeCount = 0;
      let externalEdgeCount = 0;
      const neighborCommWeights = new Map<string, number>();

      for (const node of commMembers) {
        const neighbors = graph.get(node);
        if (!neighbors) continue;
        for (const [neighbor, weight] of neighbors) {
          const neighborComm = result.get(neighbor)!;
          if (neighborComm === comm) {
            internalEdgeCount += weight;
          } else {
            externalEdgeCount += weight;
            neighborCommWeights.set(
              neighborComm,
              (neighborCommWeights.get(neighborComm) ?? 0) + weight
            );
          }
        }
      }

      // Undirected: each edge counted twice
      internalEdgeCount /= 2;
      const totalEdges = internalEdgeCount + externalEdgeCount;
      if (totalEdges === 0) continue;

      const couplingRatio = externalEdgeCount / totalEdges;
      if (couplingRatio < couplingThreshold) continue;

      // Find the most-connected neighbor community
      let bestNeighbor = "";
      let bestWeight = 0;
      for (const [neighborComm, weight] of neighborCommWeights) {
        if (weight > bestWeight || (weight === bestWeight && neighborComm < bestNeighbor)) {
          bestNeighbor = neighborComm;
          bestWeight = weight;
        }
      }

      if (!bestNeighbor) continue;

      // Absorb into the best neighbor
      for (const node of commMembers) {
        result.set(node, bestNeighbor);
      }

      // Update members tracking
      const targetMembers = members.get(bestNeighbor) ?? [];
      targetMembers.push(...commMembers);
      members.set(bestNeighbor, targetMembers);
      members.delete(comm);
      merged = true;
    }

    if (!merged) break;
  }

  return result;
}

// ── Split large communities ──────────────────────────────────────────────────

/**
 * Split communities that exceed `maxSize` files by running Louvain
 * internally on their subgraph with increasing resolution (γ).
 *
 * Standard Louvain (γ=1) has a resolution limit that prevents it from
 * finding sub-communities inside dense, uniformly-connected subgraphs —
 * exactly what happens when routes → components → utils form one big
 * cluster. Increasing γ penalises large communities, forcing splits.
 *
 * Iterates until no oversized communities remain or no further splits
 * are possible. Deterministic: processes communities in sorted order.
 */
export function splitLargeCommunities(
  community: Map<string, string>,
  graph: UndirectedGraph,
  maxSize: number
): Map<string, string> {
  const result = new Map(community);

  // Track communities that resisted splitting so we don't retry them
  const unsplittable = new Set<string>();

  for (let round = 0; round < 10; round++) {
    // Gather community → members
    const members = new Map<string, string[]>();
    for (const [node, comm] of result) {
      let list = members.get(comm);
      if (!list) { list = []; members.set(comm, list); }
      list.push(node);
    }

    // Find oversized communities we haven't already failed to split
    const oversized = [...members.entries()]
      .filter(([comm, m]) => m.length > maxSize && !unsplittable.has(comm))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    if (oversized.length === 0) break;

    let splitAny = false;

    for (const [comm, commMembers] of oversized) {
      // Build subgraph containing only nodes in this community
      const memberSet = new Set(commMembers);
      const subGraph: UndirectedGraph = new Map();

      for (const node of commMembers) {
        const neighbors = graph.get(node);
        if (!neighbors) continue;

        const subNeighbors = new Map<string, number>();
        for (const [neighbor, weight] of neighbors) {
          if (memberSet.has(neighbor)) {
            subNeighbors.set(neighbor, weight);
          }
        }
        if (subNeighbors.size > 0) {
          subGraph.set(node, subNeighbors);
        }
      }

      // Ensure all member nodes exist in the subgraph (even if isolated)
      for (const node of commMembers) {
        if (!subGraph.has(node)) {
          subGraph.set(node, new Map());
        }
      }

      // Try increasing resolution until the community splits
      let subCommunity: Map<string, string> | null = null;
      for (const γ of [1, 2, 4, 8]) {
        let attempt = louvainPhase1(subGraph, 100, γ);
        attempt = mergeSmallCommunities(attempt, subGraph);
        const subComms = new Set(attempt.values());
        if (subComms.size > 1) {
          subCommunity = attempt;
          break;
        }
      }

      if (!subCommunity) {
        // Fallback: split by directory structure
        subCommunity = splitByDirectory(commMembers, maxSize);
        if (!subCommunity || new Set(subCommunity.values()).size <= 1) {
          unsplittable.add(comm);
          continue;
        }
      }

      // Apply sub-community assignments: use "parentComm\0subComm" as new ID
      for (const [node, subComm] of subCommunity) {
        result.set(node, `${comm}\0${subComm}`);
      }
      splitAny = true;
    }

    if (!splitAny) break;
  }

  return result;
}

// ── Directory proximity edges ────────────────────────────────────────────────

/**
 * Add chain-topology edges between files sharing a parent directory.
 *
 * Groups files by immediate parent directory, sorts each group, then adds
 * edges between sorted adjacent pairs. This brings import-isolated files
 * (configs, scripts, etc.) into the Louvain graph and gives the algorithm
 * directory-structure awareness — critical for convention-based frameworks
 * where directory layout defines architecture.
 *
 * Chain topology produces O(n) edges per directory (vs O(n²) for clique),
 * providing enough signal without overwhelming import-based edge weights.
 *
 * @param weight - Edge weight for proximity edges (default 0.2).
 *   Low enough to not override import edges (weight ≥1) but high enough
 *   to influence clustering of otherwise-disconnected files.
 */
export function addDirectoryProximityEdges(
  graph: UndirectedGraph,
  files: string[],
  weight = 0.2
): void {
  // Group files by immediate parent directory
  const dirGroups = new Map<string, string[]>();
  for (const file of files) {
    const lastSlash = file.lastIndexOf("/");
    const dir = lastSlash === -1 ? "." : file.slice(0, lastSlash);
    let group = dirGroups.get(dir);
    if (!group) {
      group = [];
      dirGroups.set(dir, group);
    }
    group.push(file);
  }

  function ensureNode(n: string): Map<string, number> {
    let neighbors = graph.get(n);
    if (!neighbors) {
      neighbors = new Map();
      graph.set(n, neighbors);
    }
    return neighbors;
  }

  for (const [, group] of dirGroups) {
    if (group.length < 2) {
      // Single-file directories: still ensure the node exists in graph
      if (group.length === 1) ensureNode(group[0]);
      continue;
    }

    group.sort();

    for (let i = 0; i < group.length - 1; i++) {
      const a = group[i];
      const b = group[i + 1];
      const na = ensureNode(a);
      const nb = ensureNode(b);
      // Only add if no edge exists yet (don't inflate existing import edges)
      if (!na.has(b)) {
        na.set(b, weight);
        nb.set(a, weight);
      }
    }
  }
}

// ── Cap zone count ──────────────────────────────────────────────────────────

export function capZoneCount(
  community: Map<string, string>,
  graph: UndirectedGraph,
  maxZones: number
): Map<string, string> {
  const result = new Map(community);

  for (let iter = 0; iter < 100; iter++) {
    // Count communities
    const members = new Map<string, string[]>();
    for (const [node, comm] of result) {
      let list = members.get(comm);
      if (!list) {
        list = [];
        members.set(comm, list);
      }
      list.push(node);
    }

    if (members.size <= maxZones) break;

    // Find the pair of communities with the strongest connection
    const communityPairWeight = new Map<string, number>();
    for (const [node, neighbors] of graph) {
      const nodeComm = result.get(node)!;
      for (const [neighbor, weight] of neighbors) {
        const neighborComm = result.get(neighbor)!;
        if (nodeComm === neighborComm) continue;
        const key =
          nodeComm < neighborComm
            ? `${nodeComm}\x01${neighborComm}`
            : `${neighborComm}\x01${nodeComm}`;
        communityPairWeight.set(
          key,
          (communityPairWeight.get(key) ?? 0) + weight
        );
      }
    }

    // If no cross-community edges, merge the two smallest communities
    if (communityPairWeight.size === 0) {
      const sorted = [...members.entries()].sort(
        (a, b) => a[1].length - b[1].length || (a[0] < b[0] ? -1 : 1)
      );
      if (sorted.length < 2) break;
      const [smallComm] = sorted[0];
      const [targetComm] = sorted[1];
      for (const node of members.get(smallComm)!) {
        result.set(node, targetComm);
      }
      continue;
    }

    let bestPair = "";
    let bestWeight = -1;
    for (const [pair, w] of communityPairWeight) {
      if (w > bestWeight || (w === bestWeight && pair < bestPair)) {
        bestPair = pair;
        bestWeight = w;
      }
    }

    const [commA, commB] = bestPair.split("\x01");
    // Merge smaller into larger (tie-break lexicographic)
    const sizeA = members.get(commA)?.length ?? 0;
    const sizeB = members.get(commB)?.length ?? 0;
    const [source, target] =
      sizeA < sizeB || (sizeA === sizeB && commA > commB)
        ? [commA, commB]
        : [commB, commA];

    for (const node of members.get(source)!) {
      result.set(node, target);
    }
  }

  return result;
}

// ── Directory-based fallback splitting ───────────────────────────────────────

/**
 * Split files into communities based on directory structure.
 * Used as a fallback when Louvain cannot split an oversized community
 * (e.g., fully-connected import graph with no internal structure).
 *
 * Groups files by their directory prefix (depth 2, falling back to depth 3
 * if all files share the same depth-2 prefix). Returns null if files cannot
 * be meaningfully split by directory.
 */
export function splitByDirectory(
  files: string[],
  _maxSize: number,
): Map<string, string> | null {
  // Group files by depth-2 directory prefix (e.g., "app/components", "app/lib")
  let dirGroups = groupByPrefix(files, 2);

  // If everything is in one group, try deeper
  if (dirGroups.size <= 1) {
    dirGroups = groupByPrefix(files, 3);
  }

  if (dirGroups.size <= 1) return null;

  // Reject splits where most groups are singletons — not a meaningful
  // directory-based split (e.g., root-level files with no directory structure)
  const meaningfulGroups = [...dirGroups.values()].filter((g) => g.length >= 2);
  if (meaningfulGroups.length < 2) return null;

  // Assign each directory group a community ID
  const result = new Map<string, string>();
  let communityIdx = 0;
  for (const [, group] of [...dirGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const commId = `dir-${communityIdx++}`;
    for (const file of group) {
      result.set(file, commId);
    }
  }
  return result;
}

function groupByPrefix(files: string[], depth: number): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.split("/");
    // Use directory segments only (exclude filename)
    const dirParts = parts.slice(0, -1);
    const key = dirParts.length >= depth
      ? dirParts.slice(0, depth).join("/")
      : dirParts.join("/") || parts[0];
    let list = groups.get(key);
    if (!list) { list = []; groups.set(key, list); }
    list.push(file);
  }
  return groups;
}
