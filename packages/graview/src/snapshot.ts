/**
 * The projection: three sources merged into one snapshot.
 *
 * Node ids are n-dx's own (rex ids, zone ids, run ids, commit shas), so what
 * Graview answers can be taken straight back to the tool that owns it. Edges
 * whose far end is not in the snapshot are dropped, not invented: a change
 * that names a blocker the tree no longer has is rex's problem to report.
 * Everything is sorted before it is returned, so the same checkout projects
 * to the same bytes.
 */
import { join } from "node:path";
import { computeRealizedBy, type Realization } from "./rex-gateway.js";
import type { Layout } from "./llm-gateway.js";
import { readRequirements } from "./sources/requirements.js";
import { readCode } from "./sources/code.js";
import { readRuns } from "./sources/runs.js";
import { byString } from "./canonical.js";
import type { GraphSnapshot, SnapshotEdge, SnapshotNode, Warn } from "./types.js";

export interface BuildSnapshotOptions {
  /** Project every file in the inventory as a node. Off by default. */
  files?: boolean;
  /**
   * Where `computeRealizedBy` keeps its N-DX-Item trailer cache. Defaults to
   * `<graviewDir>/cache`, never rex's own cache directory: the projection
   * writes nothing under the rex, sourcevision or hench directories.
   */
  cacheDir?: string;
  warn?: Warn;
}

export interface SnapshotReport {
  snapshot: GraphSnapshot;
  /** Nodes per kind, and `edges` in all. */
  counts: Record<string, number>;
  warnings: string[];
  /** Which storage rex read: a v1 tree projects no product layer. */
  layout: "v1" | "v2";
}

/** Where the projection's own files go: the layout's graview dir. */
export function graviewDirOf(layout: Layout): string {
  return layout.graviewDir;
}

export async function buildSnapshot(layout: Layout, options: BuildSnapshotOptions = {}): Promise<SnapshotReport> {
  const warnings: string[] = [];
  const warn: Warn = (message) => {
    warnings.push(message);
    options.warn?.(message);
  };

  const requirements = await readRequirements(layout.rexDir, warn);
  const code = readCode(layout.sourcevisionDir, { files: options.files }, warn);
  const runs = readRuns(layout.henchDir, warn);

  const nodes = new Map<string, SnapshotNode>();
  const add = (node: SnapshotNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  for (const node of requirements.nodes) add(node);
  for (const node of code.nodes) add(node);
  for (const node of runs.nodes) add(node);

  const edges: SnapshotEdge[] = [...requirements.edges, ...code.edges, ...runs.edges];

  // Commits realize capabilities through their N-DX-Item trailers; the trailer
  // cache goes under the graview dir. Needs a git repository; without one the
  // graph simply has no realizes edges and says why.
  const hasCapabilities = requirements.nodes.some((n) => n.kind === "capability");
  if (hasCapabilities) {
    try {
      const realized: Record<string, Realization> = await computeRealizedBy(requirements.tree, requirements.productEdges, {
        repoDir: layout.root,
        cacheDir: options.cacheDir ?? join(graviewDirOf(layout), "cache"),
        zoneOf: code.zoneOf,
      });
      for (const [capabilityId, realization] of Object.entries(realized)) {
        for (const zone of realization.zones) edges.push({ kind: "realizedIn", from: capabilityId, to: zone });
        for (const sha of realization.commits) {
          add({ id: sha, kind: "commit", sha, subject: runs.commitSubjects.get(sha) || undefined });
          edges.push({ kind: "realizes", from: sha, to: capabilityId });
        }
      }
    } catch (error) {
      warn(`Realized-by edges skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Keep only edges with both ends present, once each.
  const seen = new Set<string>();
  const kept: SnapshotEdge[] = [];
  for (const edge of edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const key = `${edge.kind}\u0000${edge.from}\u0000${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(edge);
  }

  const sortedNodes = [...nodes.values()].sort((a, b) => byString(a.kind, b.kind) || byString(a.id, b.id));
  kept.sort((a, b) => byString(a.kind, b.kind) || byString(a.from, b.from) || byString(a.to, b.to));

  const counts: Record<string, number> = {};
  for (const node of sortedNodes) counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  counts.edges = kept.length;

  return {
    snapshot: { nodes: sortedNodes, edges: kept },
    counts,
    warnings,
    layout: requirements.model.layout,
  };
}
