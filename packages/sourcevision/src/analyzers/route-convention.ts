/**
 * File-based routing conventions: where a framework turns directories into
 * URL routes, and how the files under that root group into features.
 *
 * A route tree is a structural fact no import graph shows. Route modules are
 * wired by the framework from their path, not by importing one another; what
 * they do import is shared UI. Left to the import graph, the partitioner
 * groups route files by which shared components they happen to use, and the
 * id derivation names every zone after the one directory they all share
 * (`routes`, then `routes-2`, `routes-3`, …).
 *
 * Detection reads only inventory paths, so the zone pipeline stays a pure
 * function of its inputs and the input fingerprint already covers it.
 *
 * @module sourcevision/analyzers/route-convention
 */

import { basename, dirname } from "node:path";

export type RouteFramework = "react-router" | "nextjs" | "sveltekit";

export interface RouteConvention {
  framework: RouteFramework;
  /** Route root, relative to the project (e.g. `app/routes`, `web/src/routes`). */
  root: string;
}

/** Marker files, relative to a package directory, and the route roots they imply there. */
const MARKERS: Array<{ framework: RouteFramework; files: RegExp; roots: string[] }> = [
  { framework: "react-router", files: /^(react-router\.config|remix\.config)\.[cm]?[jt]s$/, roots: ["app/routes"] },
  { framework: "react-router", files: /^app\/routes\.[cm]?[jt]s$/, roots: ["app/routes"] },
  { framework: "nextjs", files: /^next\.config\.[cm]?[jt]s$/, roots: ["app", "pages", "src/app", "src/pages"] },
  { framework: "sveltekit", files: /^svelte\.config\.[cm]?[jt]s$/, roots: ["src/routes"] },
];

/**
 * Detect route roots from inventory paths. A marker at `pkg/next.config.js`
 * yields roots under `pkg/`; a root is kept only when files exist under it.
 */
export function detectRouteConventions(paths: readonly string[]): RouteConvention[] {
  const dirs = new Set<string>();
  for (const p of paths) {
    let d = dirname(p);
    while (d !== "." && !dirs.has(d)) {
      dirs.add(d);
      d = dirname(d);
    }
  }
  const found = new Map<string, RouteConvention>();
  for (const p of paths) {
    for (const marker of MARKERS) {
      // Try the marker relative to every ancestor package directory of p.
      const parts = p.split("/");
      for (let i = 0; i < parts.length; i++) {
        const pkg = parts.slice(0, i).join("/");
        const rel = parts.slice(i).join("/");
        if (!marker.files.test(rel)) continue;
        for (const r of marker.roots) {
          const root = pkg ? `${pkg}/${r}` : r;
          if (dirs.has(root) && !found.has(root)) found.set(root, { framework: marker.framework, root });
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => a.root.localeCompare(b.root));
}

/** Directory names that describe a role inside a feature, never a feature. */
const ROLE_SEGMENTS = new Set([
  "components", "component", "lib", "utils", "util", "hooks", "hook", "helpers", "data",
  "config", "styles", "types", "models", "services", "server", "client", "ui", "__tests__",
  "__mocks__", "test", "tests", "assets", "scripts",
]);

/**
 * A directory under a route root is a *container* when it holds several
 * feature directories and little of its own — `app/routes/apps/` with one
 * directory per mini-app. Features are then one level below it.
 */
const CONTAINER_MIN_CHILD_DIRS = 3;
const CONTAINER_MAX_OWN_FILES = 3;

export interface RouteLayout {
  conventions: RouteConvention[];
  /** Directories (full paths) treated as containers. */
  containers: Set<string>;
  /** Directory names to skip when deriving zone ids: route root leaves and container names. */
  genericSegments: Set<string>;
}

export function buildRouteLayout(paths: readonly string[], conventions: RouteConvention[]): RouteLayout {
  const containers = new Set<string>();
  const genericSegments = new Set<string>();
  if (conventions.length === 0) return { conventions, containers, genericSegments };

  const childDirs = new Map<string, Set<string>>();
  const ownFiles = new Map<string, number>();
  for (const p of paths) {
    const root = rootOf(p, conventions);
    if (!root) continue;
    const d = dirname(p);
    ownFiles.set(d, (ownFiles.get(d) ?? 0) + 1);
    let child = d;
    while (child !== root && child.length > root.length) {
      const parent = dirname(child);
      let set = childDirs.get(parent);
      if (!set) childDirs.set(parent, (set = new Set()));
      set.add(child);
      child = parent;
    }
  }
  for (const c of conventions) {
    genericSegments.add(basename(c.root).toLowerCase());
    // Containers: directories below the root that hold several non-role
    // feature directories and few files of their own.
    // Only a chain of containers from the root counts: a directory inside a
    // feature (`apps/digest/domains`) is part of that feature, however many
    // subdirectories it has.
    const byDepth = [...childDirs.keys()]
      .filter((dir) => dir.startsWith(`${c.root}/`))
      .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    for (const dir of byDepth) {
      const parent = dirname(dir);
      if (parent !== c.root && !containers.has(parent)) continue;
      const featureKids = [...(childDirs.get(dir) ?? [])].filter((k) => !ROLE_SEGMENTS.has(basename(k).toLowerCase()));
      if (featureKids.length >= CONTAINER_MIN_CHILD_DIRS && (ownFiles.get(dir) ?? 0) <= CONTAINER_MAX_OWN_FILES) {
        containers.add(dir);
        genericSegments.add(basename(dir).toLowerCase());
      }
    }
  }
  return { conventions, containers, genericSegments };
}

function rootOf(path: string, conventions: RouteConvention[]): string | undefined {
  let best: string | undefined;
  for (const c of conventions) {
    if (path.startsWith(`${c.root}/`) && (!best || c.root.length > best.length)) best = c.root;
  }
  return best;
}

/**
 * The route feature a file belongs to, or undefined outside every route root.
 *
 * Below the root, the first directory that is not a container names the
 * feature (`app/routes/admin/…` → `app/routes/admin`; `app/routes/apps/timer/…`
 * → `app/routes/apps/timer` when `apps` is a container). A file directly in a
 * root or container is a flat route: its feature is the first dot-segment of
 * its name (`api.draft.ts`, `api.skips.ts` → `api`), stripped of the
 * convention's pathless-layout `_` and param `$` markers.
 */
export function routeFeatureOf(path: string, layout: RouteLayout): string | undefined {
  const root = rootOf(path, layout.conventions);
  if (!root) return undefined;
  let base = root;
  const rest = path.slice(root.length + 1).split("/");
  for (let i = 0; i < rest.length - 1; i++) {
    const dir = `${base}/${rest[i]}`;
    if (!layout.containers.has(dir)) return dir;
    base = dir;
  }
  const stem = rest[rest.length - 1].replace(/\.[^.]+$/, "");
  const head = (stem.split(".").find(Boolean) ?? "").replace(/^[_$+]+/, "").replace(/\[|\]/g, "");
  return `${base}/${head || "index"}`;
}

/**
 * Tie each route feature's files together: a chain through the sorted files,
 * plus an edge from each file to the feature's first file weighted by that
 * file's pull toward files *outside* the feature. A route module that imports
 * eight shared components gets a tie of eight to its feature, so the shared
 * imports cannot decide its grouping on their own — which is the defect this
 * fixes — while a feature with genuine internal imports keeps them on top.
 * Features of one file get nothing. Returns the number of features linked.
 *
 * These edges are structure the framework declares, not imports; callers add
 * them after snapshotting the import-only graph so cohesion is not inflated.
 */
export function addRouteFeatureEdges(
  graph: Map<string, Map<string, number>>,
  files: readonly string[],
  layout: RouteLayout,
): number {
  if (layout.conventions.length === 0) return 0;
  const featureOf = new Map<string, string>();
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const feature = routeFeatureOf(f, layout);
    if (!feature) continue;
    featureOf.set(f, feature);
    let g = groups.get(feature);
    if (!g) groups.set(feature, (g = []));
    g.push(f);
  }
  // Outside pull, measured before any tie is added.
  const outside = new Map<string, number>();
  for (const [f, feature] of featureOf) {
    let w = 0;
    for (const [n, weight] of graph.get(f) ?? []) if (featureOf.get(n) !== feature) w += weight;
    outside.set(f, w);
  }
  const link = (a: string, b: string, weight: number) => {
    let na = graph.get(a);
    if (!na) graph.set(a, (na = new Map()));
    let nb = graph.get(b);
    if (!nb) graph.set(b, (nb = new Map()));
    na.set(b, (na.get(b) ?? 0) + weight);
    nb.set(a, (nb.get(a) ?? 0) + weight);
  };
  let linked = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort();
    const hub = group[0];
    for (let i = 1; i < group.length; i++) {
      link(group[i - 1], group[i], ROUTE_FEATURE_CHAIN_WEIGHT);
      link(hub, group[i], Math.max(ROUTE_FEATURE_CHAIN_WEIGHT, outside.get(group[i]) ?? 0));
    }
    linked++;
  }
  return linked;
}

/** Weight of the chain edges between a feature's sorted files. */
export const ROUTE_FEATURE_CHAIN_WEIGHT = 1;

/** Detect conventions and build the layout in one step. */
export function routeLayoutFor(paths: readonly string[]): RouteLayout {
  return buildRouteLayout(paths, detectRouteConventions(paths));
}

/**
 * The route feature most of `files` belong to, when at least half do —
 * the URL-shaped identity of a zone (`app/routes/apps/scrapbook`).
 */
export function dominantRouteFeature(
  files: readonly string[],
  layout: RouteLayout,
): { feature: string; count: number } | undefined {
  if (layout.conventions.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const f of files) {
    const feature = routeFeatureOf(f, layout);
    if (feature) counts.set(feature, (counts.get(feature) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!best || best[1] < files.length * 0.5) return undefined;
  return { feature: best[0], count: best[1] };
}

/** `/apps/scrapbook` for `app/routes/apps/scrapbook` — the URL a route feature serves. */
export function routePathOf(feature: string, layout: RouteLayout): string {
  const root = rootOf(`${feature}/x`, layout.conventions) ?? "";
  const rel = feature.slice(root.length).replace(/^\//, "");
  return "/" + rel.split("/").map((seg) => seg.replace(/^[_$+]+/, "")).filter(Boolean).join("/");
}

/**
 * A zone id from the route feature most of `files` serve (`events`, `timer`),
 * or undefined. Used when directory derivation lands on a route-generic
 * segment (`routes`, `apps`) — flat route files directly under a root have
 * no other directory to name them.
 */
export function routeFeatureZoneId(files: readonly string[], layout: RouteLayout): string | undefined {
  const dominant = dominantRouteFeature(files, layout);
  if (!dominant) return undefined;
  const leaf = routePathOf(dominant.feature, layout).split("/").pop() ?? "";
  const id = leaf.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return id || undefined;
}
