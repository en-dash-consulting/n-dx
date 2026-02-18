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
 * ## Achieving perfect cohesion
 *
 * When the algorithm finds zones with cohesion 1.0 and coupling 0.0, it means
 * all import edges for that zone's files stay within the zone — a sign of
 * excellent encapsulation. This typically happens with well-structured packages
 * that expose clean public interfaces.
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
  maxPasses = 100
): Map<string, string> {
  // Each node starts in its own community (ID = node name)
  const community = new Map<string, string>();
  for (const node of graph.keys()) {
    community.set(node, node);
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

  // Sum of degrees in each community
  const communityDegreeSum = new Map<string, number>();
  for (const [node, d] of degree) {
    communityDegreeSum.set(node, d);
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

        // ΔQ = [weight_to_candidate/m - nodeDegree * candidateDegreeSum / (2m²)]
        //     - [weight_to_own/m - nodeDegree * ownCommunityDegreeWithout / (2m²)]
        const deltaQ =
          (weightToCandidate - weightToOwnCommunity) / m2 -
          (nodeDegree * (candidateDegreeSum - ownCommunityDegreeWithout)) /
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
export function mergeSmallCommunities(
  community: Map<string, string>,
  graph: UndirectedGraph,
  minSize = 3
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
  const crossEdges = new Map<string, number>(); // "commA\0commB" → count (A < B)

  for (const [node, neighbors] of graph) {
    const nodeComm = result.get(node)!;
    for (const [neighbor] of neighbors) {
      const neighborComm = result.get(neighbor)!;
      if (nodeComm === neighborComm) {
        internalEdges.set(nodeComm, (internalEdges.get(nodeComm) ?? 0) + 1);
      } else {
        const key =
          nodeComm < neighborComm
            ? `${nodeComm}\0${neighborComm}`
            : `${neighborComm}\0${nodeComm}`;
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
    const [commA, commB] = pair.split("\0");
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

// ── Split large communities ──────────────────────────────────────────────────

/**
 * Split communities that exceed `maxSize` files by running Louvain
 * internally on their subgraph. If subdivision produces only one
 * community (the zone is truly monolithic), the zone is left intact.
 *
 * Deterministic: processes communities in sorted order, applies
 * deterministic Louvain subdivision.
 */
export function splitLargeCommunities(
  community: Map<string, string>,
  graph: UndirectedGraph,
  maxSize: number
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

  // Process oversized communities in sorted order for determinism
  const oversized = [...members.entries()]
    .filter(([, m]) => m.length > maxSize)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

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

    // Run Louvain on the subgraph
    let subCommunity = louvainPhase1(subGraph);
    subCommunity = mergeSmallCommunities(subCommunity, subGraph);

    // Check if subdivision was meaningful (>1 community)
    const subComms = new Set(subCommunity.values());
    if (subComms.size <= 1) continue;

    // Apply sub-community assignments: use "parentComm\0subComm" as new ID
    // to avoid collisions with existing community IDs
    for (const [node, subComm] of subCommunity) {
      result.set(node, `${comm}\0${subComm}`);
    }
  }

  return result;
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
            ? `${nodeComm}\0${neighborComm}`
            : `${neighborComm}\0${nodeComm}`;
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

    const [commA, commB] = bestPair.split("\0");
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
