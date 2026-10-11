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
import { loadTrailerCommits, loadCommitFiles, computeLandings, listReleaseTags, releasesContaining, resolveNode, trailerIds } from "./rex-gateway.js";
import { execStdout, type Layout } from "./llm-gateway.js";
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
  /** On a v1 tree, draw the product layer rex's migration plan proposes. Default true. */
  proposeProductLayer?: boolean;
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
  /** Which storage rex read. */
  layout: "v1" | "v2";
  /** Where the product layer came from: the v2 tree, rex's migration plan over a v1 tree, or nowhere. */
  productLayer: "stored" | "proposed" | "none";
}

/** Where the projection's own files go: the layout's graview dir. */
export function graviewDirOf(layout: Layout): string {
  return layout.graviewDir;
}

/** Shas per git call: well inside every platform's argument limit. */
const DESCRIBE_BATCH = 400;

/**
 * Author, date and subject for every commit node git can see, one call per
 * batch, filling only what the node lacks; returns the shas git knows. A run
 * record may name a commit this clone does not have, and `--ignore-missing`
 * drops it without failing the rest.
 */
async function describeCommits(repoDir: string, nodes: Map<string, SnapshotNode>): Promise<Set<string>> {
  const known = new Set<string>();
  const wanted = [...nodes.values()].filter((n) => n.kind === "commit").map((n) => n.id);
  for (let i = 0; i < wanted.length; i += DESCRIBE_BATCH) {
    const batch = wanted.slice(i, i + DESCRIBE_BATCH);
    const log = await execStdout("git", ["log", "--no-walk=unsorted", "--ignore-missing", "--format=%H%x1f%an%x1f%aI%x1f%s", ...batch], { cwd: repoDir, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    for (const line of log.split("\n")) {
      const [sha, author, at, subject] = line.split("\x1f");
      const node = sha ? nodes.get(sha) : undefined;
      if (!node) continue;
      known.add(sha!);
      node.author ??= author || undefined;
      node.committedAt ??= at || undefined;
      if (!node.subject) node.subject = subject || undefined;
    }
  }
  return known;
}

export async function buildSnapshot(layout: Layout, options: BuildSnapshotOptions = {}): Promise<SnapshotReport> {
  const warnings: string[] = [];
  const warn: Warn = (message) => {
    warnings.push(message);
    options.warn?.(message);
  };

  const requirements = await readRequirements(layout.rexDir, warn, { proposeProductLayer: options.proposeProductLayer });
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
  // Where each change or task's work landed: the commits the run records name
  // (seeded here), and the trailer commits (added below). Both tie a commit to
  // an item; the realization reads them alike.
  const landings = new Map<string, string[]>();
  for (const [taskId, shas] of runs.commitsFor) if (requirements.ids.has(taskId)) landings.set(taskId, [...shas]);
  // The commit shas git can see, once it has been asked; a record may name a commit this clone does not have.
  let known: Set<string> | undefined;
  if (requirements.nodes.some((n) => n.kind === "change" || n.kind === "task")) {
    try {
      for (const commit of await loadTrailerCommits(gitOptions)) {
        const items = commit.items.filter((id) => requirements.ids.has(id));
        if (items.length === 0) continue;
        // A run record may already name this commit: the trailer is the stronger tie, and git knows the author and date.
        const node = nodes.get(commit.hash) ?? { id: commit.hash, kind: "commit", sha: commit.hash };
        node.subject = commit.subject || node.subject || runs.commitSubjects.get(commit.hash) || undefined;
        node.author = commit.author || undefined;
        node.committedAt = commit.timestamp;
        node.attribution = "trailer";
        nodes.set(commit.hash, node);
        for (const id of items) {
          edges.push({ kind: "landedFor", from: commit.hash, to: id });
          landings.set(id, [...(landings.get(id) ?? []), commit.hash]);
        }
      }
      known = await describeCommits(layout.root, nodes);

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

  // Where a capability lives in code: the zones of the files changed by every
  // commit that landed for a change placed on it (amends or touches) or for
  // the work under that change, whether a trailer or a run record tied the
  // commit to the work. Wider than rex's own `computeRealizedBy` (amending
  // changes, trailers only), because on a proposed product layer the relation
  // is a lead-verb guess and the hench-era commits come only from run records.
  const capabilities = requirements.nodes.filter((n) => n.kind === "capability");
  if (capabilities.length > 0) {
    if (known === undefined) {
      warn("Realized-by edges skipped: the commits that realize a capability need a git repository with full history");
    } else {
      try {
        const shasOf = new Map<string, Set<string>>();
        for (const capability of capabilities) {
          const shas = new Set<string>();
          for (const changeId of requirements.productEdges.changedBy[capability.id] ?? []) {
            const change = resolveNode(requirements.tree, changeId);
            if (!change) continue;
            for (const item of trailerIds(change)) for (const sha of landings.get(item) ?? []) if (known.has(sha)) shas.add(sha);
          }
          if (shas.size > 0) shasOf.set(capability.id, shas);
        }
        const files = await loadCommitFiles(gitOptions.repoDir, gitOptions.cacheDir, [...shasOf.values()].flatMap((s) => [...s]));
        for (const [capabilityId, shas] of shasOf) {
          const zones = new Set<string>();
          for (const sha of shas) {
            edges.push({ kind: "realizes", from: sha, to: capabilityId });
            for (const file of files.get(sha) ?? []) {
              const zone = code.zoneOf(file);
              if (zone !== undefined) zones.add(zone);
            }
          }
          for (const zone of zones) edges.push({ kind: "realizedIn", from: capabilityId, to: zone });
        }
      } catch (error) {
        warn(`Realized-by edges skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
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
    productLayer: requirements.productLayer,
  };
}
