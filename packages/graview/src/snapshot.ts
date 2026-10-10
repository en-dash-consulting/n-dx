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
import { computeRealizedBy, loadTrailerCommits, computeLandings, listReleaseTags, releasesContaining, type Realization } from "./rex-gateway.js";
import type { Layout } from "./llm-gateway.js";
import { readRequirements, releaseId, RELEASE_PREFIX } from "./sources/requirements.js";
import { readCode } from "./sources/code.js";
import { readRuns } from "./sources/runs.js";
import { byString } from "./canonical.js";
import type { GraphSnapshot, SnapshotEdge, SnapshotNode, Warn } from "./types.js";

export interface BuildSnapshotOptions {
  /** Project every file in the inventory as a node. Off by default. */
  files?: boolean;
  /** The branch commits and landings are read from; rex's default (`origin/HEAD`, `origin/main`, `main`) when unset. */
  ref?: string;
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
  const gitOptions = { repoDir: layout.root, cacheDir: options.cacheDir ?? join(graviewDirOf(layout), "cache"), ref: options.ref };

  // What git alone says about the work, through the N-DX-Item trailers on
  // main: every trailer commit naming a change or task is a commit node that
  // landed for it, and a finished change that has no stamped `shippedIn`
  // shipped with the first release tag containing its landing (the same answer
  // rex's `resolveShippedIn` gives, for every change in one walk). The caches
  // go under the graview dir. Needs a git repository with full history;
  // without one the graph has no commits from git and says why.
  const taggedAt = new Map<string, string>();
  if (requirements.nodes.some((n) => n.kind === "change" || n.kind === "task")) {
    try {
      for (const commit of await loadTrailerCommits(gitOptions)) {
        const items = commit.items.filter((id) => requirements.ids.has(id));
        if (items.length === 0) continue;
        add({
          id: commit.hash,
          kind: "commit",
          sha: commit.hash,
          subject: commit.subject || runs.commitSubjects.get(commit.hash) || undefined,
          author: commit.author || undefined,
          committedAt: commit.timestamp,
        });
        for (const id of items) edges.push({ kind: "landedFor", from: commit.hash, to: id });
      }

      const stamped = new Set(edges.filter((e) => e.kind === "shippedWith").map((e) => e.from));
      const landingOf = new Map<string, string>();
      for (const [id, landing] of Object.entries(await computeLandings(requirements.tree, gitOptions))) {
        if (landing.landed && !stamped.has(id)) landingOf.set(id, landing.commit);
      }
      const tags = await listReleaseTags(layout.root);
      for (const tag of tags) taggedAt.set(tag.version, tag.createdAt);
      const versionOf = await releasesContaining(layout.root, tags, new Set(landingOf.values()));
      for (const [id, landing] of landingOf) {
        const version = versionOf.get(landing);
        if (version !== undefined) edges.push({ kind: "shippedWith", from: id, to: releaseId(version) });
      }
    } catch (error) {
      warn(`Commits and releases from git skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // A release is a node for every version a change is planned for or shipped
  // in, and for every release tag git has, counting both and dated by the tag.
  const tally = new Map<string, { planned: number; shipped: number }>();
  for (const version of taggedAt.keys()) tally.set(version, { planned: 0, shipped: 0 });
  for (const edge of edges) {
    if (edge.kind !== "plannedFor" && edge.kind !== "shippedWith") continue;
    if (!edge.to.startsWith(RELEASE_PREFIX)) continue;
    const version = edge.to.slice(RELEASE_PREFIX.length);
    const t = tally.get(version) ?? { planned: 0, shipped: 0 };
    if (edge.kind === "plannedFor") t.planned += 1;
    else t.shipped += 1;
    tally.set(version, t);
  }
  for (const [version, t] of tally) {
    add({ id: releaseId(version), kind: "release", version, plannedChanges: t.planned, shippedChanges: t.shipped, taggedAt: taggedAt.get(version) });
  }

  // Commits realize capabilities through their N-DX-Item trailers. Needs the
  // product layer, so a v1 tree has no realizes edges.
  const hasCapabilities = requirements.nodes.some((n) => n.kind === "capability");
  if (hasCapabilities) {
    try {
      const realized: Record<string, Realization> = await computeRealizedBy(requirements.tree, requirements.productEdges, {
        ...gitOptions,
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
